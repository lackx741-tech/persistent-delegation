import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  type Address,
  type WalletClient,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ─── Chain definition from env ────────────────────────────────────────────────
export function getChain() {
  const chainId = parseInt(process.env.CHAIN_ID ?? '31337')
  const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

  return defineChain({
    id: chainId,
    name: chainId === 31337 ? 'Anvil Local' : chainId === 11155111 ? 'Sepolia' : 'Custom',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

// ─── Sponsor wallet client (private key lives server-side only) ───────────────
export function getSponsorClient(): WalletClient {
  const key = process.env.SPONSOR_PRIVATE_KEY
  if (!key) throw new Error('SPONSOR_PRIVATE_KEY not set in .env')

  const account = privateKeyToAccount(key as `0x${string}`)
  return createWalletClient({
    account,
    chain: getChain(),
    transport: http(process.env.RPC_URL),
  })
}

export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: getChain(),
    transport: http(process.env.RPC_URL),
  }) as PublicClient
}

export function getSponsorAddress(): Address {
  const key = process.env.SPONSOR_PRIVATE_KEY
  if (!key) throw new Error('SPONSOR_PRIVATE_KEY not set in .env')
  return privateKeyToAccount(key as `0x${string}`).address
}
