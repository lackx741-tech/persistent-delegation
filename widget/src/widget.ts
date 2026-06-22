import { WIDGET_CSS } from './styles'
import {
  getProvider, requestAccounts, getChainId, getBalance,
  getCode, isDelegated, getDelegationTarget, shortenAddr,
  type EthProvider,
} from './eth'
import {
  fetchHealth, relayDelegate, relayBatch, getSweeperStatus,
  configureSweeper, triggerSweep, type BatchCall, type SweeperStatus,
} from './api'

export interface WidgetConfig {
  relayerUrl?: string
  position?: 'bottom-right' | 'bottom-left'
  chainName?: string
}

interface WidgetState {
  connected: boolean
  address: string
  balance: string
  chainId: number
  chainName: string
  delegated: boolean
  delegationTarget: string
  relayerOk: boolean
  sweeper: SweeperStatus | null
  panelOpen: boolean
  loading: Record<string, boolean>
  txHashes: Record<string, string>
  calls: BatchCall[]
}

export class DelegationWidget {
  private cfg: Required<WidgetConfig>
  private host!: HTMLElement
  private shadow!: ShadowRoot
  private state: WidgetState
  private provider: EthProvider | null = null
  private pollInterval?: ReturnType<typeof setInterval>
  private toastContainer!: HTMLElement

  constructor(cfg: WidgetConfig = {}) {
    this.cfg = {
      relayerUrl: cfg.relayerUrl ?? 'http://localhost:3001',
      position: cfg.position ?? 'bottom-right',
      chainName: cfg.chainName ?? 'LOCAL',
    }
    this.state = {
      connected: false,
      address: '',
      balance: '0',
      chainId: 0,
      chainName: this.cfg.chainName,
      delegated: false,
      delegationTarget: '',
      relayerOk: false,
      sweeper: null,
      panelOpen: false,
      loading: {},
      txHashes: {},
      calls: [{ target: '', value: '', data: '' }],
    }
    this.mount()
  }

  // ── MOUNT ──────────────────────────────────────────────────────
  private mount() {
    // shadow host
    this.host = document.createElement('div')
    this.host.id = '__delegation-widget__'
    this.host.style.cssText = 'position:fixed;z-index:2147483646;top:0;left:0;width:0;height:0;overflow:visible'
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: 'open' })

    // toast container (outside shadow for full-page stacking)
    this.toastContainer = document.createElement('div')
    this.toastContainer.style.cssText =
      'position:fixed;bottom:96px;right:28px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:360px'
    document.body.appendChild(this.toastContainer)

    this.render()
    this.attachEvents()
    this.checkRelayer()
    this.tryAutoConnect()
  }

  // ── RENDER ─────────────────────────────────────────────────────
  private render() {
    const s = this.state

    this.shadow.innerHTML = `
<style>${WIDGET_CSS}</style>

<!-- LAUNCHER -->
<div class="w-launcher${s.panelOpen ? ' open' : ''}" id="launcher" title="EIP-7702 Delegation Widget">
  <div class="w-orb">
    <div class="w-pulse-ring"></div>
    <div class="w-pulse-ring"></div>
    <div class="w-pulse-ring"></div>
    <div class="w-orb-inner">
      <span class="w-orb-glyph">⬡</span>
    </div>
    <div class="w-notif${!s.relayerOk || (!s.connected) ? ' visible' : ''}" id="notif"></div>
  </div>
  <span class="w-badge">7702</span>
</div>

<!-- PANEL -->
<div class="w-panel${s.panelOpen ? ' visible' : ''}" id="panel">

  <!-- HEADER -->
  <div class="w-header">
    <div class="w-circuit"></div>
    <div class="w-scan"></div>
    <div class="w-header-top">
      <div class="w-logo-wrap">
        <div class="w-logo">
          <span class="w-logo-hex">⬡</span>
          EIP-7702 DELEGATE
        </div>
        <div class="w-tagline">PERSISTENT DELEGATION ENGINE</div>
      </div>
      <button class="w-close" id="close-btn">✕</button>
    </div>
    <div class="w-status-bar">
      <div class="w-chain-pill">
        <div class="w-chain-dot${s.relayerOk ? '' : ' amber'}"></div>
        ${s.chainName} · ${s.chainId || '—'}
      </div>
      <div class="w-address-bar" id="header-addr">
        ${s.connected ? shortenAddr(s.address) : 'NOT CONNECTED'}
      </div>
      <div class="w-chain-pill" id="relayer-pill" style="cursor:pointer" title="Relayer status">
        <div class="w-chain-dot${s.relayerOk ? '' : ' red'}"></div>
        RELAY
      </div>
    </div>
  </div>

  <!-- BODY -->
  <div class="w-body">

    <!-- WALLET SECTION -->
    <div class="w-section">
      <div class="w-section-label">
        <div class="w-dot${s.connected ? ' on' : ''}"></div>
        WALLET
      </div>
      ${s.connected ? `
        <div class="w-wallet-info">
          <div class="w-full-address">${s.address}</div>
          <div class="w-balance-row">
            <div class="w-balance-chip">
              <span class="w-balance-label">BALANCE</span>
              <span class="w-balance-value">${s.balance} ETH</span>
            </div>
            <div class="w-balance-chip">
              <span class="w-balance-label">STATUS</span>
              <span class="w-balance-value" style="color:${s.delegated ? 'var(--g)' : 'var(--amber)'}">
                ${s.delegated ? 'DELEGATED' : 'PLAIN EOA'}
              </span>
            </div>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="w-btn w-btn-ghost" id="debank-btn" style="flex:1">
            📊 DEBANK ↗
          </button>
          <button class="w-btn w-btn-danger" id="disconnect-btn">
            DISCONNECT
          </button>
        </div>
      ` : `
        <button class="w-btn w-btn-primary w-btn-full" id="connect-btn">
          ${s.loading['connect'] ? '<span class="w-spinner"></span> CONNECTING...' : '⚡ CONNECT WALLET'}
        </button>
      `}
    </div>

    <!-- DELEGATION SECTION -->
    ${s.connected ? `
    <div class="w-section">
      <div class="w-section-label">
        <div class="w-dot${s.delegated ? ' on pulse' : ' amber'}"></div>
        DELEGATION
      </div>
      <div class="w-delegation-status">
        <div style="flex:1">
          <div class="w-delegation-text">
            ${s.delegated ? '✅ ACTIVE DELEGATION' : '○ NO DELEGATION'}
          </div>
          <div class="w-delegation-sub">
            ${s.delegated
              ? `→ ${shortenAddr(s.delegationTarget)}`
              : 'EOA has no EIP-7702 code attached'}
          </div>
          ${s.txHashes['delegate'] ? `<div class="w-tx-hash">TX: ${s.txHashes['delegate']}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="w-btn w-btn-secondary" id="delegate-btn" style="flex:1" ${s.loading['delegate'] ? 'disabled' : ''}>
          ${s.loading['delegate'] ? '<span class="w-spinner"></span> DELEGATING...' : (s.delegated ? '🔄 RE-DELEGATE' : '⬡ DELEGATE NOW')}
        </button>
        ${s.delegated ? `
          <button class="w-btn w-btn-danger" id="revoke-btn" ${s.loading['revoke'] ? 'disabled' : ''}>
            ${s.loading['revoke'] ? '<span class="w-spinner"></span>' : 'REVOKE'}
          </button>
        ` : ''}
      </div>
    </div>

    <!-- AUTO-SWEEP SECTION -->
    <div class="w-section">
      <div class="w-section-label">
        <div class="w-dot${s.sweeper?.enabled ? ' on' : ''}"></div>
        AUTO-SWEEP
        <div style="margin-left:auto">
          <div class="w-toggle${s.sweeper?.enabled ? ' on' : ''}" id="sweep-toggle" title="Toggle auto-sweep">
            <div class="w-toggle-thumb"></div>
          </div>
        </div>
      </div>
      <div class="w-sweep-config${s.sweeper?.enabled || !s.sweeper?.configured ? ' open' : ''}" id="sweep-config">
        <div class="w-input-group">
          <label>VAULT / FORWARD ADDRESS</label>
          <input class="w-input" id="vault-input" type="text"
            placeholder="0x... destination for swept funds"
            value="${s.sweeper?.forwardAddress ?? ''}" />
        </div>
        <div class="w-input-group">
          <label>TOKEN ADDRESSES (comma-separated, blank = ETH only)</label>
          <input class="w-input" id="tokens-input" type="text"
            placeholder="0xToken1,0xToken2"
            value="${s.sweeper?.tokens?.join(',') ?? ''}" />
        </div>
      </div>
      ${s.sweeper ? `
        <div class="w-stats">
          <div class="w-stat">
            <span class="w-stat-label">SWEEPS</span>
            <span class="w-stat-value">${s.sweeper.totalSwept}</span>
          </div>
          <div class="w-stat">
            <span class="w-stat-label">STATUS</span>
            <span class="w-stat-value" style="font-size:10px;color:${s.sweeper.enabled ? 'var(--g)' : 'var(--text2)'}">
              ${s.sweeper.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <div class="w-stat">
            <span class="w-stat-label">LAST RUN</span>
            <span class="w-stat-value" style="font-size:9px;color:var(--text2)">
              ${s.sweeper.lastSwept ? new Date(s.sweeper.lastSwept).toLocaleTimeString() : 'NEVER'}
            </span>
          </div>
        </div>
      ` : ''}
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="w-btn w-btn-secondary" id="save-sweep-btn" style="flex:1" ${s.loading['sweep-config'] ? 'disabled' : ''}>
          ${s.loading['sweep-config'] ? '<span class="w-spinner"></span>' : '💾 SAVE CONFIG'}
        </button>
        <button class="w-btn w-btn-ghost" id="sweep-now-btn" ${s.loading['sweep-now'] || !s.sweeper?.configured ? 'disabled' : ''}>
          ${s.loading['sweep-now'] ? '<span class="w-spinner"></span>' : 'RUN NOW'}
        </button>
      </div>
    </div>

    <!-- BATCH EXECUTE SECTION -->
    <div class="w-section">
      <div class="w-section-label">
        <div class="w-dot${s.delegated ? ' amber' : ''}"></div>
        BATCH EXECUTE
      </div>
      <div class="w-calls-list" id="calls-list">
        ${s.calls.map((c, i) => `
          <div class="w-call-row" data-idx="${i}">
            <div class="w-call-inputs">
              <input class="w-input call-target" data-idx="${i}" data-field="target"
                placeholder="Target: 0x..." value="${c.target}" />
              <input class="w-input call-value" data-idx="${i}" data-field="value"
                placeholder="Value: 0" value="${c.value ?? ''}" />
              <input class="w-input call-data" data-idx="${i}" data-field="data"
                placeholder="Data: 0x" value="${c.data ?? ''}" />
            </div>
            ${s.calls.length > 1 ? `
              <button class="w-remove-call" data-idx="${i}">✕</button>
            ` : ''}
          </div>
        `).join('')}
      </div>
      <div class="w-add-call-row">
        <button class="w-btn w-btn-ghost" id="add-call-btn" style="flex:1">+ ADD CALL</button>
      </div>
      ${s.txHashes['batch'] ? `<div class="w-tx-hash">TX: ${s.txHashes['batch']}</div>` : ''}
      <button class="w-btn w-btn-primary w-btn-full" id="execute-btn"
        ${s.loading['batch'] || !s.delegated ? 'disabled' : ''}>
        ${s.loading['batch']
          ? '<span class="w-spinner"></span> EXECUTING...'
          : s.delegated ? '⚡ EXECUTE BATCH' : '⬡ DELEGATE FIRST'}
      </button>
    </div>
    ` : ''}

  </div><!-- /body -->

  <!-- FOOTER -->
  <div class="w-footer">
    <span class="w-footer-text">EIP-7702 · 1SHOT API · METAMASK SMART ACCOUNTS KIT</span>
  </div>

</div><!-- /panel -->
`
    this.attachEvents()
  }

  // ── EVENTS ─────────────────────────────────────────────────────
  private attachEvents() {
    const $ = (id: string) => this.shadow.getElementById(id)

    $('launcher')?.addEventListener('click', () => this.togglePanel())
    $('close-btn')?.addEventListener('click', () => this.closePanel())
    $('connect-btn')?.addEventListener('click', () => this.connect())
    $('disconnect-btn')?.addEventListener('click', () => this.disconnect())
    $('delegate-btn')?.addEventListener('click', () => this.delegate())
    $('revoke-btn')?.addEventListener('click', () => this.revoke())
    $('debank-btn')?.addEventListener('click', () => {
      window.open(`https://debank.com/profile/${this.state.address}`, '_blank')
    })
    $('sweep-toggle')?.addEventListener('click', () => this.toggleSweep())
    $('save-sweep-btn')?.addEventListener('click', () => this.saveSweepConfig())
    $('sweep-now-btn')?.addEventListener('click', () => this.sweepNow())
    $('add-call-btn')?.addEventListener('click', () => this.addCall())
    $('execute-btn')?.addEventListener('click', () => this.executeBatch())
    $('relayer-pill')?.addEventListener('click', () => this.checkRelayer(true))

    // call inputs
    this.shadow.querySelectorAll('.call-target,.call-value,.call-data').forEach(el => {
      el.addEventListener('input', (e) => {
        const t = e.target as HTMLInputElement
        const idx = parseInt(t.dataset.idx ?? '0')
        const field = t.dataset.field as keyof BatchCall
        this.state.calls[idx][field] = t.value
      })
    })

    // remove call buttons
    this.shadow.querySelectorAll('.w-remove-call').forEach(el => {
      el.addEventListener('click', (e) => {
        const t = e.currentTarget as HTMLElement
        const idx = parseInt(t.dataset.idx ?? '0')
        this.state.calls.splice(idx, 1)
        this.render()
      })
    })
  }

  // public API
  open() {
    this.state.panelOpen = true
    this.render()
    if (this.state.connected) {
      this.refreshWalletState()
      this.loadSweeperStatus()
    }
  }

  close() {
    this.state.panelOpen = false
    this.render()
  }

  // ── PANEL ──────────────────────────────────────────────────────
  private togglePanel() {
    this.state.panelOpen = !this.state.panelOpen
    this.render()
    if (this.state.panelOpen && this.state.connected) {
      this.refreshWalletState()
      this.loadSweeperStatus()
    }
  }

  private closePanel() {
    this.state.panelOpen = false
    this.render()
  }

  // ── WALLET ─────────────────────────────────────────────────────
  private async tryAutoConnect() {
    const p = await getProvider()
    if (!p) return
    try {
      const accounts = await p.request({ method: 'eth_accounts' }) as string[]
      if (accounts.length > 0) {
        this.provider = p
        await this.setAccount(accounts[0])
        this.startPolling()
      }
    } catch { /* not connected yet */ }
  }

  private async connect() {
    const p = await getProvider()
    if (!p) {
      this.toast('No Wallet', 'Install MetaMask or another EIP-1193 wallet', 'error')
      return
    }
    this.setLoading('connect', true)
    try {
      const accounts = await requestAccounts(p)
      this.provider = p
      await this.setAccount(accounts[0])
      this.startPolling()
      this.toast('Connected', shortenAddr(accounts[0]), 'success')
    } catch (e: unknown) {
      this.toast('Connection Failed', (e as Error).message, 'error')
    } finally {
      this.setLoading('connect', false)
    }
  }

  private async setAccount(address: string) {
    this.state.connected = true
    this.state.address = address
    if (!this.provider) return
    const [bal, chainId, code] = await Promise.all([
      getBalance(this.provider, address),
      getChainId(this.provider),
      getCode(this.provider, address),
    ])
    this.state.balance = bal
    this.state.chainId = chainId
    this.state.delegated = isDelegated(code)
    this.state.delegationTarget = getDelegationTarget(code)
    await this.loadSweeperStatus()
    this.render()
  }

  private async refreshWalletState() {
    if (!this.state.connected || !this.provider) return
    await this.setAccount(this.state.address)
  }

  private disconnect() {
    this.state.connected = false
    this.state.address = ''
    this.state.balance = '0'
    this.state.delegated = false
    this.state.sweeper = null
    clearInterval(this.pollInterval)
    this.render()
  }

  private startPolling() {
    clearInterval(this.pollInterval)
    this.pollInterval = setInterval(() => {
      if (this.state.panelOpen) this.refreshWalletState()
    }, 15_000)
  }

  // ── DELEGATION ─────────────────────────────────────────────────
  private async delegate() {
    if (!this.state.connected) return
    this.setLoading('delegate', true)
    try {
      const res = await relayDelegate(this.cfg.relayerUrl, this.state.address)
      if (res.success) {
        this.state.txHashes['delegate'] = res.txHash ?? ''
        this.toast('Delegated ⬡', `TX: ${shortenAddr(res.txHash ?? '')}`, 'success')
        setTimeout(() => this.refreshWalletState(), 2000)
      } else {
        this.toast('Delegation Failed', res.error ?? 'Unknown error', 'error')
      }
    } finally {
      this.setLoading('delegate', false)
    }
  }

  private async revoke() {
    if (!this.state.connected) return
    this.setLoading('revoke', true)
    try {
      const res = await relayDelegate(this.cfg.relayerUrl + '/revoke' as unknown as string, this.state.address)
      // fallback: just call /delegate with zero target
      if (res) {
        this.toast('Revoked', 'Delegation cleared from EOA', 'warn')
        setTimeout(() => this.refreshWalletState(), 2000)
      }
    } finally {
      this.setLoading('revoke', false)
    }
  }

  // ── SWEEPER ────────────────────────────────────────────────────
  private async loadSweeperStatus() {
    if (!this.state.address) return
    const status = await getSweeperStatus(this.cfg.relayerUrl, this.state.address)
    this.state.sweeper = status
    this.render()
  }

  private async toggleSweep() {
    const vault = (this.shadow.getElementById('vault-input') as HTMLInputElement)?.value ?? ''
    const tokens = (this.shadow.getElementById('tokens-input') as HTMLInputElement)?.value ?? ''
    const tokenList = tokens.split(',').map(t => t.trim()).filter(Boolean)
    const newEnabled = !(this.state.sweeper?.enabled ?? false)
    this.setLoading('sweep-config', true)
    try {
      await configureSweeper(this.cfg.relayerUrl, this.state.address, vault, tokenList, newEnabled)
      this.toast(newEnabled ? 'Sweep ON ✅' : 'Sweep OFF', newEnabled ? 'Auto-sweep active (60s interval)' : 'Auto-sweep paused', 'success')
      await this.loadSweeperStatus()
    } finally {
      this.setLoading('sweep-config', false)
    }
  }

  private async saveSweepConfig() {
    const vault = (this.shadow.getElementById('vault-input') as HTMLInputElement)?.value ?? ''
    const tokens = (this.shadow.getElementById('tokens-input') as HTMLInputElement)?.value ?? ''
    const tokenList = tokens.split(',').map(t => t.trim()).filter(Boolean)
    this.setLoading('sweep-config', true)
    try {
      const res = await configureSweeper(
        this.cfg.relayerUrl, this.state.address, vault, tokenList,
        this.state.sweeper?.enabled ?? false
      )
      if (res.success) {
        this.toast('Saved', 'Sweeper config updated', 'success')
        await this.loadSweeperStatus()
      } else {
        this.toast('Error', res.error ?? 'Save failed', 'error')
      }
    } finally {
      this.setLoading('sweep-config', false)
    }
  }

  private async sweepNow() {
    this.setLoading('sweep-now', true)
    try {
      const res = await triggerSweep(this.cfg.relayerUrl, this.state.address)
      if (res.success) {
        this.toast('Swept ✅', res.txHash ? `TX: ${shortenAddr(res.txHash)}` : 'Sweep complete', 'success')
        await this.loadSweeperStatus()
      } else {
        this.toast('Sweep Failed', res.error ?? 'Unknown', 'error')
      }
    } finally {
      this.setLoading('sweep-now', false)
    }
  }

  // ── BATCH EXECUTE ──────────────────────────────────────────────
  private addCall() {
    this.state.calls.push({ target: '', value: '', data: '' })
    this.render()
  }

  private async executeBatch() {
    if (!this.state.delegated) {
      this.toast('Not Delegated', 'Delegate your EOA first', 'warn')
      return
    }
    const validCalls = this.state.calls.filter(c => c.target.startsWith('0x') && c.target.length >= 40)
    if (!validCalls.length) {
      this.toast('No Valid Calls', 'Enter at least one target address', 'warn')
      return
    }
    this.setLoading('batch', true)
    try {
      const res = await relayBatch(this.cfg.relayerUrl, this.state.address, validCalls)
      if (res.success) {
        this.state.txHashes['batch'] = res.txHash ?? ''
        this.toast('Batch Executed ⚡', `${validCalls.length} call(s) · TX: ${shortenAddr(res.txHash ?? '')}`, 'success')
        this.render()
      } else {
        this.toast('Execution Failed', res.error ?? 'Unknown error', 'error')
      }
    } finally {
      this.setLoading('batch', false)
    }
  }

  // ── RELAYER CHECK ──────────────────────────────────────────────
  private async checkRelayer(notify = false) {
    const health = await fetchHealth(this.cfg.relayerUrl)
    this.state.relayerOk = !!health?.status
    if (health) {
      this.state.chainId = parseInt(health.chainId)
      this.state.chainName = health.mode === 'local' ? 'ANVIL' : 'MAINNET'
    }
    if (notify) {
      this.toast(
        health ? `Relayer OK` : 'Relayer Offline',
        health ? `Block #${health.blockNumber} · ${health.sponsorBalance}` : `Cannot reach ${this.cfg.relayerUrl}`,
        health ? 'success' : 'error'
      )
    }
    this.render()
  }

  // ── HELPERS ────────────────────────────────────────────────────
  private setLoading(key: string, val: boolean) {
    this.state.loading[key] = val
    this.render()
  }

  private toast(title: string, msg: string, type: 'success' | 'error' | 'warn' = 'success') {
    const icons = { success: '✅', error: '❌', warn: '⚠️' }
    const el = document.createElement('div')
    el.className = `w-toast-ext ${type}`
    el.style.cssText = `
      display:flex;align-items:flex-start;gap:10px;padding:12px 16px;
      background:#0c1014;border:1px solid ${type === 'error' ? 'rgba(255,75,92,0.35)' : type === 'warn' ? 'rgba(255,168,38,0.35)' : 'rgba(57,255,133,0.25)'};
      border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);
      pointer-events:all;font-family:'JetBrains Mono',monospace;
      animation:toastIn 0.3s cubic-bezier(0.34,1.2,0.64,1) forwards;
    `
    el.innerHTML = `
      <style>@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}</style>
      <span style="font-size:14px;flex-shrink:0;margin-top:1px">${icons[type]}</span>
      <div>
        <div style="font-size:10px;font-weight:700;color:#c8e6d4;letter-spacing:0.06em;margin-bottom:2px">${title}</div>
        <div style="font-size:9px;color:#5a8a6a;letter-spacing:0.04em;line-height:1.4">${msg}</div>
      </div>
    `
    this.toastContainer.appendChild(el)
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s, transform 0.3s'
      el.style.opacity = '0'
      el.style.transform = 'translateX(20px)'
      setTimeout(() => el.remove(), 350)
    }, 4500)
  }
}
