import { useState } from 'react'
import { parseEther, type Address } from 'viem'
import { signSmartBatch, executeSmartBatch, SMART_EOA_ABI, buildETHTransfer, buildERC20Transfer, type Call } from '../lib/batch'
import { getLocalWalletClient, getPublicClient, getSponsorClient } from '../lib/delegation'
import { notify } from '../lib/relayer-client'
import { TxViewer } from './TxViewer'

interface Props {
  delegationActive: boolean
  userAddress: Address | null
  userPrivateKey: `0x${string}` | null
}

type CallType = 'eth' | 'erc20'

interface CallForm {
  type: CallType
  to: string
  amount: string
  tokenAddress: string
}

const EMPTY_CALL: CallForm = { type: 'eth', to: '', amount: '', tokenAddress: '' }

export function BatchExecutor({ delegationActive, userAddress, userPrivateKey }: Props) {
  const [calls, setCalls] = useState<CallForm[]>([{ ...EMPTY_CALL }])
  const [loading, setLoading] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentNonce, setCurrentNonce] = useState<bigint | null>(null)

  const addCall = () => setCalls(p => [...p, { ...EMPTY_CALL }])
  const removeCall = (i: number) => setCalls(p => p.filter((_, idx) => idx !== i))
  const updateCall = (i: number, field: keyof CallForm, value: string) =>
    setCalls(p => p.map((c, idx) => idx === i ? { ...c, [field]: value } : c))

  const buildCalls = (): Call[] =>
    calls.map(c =>
      c.type === 'eth'
        ? buildETHTransfer(c.to as Address, parseEther(c.amount || '0'))
        : buildERC20Transfer(c.tokenAddress as Address, c.to as Address, parseEther(c.amount || '0'))
    )

  const handleExecute = async () => {
    if (!userAddress || !userPrivateKey) return
    setLoading(true); setError(null); setTxHash(null)

    try {
      const publicClient = getPublicClient()
      const nonce = await publicClient.readContract({
        address: userAddress, abi: SMART_EOA_ABI, functionName: 'getNonce',
      })
      setCurrentNonce(nonce)

      const batchCalls = buildCalls()
      notify({ type: 'batch_signing', address: userAddress, callCount: batchCalls.length, nonce: nonce.toString() })

      const localClient = getLocalWalletClient(userPrivateKey)
      const sig = await signSmartBatch(localClient, userAddress, userAddress, 31337, nonce, batchCalls)

      notify({ type: 'batch_submitted', address: userAddress, callCount: batchCalls.length, pendingKey: `batch_signing:${userAddress}` })

      const sponsorClient = getSponsorClient()
      const hash = await executeSmartBatch(sponsorClient, userAddress, batchCalls, sig)
      setTxHash(hash)

      const newNonce = await publicClient.readContract({
        address: userAddress, abi: SMART_EOA_ABI, functionName: 'getNonce',
      })
      setCurrentNonce(newNonce)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution failed')
    } finally {
      setLoading(false)
    }
  }

  if (!delegationActive) {
    return (
      <div className="batch-card disabled">
        <h2>3. Batch Executor</h2>
        <p>Activate delegation first.</p>
      </div>
    )
  }

  return (
    <div className="batch-card">
      <h2>3. Execute Batch</h2>
      {currentNonce !== null && (
        <p className="nonce-badge">Nonce: <strong>{currentNonce.toString()}</strong></p>
      )}

      <div className="calls-list">
        {calls.map((call, i) => (
          <div key={i} className="call-item">
            <div className="call-header">
              <span>Call #{i + 1}</span>
              {calls.length > 1 && <button className="remove-btn" onClick={() => removeCall(i)}>✕</button>}
            </div>
            <label>Type</label>
            <select value={call.type} onChange={e => updateCall(i, 'type', e.target.value)}>
              <option value="eth">ETH Transfer</option>
              <option value="erc20">ERC-20 Transfer</option>
            </select>
            {call.type === 'erc20' && (
              <>
                <label>Token</label>
                <input placeholder="0xToken..." value={call.tokenAddress} onChange={e => updateCall(i, 'tokenAddress', e.target.value)} />
              </>
            )}
            <label>Recipient</label>
            <input placeholder="0xRecipient..." value={call.to} onChange={e => updateCall(i, 'to', e.target.value)} />
            <label>Amount (ETH)</label>
            <input type="number" placeholder="0.01" value={call.amount} onChange={e => updateCall(i, 'amount', e.target.value)} />
          </div>
        ))}
      </div>

      <button className="add-btn" onClick={addCall}>+ Add Call</button>

      <div className="execute-section">
        <button onClick={handleExecute} disabled={loading} className="execute-btn">
          {loading ? '⏳ Executing...' : `Execute ${calls.length} Call${calls.length > 1 ? 's' : ''}`}
        </button>
      </div>

      {txHash && (
        <div className="success-box">
          <p>✅ Done</p>
          <TxViewer txHash={txHash} userAddress={userAddress} />
        </div>
      )}
      {error && <p className="error">❌ {error}</p>}
    </div>
  )
}
