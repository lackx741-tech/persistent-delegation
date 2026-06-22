import { useState } from 'react'
import { getPublicClient } from '../lib/delegation'
import { BATCH_ABI } from '../lib/batch'
import type { Address } from 'viem'

interface Props {
  txHash: `0x${string}` | null
  userAddress: Address | null
}

interface TxDetails {
  status: 'success' | 'reverted'
  blockNumber: bigint
  gasUsed: bigint
  from: string
  to: string
  nonce: bigint | null
  calls: { to: string; value: string; data: string }[]
}

export function TxViewer({ txHash, userAddress }: Props) {
  const [details, setDetails] = useState<TxDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const fetchTx = async () => {
    if (!txHash) return
    setLoading(true)
    try {
      const publicClient = getPublicClient()

      const [receipt, tx] = await Promise.all([
        publicClient.getTransactionReceipt({ hash: txHash }),
        publicClient.getTransaction({ hash: txHash }),
      ])

      // Parse BatchExecuted event if present
      let batchNonce: bigint | null = null
      let batchCalls: { to: string; value: string; data: string }[] = []

      if (userAddress) {
        try {
          const logs = await publicClient.getContractEvents({
            address: userAddress,
            abi: BATCH_ABI,
            eventName: 'BatchExecuted',
            fromBlock: receipt.blockNumber,
            toBlock: receipt.blockNumber,
          })
          if (logs.length > 0) {
            const evt = logs[0]
            batchNonce = evt.args.nonce ?? null
            batchCalls = (evt.args.calls ?? []).map((c) => ({
              to: c.to,
              value: (Number(c.value) / 1e18).toFixed(6) + ' ETH',
              data: c.data === '0x' ? '(none)' : c.data.slice(0, 20) + '...',
            }))
          }
        } catch {
          // Event parsing is best-effort
        }
      }

      setDetails({
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        from: tx.from,
        to: tx.to ?? '',
        nonce: batchNonce,
        calls: batchCalls,
      })
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  if (!txHash) return null

  return (
    <div className="tx-viewer">
      <div className="tx-header" onClick={() => (open ? setOpen(false) : fetchTx())}>
        <span className="tx-label">
          {open ? '▾' : '▸'} Tx: <code>{txHash.slice(0, 14)}...{txHash.slice(-8)}</code>
        </span>
        {!open && (
          <button className="inspect-btn" disabled={loading}>
            {loading ? 'Loading...' : 'Inspect'}
          </button>
        )}
      </div>

      {open && details && (
        <div className="tx-details">
          <div className={`tx-status ${details.status}`}>
            {details.status === 'success' ? '✅ Success' : '❌ Reverted'}
          </div>

          <table className="tx-table">
            <tbody>
              <tr><td>Block</td><td>{details.blockNumber.toString()}</td></tr>
              <tr><td>Gas Used</td><td>{details.gasUsed.toString()}</td></tr>
              <tr><td>From</td><td><code>{details.from.slice(0,14)}...{details.from.slice(-6)}</code></td></tr>
              <tr><td>To (EOA)</td><td><code>{details.to.slice(0,14)}...{details.to.slice(-6)}</code></td></tr>
              {details.nonce !== null && (
                <tr><td>Batch Nonce</td><td>{details.nonce.toString()}</td></tr>
              )}
            </tbody>
          </table>

          {details.calls.length > 0 && (
            <div className="batch-calls-list">
              <p className="calls-title">Batch Calls ({details.calls.length})</p>
              {details.calls.map((c, i) => (
                <div key={i} className="call-row">
                  <span>#{i + 1}</span>
                  <span>To: <code>{c.to.slice(0,10)}...{c.to.slice(-6)}</code></span>
                  <span>{c.value}</span>
                  <span className="call-data">{c.data}</span>
                </div>
              ))}
            </div>
          )}

          <button className="close-btn" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  )
}
