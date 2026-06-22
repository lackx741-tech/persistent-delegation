import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { wagmiAdapter } from './lib/config'
import { DelegationStatus } from './components/DelegationStatus'
import { BatchExecutor } from './components/BatchExecutor'
import { RegistryDashboard } from './components/RegistryDashboard'
import { AutoSweeper } from './components/AutoSweeper'
import { getRelayerHealth } from './lib/relayer-client'
import type { Address } from 'viem'
import './App.css'
import './lib/config'

const queryClient = new QueryClient()

function AppContent() {
  const [delegationActive, setDelegationActive] = useState(false)
  const [userAddress, setUserAddress] = useState<Address | null>(null)
  const [userPrivateKey, setUserPrivateKey] = useState<`0x${string}` | null>(null)
  const [relayerStatus, setRelayerStatus] = useState<{
    ok: boolean; sponsor: string; balance: string; mode: string
  } | null>(null)

  useEffect(() => {
    getRelayerHealth()
      .then((h) => setRelayerStatus({ ok: true, sponsor: h.sponsor, balance: h.sponsorBalance, mode: h.mode }))
      .catch(() => setRelayerStatus({ ok: false, sponsor: '', balance: '', mode: '' }))
  }, [])

  return (
    <div className="app">
      <header>
        <h1>🔐 Persistent Delegation</h1>
        <p>EIP-7702 Smart Account · Batch DelegateCall · Node.js Relayer</p>

        {relayerStatus && (
          <div className={`relayer-badge ${relayerStatus.ok ? 'ok' : 'down'}`}>
            {relayerStatus.ok
              ? `✅ Relayer online · ${relayerStatus.mode === '1shot' ? '1Shot API' : 'Local Sponsor'} · ${relayerStatus.balance}`
              : '❌ Relayer offline — start with: cd relayer && npm run dev'}
          </div>
        )}
      </header>

      <main>
        <DelegationStatus
          onAccountChange={(addr, pk) => { setUserAddress(addr); setUserPrivateKey(pk) }}
          onDelegationChange={setDelegationActive}
        />
        <BatchExecutor
          delegationActive={delegationActive}
          userAddress={userAddress}
          userPrivateKey={userPrivateKey}
        />
        <RegistryDashboard />
        <AutoSweeper userAddress={userAddress} delegationActive={delegationActive} />
      </main>

      <footer>
        <div className="flow-diagram">
          <span>Select Account</span>
          <span>→</span>
          <span>EIP-7702 Delegation</span>
          <span>→</span>
          <span>Sign Batch</span>
          <span>→</span>
          <span>Node.js Relayer</span>
          <span>→</span>
          <span>{relayerStatus?.mode === '1shot' ? '1Shot API' : 'Anvil'}</span>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <WagmiProvider config={wagmiAdapter.wagmiConfig as any}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
