// ── Relayer API helpers ──

export type RelayerHealth = {
  status: string
  sponsor: string
  sponsorBalance: string
  blockNumber: string
  chainId: string
  mode: string
}

export type DelegateResult = {
  success: boolean
  txHash?: string
  error?: string
}

export type BatchCall = {
  target: string
  value?: string
  data?: string
}

export type SweeperStatus = {
  configured: boolean
  enabled: boolean
  forwardAddress: string
  tokens: string[]
  lastSwept: string | null
  totalSwept: number
}

export async function fetchHealth(relayerUrl: string): Promise<RelayerHealth | null> {
  try {
    const res = await fetch(`${relayerUrl}/health`, { signal: AbortSignal.timeout(4000) })
    return res.ok ? res.json() : null
  } catch {
    return null
  }
}

export async function relayDelegate(relayerUrl: string, eoa: string): Promise<DelegateResult> {
  try {
    const res = await fetch(`${relayerUrl}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eoa }),
    })
    return res.json()
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function relayBatch(relayerUrl: string, eoa: string, calls: BatchCall[]): Promise<DelegateResult> {
  try {
    const res = await fetch(`${relayerUrl}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eoa, calls }),
    })
    return res.json()
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getSweeperStatus(relayerUrl: string, eoa: string): Promise<SweeperStatus | null> {
  try {
    const res = await fetch(`${relayerUrl}/sweeper/status/${eoa}`, { signal: AbortSignal.timeout(4000) })
    return res.ok ? res.json() : null
  } catch {
    return null
  }
}

export async function configureSweeper(
  relayerUrl: string,
  eoaAddress: string,
  forwardAddress: string,
  tokens: string[],
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${relayerUrl}/sweeper/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eoaAddress, forwardAddress, tokens, enabled }),
    })
    return res.json()
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function triggerSweep(relayerUrl: string, eoaAddress: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const res = await fetch(`${relayerUrl}/sweeper/sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eoaAddress }),
    })
    return res.json()
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
