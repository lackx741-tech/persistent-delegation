// ── Ethereum / wallet helpers ──

export type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, cb: (...args: unknown[]) => void) => void
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthProvider
  }
}

export async function getProvider(): Promise<EthProvider | null> {
  return (window as Window).ethereum ?? null
}

export async function requestAccounts(provider: EthProvider): Promise<string[]> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
  return accounts
}

export async function getChainId(provider: EthProvider): Promise<number> {
  const hex = await provider.request({ method: 'eth_chainId' }) as string
  return parseInt(hex, 16)
}

export async function getBalance(provider: EthProvider, address: string): Promise<string> {
  const hex = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }) as string
  const wei = BigInt(hex)
  const ethVal = Number(wei) / 1e18
  return ethVal.toFixed(4)
}

export async function getCode(provider: EthProvider, address: string): Promise<string> {
  return provider.request({ method: 'eth_getCode', params: [address, 'latest'] }) as Promise<string>
}

export function isDelegated(code: string): boolean {
  // EIP-7702 delegation designator: 0xef0100...
  return code.startsWith('0xef0100') && code.length > 8
}

export function getDelegationTarget(code: string): string {
  if (!isDelegated(code)) return ''
  // code = 0xef0100 + 20-byte address
  return '0x' + code.slice(8).padStart(40, '0')
}

export function shortenAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}
