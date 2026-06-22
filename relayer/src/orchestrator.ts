/**
 * Orchestrator — Autonomous agent that executes batch transactions
 * ON BEHALF of delegated EOAs, acting exactly as those EOAs.
 *
 * How it works:
 *   1. Checks registry for delegated EOAs
 *   2. Uses the EOA's private key to sign the inner batch digest
 *   3. Submits via the local relayer (sponsor pays gas)
 *   4. The EVM runs the code IN the EOA's context (same as if EOA sent it)
 *
 * This is only possible BECAUSE of EIP-7702 persistent delegation:
 *   - The EOA has code installed (0xef0100 prefix)
 *   - The Orchestrator can call execute() ON the EOA's address
 *   - delegatecall runs with address(this) = EOA
 *   - ETH, storage, identity all belong to the EOA
 */

import {
  createWalletClient, createPublicClient, http, keccak256,
  parseEther, type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sendAlert } from './telegram'
import { getActiveDelegatedEOAs, recordBatch } from './registry'

const RPC_URL     = process.env.RPC_URL     ?? 'http://127.0.0.1:8545'
const RELAYER_URL = process.env.RELAYER_URL ?? 'http://localhost:3001'
const CHAIN_ID    = parseInt(process.env.CHAIN_ID ?? '31337')

// ─── Known EOA private keys (Anvil test accounts #1–5) ──────────────────────
// In production: replace with HSM / secure key store / user-provided keys
const KNOWN_EOA_KEYS: Record<string, `0x${string}`> = {
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc': '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906': '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65': '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc': '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
}

export interface OrchestratorCall {
  to: string
  value: string   // wei as string
  data: string
}

export interface OrchestratorJob {
  eoaAddress: string
  calls: OrchestratorCall[]
  privateKey?: `0x${string}` // optional override; uses KNOWN_EOA_KEYS if omitted
}

export interface OrchestratorResult {
  txHash: `0x${string}`
  blockNumber: string
  gasUsed: string
  mode: string
  eoaAddress: string
  callCount: number
}

// ─── Build inner digest exactly as BatchCallAndSponsor.sol does ──────────────
// keccak256(abi.encodePacked(nonce, to0, value0, data0, ...))
// then toEthSignedMessageHash prefix
function buildDigest(nonce: bigint, calls: OrchestratorCall[]): `0x${string}` {
  const nonceHex = nonce.toString(16).padStart(64, '0')
  let packed = nonceHex

  for (const call of calls) {
    const toHex = call.to.toLowerCase().replace('0x', '').padStart(40, '0')
    const valueHex = BigInt(call.value).toString(16).padStart(64, '0')
    const dataHex = call.data.replace('0x', '')
    packed += toHex + valueHex + dataHex
  }

  const innerDigest = keccak256(`0x${packed}` as `0x${string}`)

  // Apply eth_sign prefix: "\x19Ethereum Signed Message:\n32"
  const prefix = '\x19Ethereum Signed Message:\n32'
  const prefixHex = Array.from(new TextEncoder().encode(prefix))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  return keccak256(`0x${prefixHex}${innerDigest.slice(2)}` as `0x${string}`)
}

// ─── Fetch nonce from the delegated EOA via public client ─────────────────────
async function fetchNonce(eoaAddress: Address): Promise<bigint> {
  const pc = createPublicClient({ transport: http(RPC_URL) })
  return pc.readContract({
    address: eoaAddress,
    abi: [{ name: 'getNonce', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
    functionName: 'getNonce',
  }) as Promise<bigint>
}

// ─── Verify EOA is still delegated on-chain ───────────────────────────────────
async function isDelegated(eoaAddress: Address): Promise<boolean> {
  const pc = createPublicClient({ transport: http(RPC_URL) })
  const code = await pc.getBytecode({ address: eoaAddress })
  return !!code && code.toLowerCase().startsWith('0xef0100')
}

// ─── Core execute: sign as EOA + submit to relayer ────────────────────────────
export async function orchestratorExecute(job: OrchestratorJob): Promise<OrchestratorResult> {
  const { eoaAddress, calls } = job
  const normalizedAddr = eoaAddress.toLowerCase()

  // Get private key
  const privateKey = job.privateKey ?? KNOWN_EOA_KEYS[normalizedAddr]
  if (!privateKey) {
    throw new Error(
      `No private key known for ${eoaAddress}. ` +
      `Pass privateKey in the job, or add to KNOWN_EOA_KEYS.`
    )
  }

  // Verify delegation is active
  const delegated = await isDelegated(eoaAddress as Address)
  if (!delegated) {
    throw new Error(`EOA ${eoaAddress} does not have an active EIP-7702 delegation. Activate it first.`)
  }

  // Fetch current nonce from EOA's own storage (via delegatecall)
  const nonce = await fetchNonce(eoaAddress as Address)
  console.log(`[Orchestrator] EOA ${eoaAddress.slice(0,10)}... nonce=${nonce} calls=${calls.length}`)

  // Sign batch digest AS the EOA (orchestrator holds key, acts as EOA)
  const eoaAccount = privateKeyToAccount(privateKey)
  const digest = buildDigest(nonce, calls)
  const innerSignature = await eoaAccount.sign({ hash: digest })

  console.log(`[Orchestrator] Signed as EOA — submitting to relayer...`)

  // Submit to relayer (which pays gas with sponsor key)
  const res = await fetch(`${RELAYER_URL}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eoaAddress, calls, innerSignature }),
  })

  const data = await res.json() as { txHash?: string; blockNumber?: string; gasUsed?: string; mode?: string; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Relay failed')

  console.log(`[Orchestrator] ✅ Tx: ${data.txHash}`)
  return {
    txHash: data.txHash as `0x${string}`,
    blockNumber: data.blockNumber ?? '0',
    gasUsed: data.gasUsed ?? '0',
    mode: data.mode ?? 'local',
    eoaAddress,
    callCount: calls.length,
  }
}

// ─── Batch-execute for ALL active delegated EOAs in registry ─────────────────
// Useful for airdrop-style operations, rebalancing, etc.
export async function orchestrateAll(
  buildCalls: (eoaAddress: string) => OrchestratorCall[]
): Promise<OrchestratorResult[]> {
  const eoas = getActiveDelegatedEOAs()
  const results: OrchestratorResult[] = []

  for (const eoa of eoas) {
    const pk = KNOWN_EOA_KEYS[eoa.address.toLowerCase()]
    if (!pk) {
      console.warn(`[Orchestrator] Skipping ${eoa.address} — no private key`)
      continue
    }

    try {
      const calls = buildCalls(eoa.address)
      const result = await orchestratorExecute({ eoaAddress: eoa.address, calls, privateKey: pk })
      results.push(result)

      await sendAlert({
        type: 'batch_executed',
        address: eoa.address,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        callCount: result.callCount,
        relayMode: result.mode as 'local' | '1shot',
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error(`[Orchestrator] Failed for ${eoa.address}:`, error)
      await sendAlert({ type: 'batch_failed', address: eoa.address, error, callCount: 0 })
    }
  }

  return results
}
