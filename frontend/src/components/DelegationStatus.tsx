import { useEffect, useState, useCallback } from 'react'
import { getPublicClient, checkDelegation, signDelegationAuthorization, submitDelegation, revokeDelegation, getSponsorClient, getLocalWalletClient, type DelegationStatus } from '../lib/delegation'
import { ANVIL_ACCOUNTS } from '../lib/anvil-accounts'
import { IMPLEMENTATION_ADDRESS } from '../lib/config'
import { notify } from '../lib/relayer-client'
import type { Address } from 'viem'

interface Props {
  onAccountChange: (address: Address | null, privateKey: `0x${string}` | null) => void
  onDelegationChange: (active: boolean) => void
}

export function DelegationStatus({ onAccountChange, onDelegationChange }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [status, setStatus] = useState<DelegationStatus>({ active: false })
  const [loading, setLoading] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ethBalance, setEthBalance] = useState<string | null>(null)

  const selectedAccount = selectedIdx !== null ? ANVIL_ACCOUNTS[selectedIdx] : null
  const publicClient = getPublicClient()

  const refreshStatus = useCallback(async (address: Address) => {
    // Notify Telegram: checking delegation
    notify({ type: 'delegation_checking', address, pendingKey: `delegation_checking:${address}` })

    const s = await checkDelegation(address, publicClient)
    const bal = await publicClient.getBalance({ address })
    const balance = (Number(bal) / 1e18).toFixed(4)
    setStatus(s)
    setEthBalance(balance)
    onDelegationChange(s.active)

    if (s.active) {
      // Resolve the loading message → found
      notify({ type: 'delegation_found', address, balance, implementation: IMPLEMENTATION_ADDRESS, pendingKey: `delegation_checking:${address}` })
    } else {
      // Still notify balance checked
      notify({ type: 'balance_checked', address, balance, chainId: 31337 })
    }
  }, [publicClient, onDelegationChange])

  useEffect(() => {
    if (!selectedAccount) {
      setStatus({ active: false })
      setEthBalance(null)
      onAccountChange(null, null)
      onDelegationChange(false)
      return
    }
    onAccountChange(selectedAccount.address, selectedAccount.privateKey)
    // Notify wallet connected
    notify({ type: 'wallet_connected', address: selectedAccount.address, chainId: 31337 })
    refreshStatus(selectedAccount.address)
  }, [selectedIdx])

  const handleActivate = async () => {
    if (!selectedAccount) return
    setLoading(true)
    setError(null)
    setTxHash(null)
    try {
      const localClient = getLocalWalletClient(selectedAccount.privateKey)
      const auth = await signDelegationAuthorization(localClient)
      const sponsorClient = getSponsorClient()
      const hash = await submitDelegation(sponsorClient, selectedAccount.address, auth)
      setTxHash(hash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      await refreshStatus(selectedAccount.address)
      // Backend fires delegation_activated alert after /relay/delegate
      // Also notify for direct-path activations
      notify({ type: 'delegation_found', address: selectedAccount.address, implementation: IMPLEMENTATION_ADDRESS })
      console.log('[Delegation] Activated, block:', receipt.blockNumber)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async () => {
    if (!selectedAccount) return
    setLoading(true)
    setError(null)
    setTxHash(null)
    try {
      const localClient = getLocalWalletClient(selectedAccount.privateKey)
      const hash = await revokeDelegation(localClient)
      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      await refreshStatus(selectedAccount.address)
      notify({ type: 'wallet_disconnected', address: selectedAccount.address })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="delegation-card">
      <h2>1. Select Anvil Test Account</h2>
      <div className="account-selector">
        {ANVIL_ACCOUNTS.map((acc, i) => (
          <button
            key={acc.index}
            className={`account-btn ${selectedIdx === i ? 'selected' : ''}`}
            onClick={() => setSelectedIdx(i)}
          >
            <span>Account #{acc.index}</span>
            <code>{acc.address.slice(0, 10)}...{acc.address.slice(-6)}</code>
          </button>
        ))}
      </div>

      {selectedAccount && (
        <>
          <div className="account-info">
            <p><strong>Address:</strong> <code>{selectedAccount.address}</code></p>
            {ethBalance && <p><strong>Balance:</strong> {ethBalance} ETH</p>}
          </div>

          <h2>2. Persistent EIP-7702 Delegation</h2>

          <div className={`status-badge ${status.active ? 'active' : 'inactive'}`}>
            {status.active ? '✅ Persistent Delegation ACTIVE' : '⚪ Plain EOA — No Delegation'}
          </div>

          {status.active && (
            <div className="delegation-info">
              <p><strong>Impl:</strong> <code>{IMPLEMENTATION_ADDRESS}</code></p>
              <p className="hint">Delegation persists on-chain. Survives disconnects and restarts.</p>
            </div>
          )}

          {!status.active && (
            <div className="delegation-info">
              <p>Activate persistent EIP-7702 delegation:</p>
              <ul>
                <li>Batch multiple transactions atomically</li>
                <li>Sponsor (Account #0) pays gas</li>
                <li>Same address, no migration</li>
                <li>Fully reversible anytime</li>
              </ul>
            </div>
          )}

          <div className="actions">
            {!status.active ? (
              <button onClick={handleActivate} disabled={loading}>
                {loading ? 'Activating...' : 'Activate Persistent Delegation'}
              </button>
            ) : (
              <button onClick={handleRevoke} disabled={loading} className="revoke-btn">
                {loading ? 'Revoking...' : 'Revoke Delegation'}
              </button>
            )}
          </div>

          {txHash && <p className="tx-hash">Tx: <code>{txHash.slice(0, 20)}...</code></p>}
          {error && <p className="error">Error: {error}</p>}
        </>
      )}
    </div>
  )
}

