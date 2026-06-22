import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { relay, type RelayRequest } from './relay'
import { sendAlert, announceStartup, startCommandPolling, type AlertType } from './telegram'
import { getSponsorAddress, getPublicClient } from './chain'
import {
  registerEOA, deactivateEOA, recordBatch,
  getAllDelegatedEOAs, getActiveDelegatedEOAs, getEOA, getBatchHistory, getStats,
} from './registry'
import { orchestratorExecute, orchestrateAll, type OrchestratorCall } from './orchestrator'
import { configureSweeper, getSweeperStatus, runSweep, runAllEnabledSweepers } from './sweeper'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001')
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173'
const IMPLEMENTATION_ADDRESS = process.env.IMPLEMENTATION_ADDRESS ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const DELEGATION_PREFIX = '0xef0100'

/** Read bytecode to check if EOA has EIP-7702 delegation; returns implementation address or null */
async function verifyDelegationOnChain(address: string): Promise<string | null> {
  try {
    const publicClient = getPublicClient()
    const code = await publicClient.getBytecode({ address: address as `0x${string}` })
    if (!code) return null
    const hex = code.toLowerCase()
    if (!hex.startsWith(DELEGATION_PREFIX)) return null
    return `0x${hex.slice(DELEGATION_PREFIX.length)}`
  } catch {
    return null
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }))  // Allow all origins for local dev
app.use(express.json())

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const publicClient = getPublicClient()
    const sponsorAddress = getSponsorAddress()
    const balance = await publicClient.getBalance({ address: sponsorAddress })
    const balEth = (Number(balance) / 1e18).toFixed(4)
    const blockNumber = await publicClient.getBlockNumber()

    res.json({
      status: 'ok',
      sponsor: sponsorAddress,
      sponsorBalance: `${balEth} ETH`,
      blockNumber: blockNumber.toString(),
      chainId: process.env.CHAIN_ID ?? '31337',
      mode: process.env.ONE_SHOT_API_KEY && process.env.ONE_SHOT_API_KEY !== 'your_1shot_api_key_here'
        ? '1shot'
        : 'local',
    })
  } catch (e) {
    res.status(503).json({ status: 'error', error: String(e) })
  }
})

// ─── POST /relay — main relayer endpoint ──────────────────────────────────────
/**
 * Body: {
 *   eoaAddress:      "0x..."   — the EOA whose delegation is already active
 *   calls:           [{ to, value, data }]  — batch calls (value as string wei)
 *   innerSignature:  "0x..."   — EOA's ECDSA signature over (nonce, calls)
 * }
 *
 * The server holds the sponsor private key and submits the tx.
 * No authorizationList is needed — delegation already persists on-chain.
 */
app.post('/relay', async (req, res) => {
  const { eoaAddress, calls, innerSignature } = req.body as RelayRequest

  // Basic validation
  if (!eoaAddress || !calls?.length || !innerSignature) {
    res.status(400).json({ error: 'Missing required fields: eoaAddress, calls, innerSignature' })
    return
  }

  if (!eoaAddress.startsWith('0x') || eoaAddress.length !== 42) {
    res.status(400).json({ error: 'Invalid eoaAddress' })
    return
  }

  console.log(`[Relay] Request for EOA: ${eoaAddress} — ${calls.length} calls`)

  try {
    const result = await relay({ eoaAddress, calls, innerSignature })
    console.log(`[Relay] Success: ${result.txHash} (${result.mode}) block=${result.blockNumber} gas=${result.gasUsed}`)

    // Record in registry
    recordBatch({
      eoaAddress,
      txHash: result.txHash,
      blockNumber: String(result.blockNumber),
      gasUsed: String(result.gasUsed),
      callCount: calls.length,
      relayMode: result.mode,
    })

    await sendAlert({
      type: 'batch_executed',
      address: eoaAddress,
      txHash: result.txHash,
      callCount: calls.length,
      blockNumber: Number(result.blockNumber),
      gasUsed: Number(result.gasUsed),
      relayMode: result.mode,
    })

    res.json({ success: true, txHash: result.txHash, blockNumber: result.blockNumber, gasUsed: result.gasUsed, mode: result.mode })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[Relay] Error:', error)
    await sendAlert({ type: 'batch_failed', address: eoaAddress, error })
    res.status(500).json({ error })
  }
})

// ─── POST /relay/delegate — submit EIP-7702 delegation tx ────────────────────
app.post('/relay/delegate', async (req, res) => {
  const { eoaAddress, authorization } = req.body

  if (!eoaAddress || !authorization) {
    res.status(400).json({ error: 'Missing eoaAddress or authorization' })
    return
  }

  console.log(`[Delegate] Activating delegation for: ${eoaAddress}`)

  try {
    const { getSponsorClient, getPublicClient } = await import('./chain')
    const sponsorClient = getSponsorClient()
    const publicClient = getPublicClient()

    const hash = await sponsorClient.sendTransaction({
      account: sponsorClient.account!,
      to: eoaAddress,
      value: 0n,
      authorizationList: [authorization],
      chain: null,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    // Register in local DB
    const chainId = parseInt(process.env.CHAIN_ID ?? '31337')
    registerEOA(eoaAddress, IMPLEMENTATION_ADDRESS, chainId)

    await sendAlert({
      type: 'delegation_activated',
      address: eoaAddress,
      txHash: hash,
      implementation: IMPLEMENTATION_ADDRESS,
      gasUsed: receipt.gasUsed,
      relayMode: 'local',
    })

    res.json({ success: true, txHash: hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[Delegate] Error:', error)
    await sendAlert({ type: 'relay_error', error })
    res.status(500).json({ error })
  }
})

// ─── POST /relay/revoke — record revocation ───────────────────────────────────
app.post('/relay/revoke', async (req, res) => {
  const { eoaAddress } = req.body
  if (!eoaAddress) { res.status(400).json({ error: 'Missing eoaAddress' }); return }
  deactivateEOA(eoaAddress)
  res.json({ success: true })
})

// ─── GET /registry — all delegated EOAs ───────────────────────────────────────
app.get('/registry', (_req, res) => {
  const eoas = getAllDelegatedEOAs()
  res.json(eoas)
})

// ─── GET /registry/active — only active delegations ──────────────────────────
app.get('/registry/active', (_req, res) => {
  const eoas = getActiveDelegatedEOAs()
  res.json(eoas)
})

// ─── GET /registry/stats — aggregate stats ────────────────────────────────────
app.get('/registry/stats', (_req, res) => {
  res.json(getStats())
})

// ─── GET /registry/:address — single EOA info + history ──────────────────────
app.get('/registry/:address', async (req, res) => {
  const address = req.params.address.toLowerCase()
  const eoa = getEOA(address)
  const history = getBatchHistory(address)

  // Always verify delegation on-chain (source of truth)
  const onChainImpl = await verifyDelegationOnChain(address)

  res.json({
    registered: !!eoa,
    onChainDelegation: onChainImpl
      ? { active: true, implementation: onChainImpl }
      : { active: false },
    record: eoa ?? null,
    batchHistory: history,
  })
})

// ─── POST /registry/register — manually register a known delegated EOA ───────
// Use this to add EOAs that delegated before the relayer was running
app.post('/registry/register', async (req, res) => {
  const { eoaAddress } = req.body
  if (!eoaAddress) { res.status(400).json({ error: 'Missing eoaAddress' }); return }

  const onChainImpl = await verifyDelegationOnChain(eoaAddress)
  if (!onChainImpl) {
    res.status(400).json({ error: 'No active EIP-7702 delegation found on-chain for this address' })
    return
  }

  const chainId = parseInt(process.env.CHAIN_ID ?? '31337')
  registerEOA(eoaAddress, onChainImpl, chainId)
  res.json({ success: true, implementation: onChainImpl })
})

// ─── GET /sponsor — sponsor wallet info ───────────────────────────────────────
app.get('/sponsor', async (_req, res) => {
  try {
    const publicClient = getPublicClient()
    const address = getSponsorAddress()
    const balance = await publicClient.getBalance({ address })
    res.json({ address, balance: (Number(balance) / 1e18).toFixed(6), balanceWei: balance.toString() })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── Orchestrator routes ──────────────────────────────────────────────────────
/**
 * POST /orchestrator/execute — run as a specific delegated EOA
 * The Orchestrator acts exactly AS the delegated EOA:
 * - Signs the batch digest using the EOA's private key
 * - Submits to the relayer (sponsor pays gas)
 * - EVM runs code in the EOA's context (same address, storage, ETH)
 */
app.post('/orchestrator/execute', async (req, res) => {
  const { eoaAddress, calls, privateKey } = req.body
  if (!eoaAddress || !calls?.length) { res.status(400).json({ error: 'Missing eoaAddress or calls' }); return }

  try {
    console.log(`[Orchestrator] Executing as EOA: ${eoaAddress} (${calls.length} calls)`)
    const result = await orchestratorExecute({ eoaAddress, calls, privateKey })

    await sendAlert({
      type: 'batch_executed',
      address: eoaAddress,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      callCount: result.callCount,
      relayMode: result.mode as 'local' | '1shot',
    })

    res.json({ success: true, ...result })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[Orchestrator] Error:', error)
    await sendAlert({ type: 'batch_failed', address: eoaAddress, error, callCount: calls?.length })
    res.status(500).json({ error })
  }
})

// GET /orchestrator/eoas — list EOAs the orchestrator can act as
app.get('/orchestrator/eoas', async (_req, res) => {
  const eoas = getActiveDelegatedEOAs()
  const KNOWN_KEYS = new Set([
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  ])
  const result = await Promise.all(eoas.map(async (eoa) => {
    let onChain = false
    try {
      const pc = getPublicClient()
      const code = await pc.getBytecode({ address: eoa.address as `0x${string}` })
      onChain = !!code && code.toLowerCase().startsWith('0xef0100')
    } catch { /* ignore */ }
    return { ...eoa, orchestratorCanAct: KNOWN_KEYS.has(eoa.address.toLowerCase()), onChainDelegation: onChain, debankUrl: `https://debank.com/profile/${eoa.address.toLowerCase()}` }
  }))
  res.json(result)
})

// POST /orchestrator/all — execute same calls for ALL delegated EOAs
app.post('/orchestrator/all', async (req, res) => {
  const { calls } = req.body as { calls: OrchestratorCall[] }
  if (!calls?.length) { res.status(400).json({ error: 'Missing calls' }); return }
  try {
    const results = await orchestrateAll(() => calls)
    res.json({ success: true, executed: results.length, results })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── POST /notify — frontend sends UI events here (wallet connect, balance, etc.)
/**
 * Allows the frontend to send Telegram alerts without exposing bot token.
 * Only whitelisted alert types are accepted.
 */
const ALLOWED_FRONTEND_EVENTS: AlertType[] = [
  'wallet_connected',
  'wallet_disconnected',
  'delegation_checking',
  'delegation_found',
  'balance_checked',
  'batch_signing',
  'batch_submitted',
]

app.post('/notify', async (req, res) => {
  const { type, address, balance, chainId, callCount, nonce, pendingKey, implementation } = req.body

  if (!type || !ALLOWED_FRONTEND_EVENTS.includes(type as AlertType)) {
    res.status(400).json({ error: 'Invalid or disallowed alert type' })
    return
  }

  // For wallet_connected, also fetch on-chain balance as a sanity check
  let resolvedBalance = balance
  if (type === 'wallet_connected' && address && !balance) {
    try {
      const publicClient = getPublicClient()
      const bal = await publicClient.getBalance({ address })
      resolvedBalance = (Number(bal) / 1e18).toFixed(4)
    } catch { /* Anvil may not be up */ }
  }

  await sendAlert({ type: type as AlertType, address, balance: resolvedBalance, chainId, callCount, nonce, pendingKey, implementation })
  res.json({ ok: true })
})

// ─── Sweeper routes ───────────────────────────────────────────────────────────

app.post('/sweeper/configure', async (req, res) => {
  const { eoaAddress, forwardAddress, tokens, enabled } = req.body
  if (!eoaAddress) return res.status(400).json({ error: 'eoaAddress required' })
  const result = configureSweeper(eoaAddress, forwardAddress ?? '', tokens ?? [], enabled ?? false)
  res.json(result)
})

app.get('/sweeper/status/:address', (req, res) => {
  res.json(getSweeperStatus(req.params.address))
})

app.post('/sweeper/sweep', async (req, res) => {
  const { eoaAddress, tokens } = req.body
  if (!eoaAddress) return res.status(400).json({ error: 'eoaAddress required' })
  const result = await runSweep(eoaAddress, tokens ?? [])
  res.json(result)
})

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║        Persistent Delegation Relayer         ║
╠══════════════════════════════════════════════╣
║  Listening on  http://localhost:${PORT}          ║
║  Chain ID:     ${process.env.CHAIN_ID ?? '31337'}                          ║
║  RPC:          ${process.env.RPC_URL ?? 'http://127.0.0.1:8545'}  ║
║  Sponsor:      ${getSponsorAddress().slice(0, 20)}...     ║
║  Telegram:     ${process.env.TELEGRAM_BOT_TOKEN ? 'configured ✓      ' : 'not configured   '}             ║
╚══════════════════════════════════════════════╝
  `)

  announceStartup()
  startCommandPolling()

  // Auto-sweeper scheduler — runs all enabled sweepers every 60 seconds
  setInterval(async () => {
    await runAllEnabledSweepers()
  }, 60_000)
})
