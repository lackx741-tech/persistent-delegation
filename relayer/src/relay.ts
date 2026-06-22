import { encodeFunctionData, type Address } from 'viem'
import { getSponsorClient, getPublicClient, getSponsorAddress } from './chain'
import { sendAlert } from './telegram'

export const BATCH_ABI = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

export interface Call {
  to: Address
  value: bigint
  data: `0x${string}`
}

export interface RelayRequest {
  eoaAddress: Address
  calls: { to: string; value: string; data: string }[]
  innerSignature: `0x${string}`
}

export interface RelayResult {
  txHash: `0x${string}`
  blockNumber: string
  gasUsed: string
  mode: 'local' | '1shot'
}

/**
 * Local relayer — sponsor wallet is server-side, private key never hits the browser.
 * No authorizationList needed — EIP-7702 delegation already persists on-chain.
 */
export async function relayLocal(req: RelayRequest): Promise<RelayResult> {
  const sponsorClient = getSponsorClient()
  const publicClient = getPublicClient()

  // Normalise calls (frontend sends strings, viem needs bigint)
  const calls: Call[] = req.calls.map((c) => ({
    to: c.to as Address,
    value: BigInt(c.value),
    data: c.data as `0x${string}`,
  }))

  // Build calldata for execute(calls, signature)
  const calldata = encodeFunctionData({
    abi: BATCH_ABI,
    functionName: 'execute',
    args: [calls, req.innerSignature],
  })

  // Submit — delegation already persists, no authorizationList needed
  const hash = await sponsorClient.sendTransaction({
    account: sponsorClient.account!,
    to: req.eoaAddress,
    data: calldata,
    value: 0n,
    chain: null,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  // Check sponsor balance — warn if low
  const balance = await publicClient.getBalance({ address: getSponsorAddress() })
  const balEth = Number(balance) / 1e18
  if (balEth < 0.5) {
    await sendAlert({
      type: 'sponsor_low_balance',
      address: getSponsorAddress(),
      sponsorBalance: balEth.toFixed(4),
    })
  }

  return {
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    mode: 'local',
  }
}

/**
 * 1Shot API relayer — enterprise-scale, no gas pre-funding per user.
 * 1Shot handles gas and charges you per transaction.
 * Docs: https://1shotapi.com/docs
 */
export async function relay1Shot(req: RelayRequest): Promise<RelayResult> {
  const apiKey = process.env.ONE_SHOT_API_KEY
  const relayerUrl = process.env.ONE_SHOT_RELAYER_URL ?? 'https://relayer.1shotapi.com'

  if (!apiKey || apiKey === 'your_1shot_api_key_here') {
    throw new Error('ONE_SHOT_API_KEY not configured — falling back to local relay')
  }

  // Build calldata
  const calls: Call[] = req.calls.map((c) => ({
    to: c.to as Address,
    value: BigInt(c.value),
    data: c.data as `0x${string}`,
  }))

  const calldata = encodeFunctionData({
    abi: BATCH_ABI,
    functionName: 'execute',
    args: [calls, req.innerSignature],
  })

  // POST to 1Shot relayer endpoint
  const res = await fetch(`${relayerUrl}/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      chainId: parseInt(process.env.CHAIN_ID ?? '31337'),
      to: req.eoaAddress,
      data: calldata,
      value: '0',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`1Shot relay failed: ${err}`)
  }

  const result = await res.json() as { txHash: string; blockNumber: number; gasUsed: number }

  return {
    txHash: result.txHash as `0x${string}`,
    blockNumber: result.blockNumber.toString(),
    gasUsed: result.gasUsed.toString(),
    mode: '1shot',
  }
}

/**
 * Smart relay: tries 1Shot first (production), falls back to local sponsor.
 * This means your app works locally AND in production with the same code.
 */
export async function relay(req: RelayRequest): Promise<RelayResult> {
  const use1Shot = process.env.ONE_SHOT_API_KEY &&
    process.env.ONE_SHOT_API_KEY !== 'your_1shot_api_key_here'

  if (use1Shot) {
    try {
      console.log('[Relay] Using 1Shot API')
      return await relay1Shot(req)
    } catch (e) {
      console.warn('[Relay] 1Shot failed, falling back to local:', e)
    }
  }

  console.log('[Relay] Using local sponsor')
  return await relayLocal(req)
}
