import { useState, useEffect } from 'react'
import type { Address } from 'viem'
import { parseEther } from 'viem'

const RELAYER_URL = 'http://localhost:3001'

interface DelegatedEOA {
  address: string
  implementation: string
  chain_id: number
  delegated_at: string
  last_executed: string | null
  total_batches: number
  total_calls: number
  total_gas_used: string
  is_active: number
  orchestratorCanAct?: boolean
  onChainDelegation?: boolean
  debankUrl?: string
}

interface BatchHistory {
  id: number
  eoa_address: string
  tx_hash: string
  block_number: string
  gas_used: string
  call_count: number
  relay_mode: string
  executed_at: string
}

interface OrchestratorForm {
  to: string
  value: string
  data: string
}

interface EOADetail {
  registered: boolean
  onChainDelegation: { active: boolean; implementation?: string }
  record: DelegatedEOA | null
  batchHistory: BatchHistory[]
}

export function RegistryDashboard() {
  const [eoas, setEoas] = useState<DelegatedEOA[]>([])
  const [stats, setStats] = useState<{ total_eoas: number; active_eoas: number; total_batches: number; total_calls: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<EOADetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [execResult, setExecResult] = useState<string | null>(null)
  const [manualAddr, setManualAddr] = useState('')
  const [orchForm, setOrchForm] = useState<OrchestratorForm>({ to: '', value: '0.001', data: '0x' })
  const [orchTarget, setOrchTarget] = useState<string | null>(null)

  const fetchRegistry = async () => {
    try {
      const [eoaRes, statsRes] = await Promise.all([
        fetch(`${RELAYER_URL}/orchestrator/eoas`).then(r => r.json()),
        fetch(`${RELAYER_URL}/registry/stats`).then(r => r.json()),
      ])
      setEoas(eoaRes)
      setStats(statsRes)
    } catch { /* relayer offline */ }
  }

  const fetchDetail = async (address: string) => {
    setSelected(address)
    const res = await fetch(`${RELAYER_URL}/registry/${address}`)
    setDetail(await res.json())
  }

  const registerManual = async () => {
    if (!manualAddr) return
    const res = await fetch(`${RELAYER_URL}/registry/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eoaAddress: manualAddr }),
    })
    const data = await res.json()
    if (data.success) { setManualAddr(''); fetchRegistry() }
    else alert(data.error)
  }

  // Execute via Orchestrator (server signs AS the EOA)
  const orchestratorExecute = async (eoaAddress: string) => {
    setLoading(true)
    setExecResult(null)
    try {
      const res = await fetch(`${RELAYER_URL}/orchestrator/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eoaAddress,
          calls: [{ to: orchForm.to || eoaAddress, value: parseEther(orchForm.value || '0.001').toString(), data: orchForm.data || '0x' }],
        }),
      })
      const data = await res.json()
      if (data.success) {
        setExecResult(`✅ Orchestrator Tx: ${data.txHash} | Gas: ${data.gasUsed}`)
        fetchRegistry()
      } else {
        setExecResult(`❌ ${data.error}`)
      }
    } catch (e) {
      setExecResult(`❌ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRegistry() }, [])

  return (
    <div className="registry-card">
      <div className="registry-header">
        <h2>📋 Delegated EOA Registry</h2>
        <button className="refresh-btn" onClick={fetchRegistry}>↻ Refresh</button>
      </div>

      {stats && (
        <div className="stats-row">
          <div className="stat"><span>{stats.total_eoas}</span>Total EOAs</div>
          <div className="stat active"><span>{stats.active_eoas ?? 0}</span>Active</div>
          <div className="stat"><span>{stats.total_batches ?? 0}</span>Batches</div>
          <div className="stat"><span>{stats.total_calls ?? 0}</span>Calls</div>
        </div>
      )}

      {/* Manual register */}
      <div className="manual-register">
        <input placeholder="Register existing delegated EOA: 0x..." value={manualAddr} onChange={e => setManualAddr(e.target.value)} />
        <button onClick={registerManual}>+ Register</button>
      </div>

      {eoas.length === 0 ? (
        <p className="hint">No delegated EOAs registered yet. Activate delegation above.</p>
      ) : (
        <div className="eoa-list">
          {eoas.map((eoa) => (
            <div key={eoa.address} className={`eoa-row ${selected === eoa.address ? 'selected' : ''} ${!eoa.is_active ? 'revoked' : ''}`} onClick={() => fetchDetail(eoa.address)}>
              <div className="eoa-row-main">
                <span className={`dot ${eoa.onChainDelegation ? 'active' : 'inactive'}`} />
                <code className="eoa-addr">{eoa.address.slice(0, 10)}...{eoa.address.slice(-6)}</code>
                <span className="eoa-meta">{eoa.total_batches} batches · {eoa.total_calls} calls</span>
                {eoa.last_executed && <span className="eoa-meta">Last: {new Date(eoa.last_executed).toLocaleTimeString()}</span>}
              </div>
              <div className="eoa-row-actions">
                {/* DeBank portfolio link */}
                <a
                  className="debank-btn"
                  href={`https://debank.com/profile/${eoa.address.toLowerCase()}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  title="View balance & portfolio on DeBank"
                >
                  🏦 DeBank
                </a>
                {/* Orchestrator execute button */}
                {eoa.orchestratorCanAct && eoa.onChainDelegation && (
                  <button
                    className="exec-behalf-btn"
                    disabled={loading}
                    onClick={e => { e.stopPropagation(); setOrchTarget(eoa.address) }}
                  >
                    🤖 Orchestrate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Orchestrator panel — shown when an EOA is targeted */}
      {orchTarget && (
        <div className="orch-panel">
          <div className="detail-header">
            <span>🤖 <strong>Orchestrator</strong> — Acting as <code>{orchTarget.slice(0,10)}...{orchTarget.slice(-6)}</code></span>
            <button onClick={() => setOrchTarget(null)}>✕</button>
          </div>
          <p className="orch-hint">
            The Orchestrator signs the batch digest <em>as this EOA</em> then submits via relayer.
            The EVM runs code with <code>address(this) = EOA</code> — ETH and storage belong to the EOA.
          </p>
          <div className="orch-form">
            <label>Recipient (to)</label>
            <input placeholder="0xRecipient..." value={orchForm.to} onChange={e => setOrchForm(f => ({...f, to: e.target.value}))} />
            <label>ETH Amount</label>
            <input type="number" placeholder="0.001" value={orchForm.value} onChange={e => setOrchForm(f => ({...f, value: e.target.value}))} />
            <label>Data (optional)</label>
            <input placeholder="0x" value={orchForm.data} onChange={e => setOrchForm(f => ({...f, data: e.target.value}))} />
          </div>
          <div className="orch-actions">
            <button className="execute-btn" disabled={loading} onClick={() => orchestratorExecute(orchTarget)}>
              {loading ? '⏳ Executing...' : '🤖 Execute as EOA'}
            </button>
            <a className="debank-btn" href={`https://debank.com/profile/${orchTarget.toLowerCase()}`} target="_blank" rel="noreferrer">
              🏦 View on DeBank
            </a>
          </div>
          {execResult && <p className={`exec-result ${execResult.startsWith('✅') ? '' : 'err'}`}>{execResult}</p>}
        </div>
      )}

      {/* EOA Detail panel */}
      {selected && detail && !orchTarget && (
        <div className="detail-panel">
          <div className="detail-header">
            <span>Detail: <code>{selected.slice(0,10)}...{selected.slice(-6)}</code></span>
            <div style={{display:'flex',gap:'0.5rem'}}>
              <a className="debank-btn" href={`https://debank.com/profile/${selected.toLowerCase()}`} target="_blank" rel="noreferrer">🏦 DeBank</a>
              <button onClick={() => setSelected(null)}>✕</button>
            </div>
          </div>

          <div className="onchain-badge">
            {detail.onChainDelegation.active
              ? `✅ On-chain delegation → ${detail.onChainDelegation.implementation?.slice(0, 14)}...`
              : '❌ No active on-chain delegation'}
          </div>

          {detail.batchHistory.length > 0 && (
            <div className="history-list">
              <p className="calls-title">Batch History</p>
              {detail.batchHistory.map((h) => (
                <div key={h.id} className="history-row">
                  <span>#{h.id}</span>
                  <code>{h.tx_hash.slice(0, 14)}...</code>
                  <span>{h.call_count} calls</span>
                  <span>gas: {h.gas_used}</span>
                  <span className="relay-mode-badge">{h.relay_mode}</span>
                  <span className="eoa-meta">{new Date(h.executed_at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
