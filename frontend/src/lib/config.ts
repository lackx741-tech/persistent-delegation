import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { defineChain } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit-common'
import { http } from 'viem'

// ─── Local Anvil chain (prague hardfork, chainId 31337) ───────────────────────
export const anvil = defineChain({
  id: 31337,
  caipNetworkId: 'eip155:31337',
  chainNamespace: 'eip155',
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
}) satisfies AppKitNetwork

// ─── Deployed contracts on local Anvil ───────────────────────────────────────
/** BatchCallAndSponsor — original (eth_sign, simple) */
export const IMPLEMENTATION_ADDRESS =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`

/** SmartEOA — Solady-based (EIP-712 typed data, ERC-7821, ERC-1271) */
export const SMART_EOA_ADDRESS =
  '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as `0x${string}`

// ─── Anvil Account #0 acts as sponsor/relayer (pre-funded with 10000 ETH) ─────
export const SPONSOR_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`

// ─── WalletConnect project ID ─────────────────────────────────────────────────
export const WALLETCONNECT_PROJECT_ID = 'demo-local-project-id'

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [anvil]

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: WALLETCONNECT_PROJECT_ID,
  transports: {
    [anvil.id]: http('http://127.0.0.1:8545'),
  },
})

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId: WALLETCONNECT_PROJECT_ID,
  metadata: {
    name: 'Persistent Delegation App',
    description: 'EIP-7702 Persistent Smart Account — Local Anvil',
    url: 'http://localhost:5173',
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  defaultNetwork: anvil,
})
