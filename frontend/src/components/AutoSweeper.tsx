import { useState, useEffect, useRef } from 'react'
import { type Address } from 'viem'

const RELAYER_URL = (import.meta as any).env?.VITE_RELAYER_URL ?? 'http://localhost:3001'

interface Props {
  userAddress: Address | null
  delegationActive: boolean
}

interface SweeperState {
  enabled: boolean
  forwardAddress: string
  tokens: string[]
  lastSwept: string | null
  totalSwept: number
}

export function AutoSweeper({ userAddress, delegationActive }: Props) {
  const [state, setState] = useState<SweeperState>({
    enabled: false,
    forwardAddress: '',
    tokens: [''],
    lastSwept: null,
    totalSwept: 0,
  })
  const [loading, setLoading] = useState(false)
  const [sweepResult, setSweepResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load saved config
  useEffect(() => {
    if (!userAddress) return
    fetch(`${RELAYER_URL}/sweeper/status/${userAddress}`)
      .then(r => r.json())
      .then(d => {
        if (d.configured) setState(prev => ({ ...prev, ...d }))
      })
      .catch(() => {})
  }, [userAddress])

  // Auto-sweep interval when enabled
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (state.enabled && userAddress) {
      intervalRef.current = setInterval(() => runSweep(true), 30_000) // every 30s
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [state.enabled, userAddress])

  const saveConfig = async () => {
    if (!userAddress) return
    setSaving(true)
    try {
      const res = await fetch(`${RELAYER_URL}/sweeper/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eoaAddress: userAddress,
          forwardAddress: state.forwardAddress,
          tokens: state.tokens.filter(t => t.startsWith('0x')),
          enabled: state.enabled,
        }),
      })
      const data = await res.json()
      if (data.success) setSweepResult('✅ Config saved')
      else setSweepResult(`❌ ${data.error}`)
    } finally { setSaving(false) }
  }

  const toggleSweeper = async () => {
    const next = !state.enabled
    setState(s => ({ ...s, enabled: next }))
    if (!userAddress) return
    await fetch(`${RELAYER_URL}/sweeper/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eoaAddress: userAddress,
        forwardAddress: state.forwardAddress,
        tokens: state.tokens.filter(t => t.startsWith('0x')),
        enabled: next,
      }),
    }).catch(() => {})
  }

  const runSweep = async (auto = false) => {
    if (!userAddress) return
    if (!auto) { setLoading(true); setSweepResult(null) }
    try {
      const res = await fetch(`${RELAYER_URL}/sweeper/sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eoaAddress: userAddress,
          tokens: state.tokens.filter(t => t.startsWith('0x')),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setState(s => ({ ...s, lastSwept: new Date().toISOString(), totalSwept: s.totalSwept + (data.count ?? 0) }))
        if (!auto) setSweepResult(`✅ Swept ${data.count ?? 0} token(s) → ${state.forwardAddress.slice(0, 10)}...`)
      } else {
        if (!auto) setSweepResult(`❌ ${data.error}`)
      }
    } catch (e) {
      if (!auto) setSweepResult(`❌ ${e instanceof Error ? e.message : 'Sweep failed'}`)
    } finally {
      if (!auto) setLoading(false)
    }
  }

  const addToken = () => setState(s => ({ ...s, tokens: [...s.tokens, ''] }))
  const removeToken = (i: number) => setState(s => ({ ...s, tokens: s.tokens.filter((_, idx) => idx !== i) }))
  const updateToken = (i: number, val: string) =>
    setState(s => ({ ...s, tokens: s.tokens.map((t, idx) => idx === i ? val : t) }))

  if (!delegationActive) {
    return (
      <div className="sweeper-card disabled">
        <h2>🔄 Auto-Sweeper</h2>
        <p>Activate delegation first to enable auto-sweeper.</p>
      </div>
    )
  }

  return (
    <div className="sweeper-card">
      <div className="sweeper-header">
        <h2>🔄 Auto-Sweeper</h2>
        {/* ON/OFF Toggle */}
        <button
          className={`sweeper-toggle ${state.enabled ? 'on' : 'off'}`}
          onClick={toggleSweeper}
          title={state.enabled ? 'Click to disable auto-sweep' : 'Click to enable auto-sweep'}
        >
          <span className="toggle-dot" />
          <span className="toggle-label">{state.enabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <p className="sweeper-hint">
        {state.enabled
          ? '⚡ Auto-sweeping every 30s — all incoming tokens forwarded to vault'
          : 'Disabled — configure vault and tokens, then toggle ON'}
      </p>

      {/* Forward address */}
      <div className="sweeper-section">
        <label>Vault / Forward Address</label>
        <input
          className="sweeper-input"
          placeholder="0xVault..."
          value={state.forwardAddress}
          onChange={e => setState(s => ({ ...s, forwardAddress: e.target.value }))}
        />
        <p className="field-hint">ETH is auto-forwarded here on receive(). Tokens swept here.</p>
      </div>

      {/* Token list */}
      <div className="sweeper-section">
        <label>ERC-20 Tokens to Sweep</label>
        {state.tokens.map((tok, i) => (
          <div key={i} className="token-row">
            <input
              className="sweeper-input token-input"
              placeholder={`0xToken${i + 1}...`}
              value={tok}
              onChange={e => updateToken(i, e.target.value)}
            />
            {state.tokens.length > 1 && (
              <button className="remove-btn" onClick={() => removeToken(i)}>✕</button>
            )}
          </div>
        ))}
        <button className="add-btn" onClick={addToken}>+ Add Token</button>
      </div>

      {/* Actions */}
      <div className="sweeper-actions">
        <button className="save-btn" onClick={saveConfig} disabled={saving}>
          {saving ? '⏳ Saving...' : '💾 Save Config'}
        </button>
        <button
          className="sweep-now-btn"
          onClick={() => runSweep(false)}
          disabled={loading || state.tokens.filter(t => t.startsWith('0x')).length === 0}
        >
          {loading ? '⏳ Sweeping...' : '🧹 Sweep Now'}
        </button>
      </div>

      {/* Status */}
      {(state.lastSwept || sweepResult) && (
        <div className="sweeper-status">
          {sweepResult && <p className={sweepResult.startsWith('✅') ? 'status-ok' : 'status-err'}>{sweepResult}</p>}
          {state.lastSwept && (
            <p className="status-meta">
              Last sweep: {new Date(state.lastSwept).toLocaleTimeString()} · Total runs: {state.totalSwept}
            </p>
          )}
        </div>
      )}

      {/* Info row */}
      <div className="sweeper-info-row">
        <div className="info-chip">
          <span>ETH</span>
          <span className={state.forwardAddress.startsWith('0x') ? 'chip-ok' : 'chip-off'}>
            {state.forwardAddress.startsWith('0x') ? '✅ auto' : '⚠ set vault'}
          </span>
        </div>
        <div className="info-chip">
          <span>Tokens</span>
          <span className={state.tokens.some(t => t.startsWith('0x')) ? 'chip-ok' : 'chip-off'}>
            {state.tokens.filter(t => t.startsWith('0x')).length} configured
          </span>
        </div>
        <div className="info-chip">
          <span>Mode</span>
          <span className={state.enabled ? 'chip-ok' : 'chip-off'}>
            {state.enabled ? 'auto (30s)' : 'manual'}
          </span>
        </div>
      </div>
    </div>
  )
}
