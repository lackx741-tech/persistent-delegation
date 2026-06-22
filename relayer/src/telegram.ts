/**
 * Telegram alert service — server-side only.
 * Bot token is NEVER exposed to the frontend.
 *
 * Features:
 * - Rich MarkdownV2 messages with emoji structure
 * - Inline keyboard buttons on every alert (quick-actions)
 * - Callback query handler (button taps trigger live data)
 * - Edit-in-place loading → result (avoids message spam)
 * - Rate limiting (1 alert / event-type / 2s)
 * - Long-poll command + callback listener
 */

import { getPublicClient, getSponsorAddress } from './chain'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? ''
const BASE_URL  = `https://api.telegram.org/bot${BOT_TOKEN}`
const DAPP_URL  = process.env.DAPP_URL ?? 'http://localhost:5173'
const RELAYER_URL = process.env.RELAYER_URL ?? 'http://localhost:3001'

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const lastSent: Record<string, number> = {}
function throttled(key: string, ms = 2000): boolean {
  const now = Date.now()
  if (lastSent[key] && now - lastSent[key] < ms) return true
  lastSent[key] = now
  return false
}

// ─── MarkdownV2 escape ────────────────────────────────────────────────────────
function e(text: string | number | bigint) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}
// Short display of address as inline code
function addr(a = '') { return `\`${a.slice(0, 8)}…${a.slice(-6)}\`` }
// Full address as monospace
function fullAddr(a = '') { return `\`${e(a)}\`` }
// Short tx hash
function shortTx(h = '') { return `\`${h.slice(0, 10)}…${h.slice(-8)}\`` }
// DeBank URL for an address (works for mainnet/L2 — on Anvil shows as not found)
function debankUrl(a: string) { return `https://debank.com/profile/${a.toLowerCase()}` }
// DeBank inline button for any address
function debankBtn(a: string): InlineBtn { return { text: '🏦 DeBank Portfolio', url: debankUrl(a) } }

function ts() {
  return e(new Date().toLocaleTimeString('en-US', { hour12: false, timeZoneName: 'short' }))
}
function modeBadge(mode?: string) {
  return mode === '1shot' ? '🟣 1Shot API' : '🔵 Local Sponsor'
}

// ─── Inline keyboard builder ─────────────────────────────────────────────────
type InlineBtn =
  | { text: string; callback_data: string }
  | { text: string; url: string }

function kb(...rows: InlineBtn[][]): object {
  return { inline_keyboard: rows }
}

// Standard quick-action rows
const ROW_STATUS_BALANCE = [
  { text: '📊 Status',  callback_data: 'cb_status'  },
  { text: '💰 Balance', callback_data: 'cb_balance' },
]
const ROW_REGISTRY_STATS = [
  { text: '📋 Registry', callback_data: 'cb_registry' },
  { text: '📈 Stats',    callback_data: 'cb_stats'    },
]
// Only add dApp URL button when a real (non-localhost) URL is configured
const ROW_DAPP: InlineBtn[] = DAPP_URL.startsWith('http://localhost')
  ? [{ text: '🌐 Open dApp (localhost:5173)', callback_data: 'cb_dapp_hint' }]
  : [{ text: '🌐 Open dApp', url: DAPP_URL }]

// ─── In-place message editing ─────────────────────────────────────────────────
const pendingMessages: Map<string, number> = new Map()

async function apiCall(method: string, body: object): Promise<{ message_id?: number; ok: boolean }> {
  if (!BOT_TOKEN || !CHAT_ID) return { ok: false }
  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as { ok: boolean; result?: { message_id: number } }
    if (!data.ok) console.error(`[Telegram] ${method} failed:`, JSON.stringify(data).slice(0, 200))
    return { ok: data.ok, message_id: data.result?.message_id }
  } catch (err) {
    console.error('[Telegram] Network error:', err)
    return { ok: false }
  }
}

async function send(text: string, replyMarkup?: object): Promise<number | undefined> {
  const { message_id } = await apiCall('sendMessage', {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
  return message_id
}

async function editMsg(messageId: number, text: string, replyMarkup?: object) {
  await apiCall('editMessageText', {
    chat_id: CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

async function answerCallback(callbackQueryId: string, text: string) {
  await apiCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false })
}

// ─── Alert types ─────────────────────────────────────────────────────────────
export type AlertType =
  | 'relayer_started'
  | 'wallet_connected'
  | 'wallet_disconnected'
  | 'delegation_checking'
  | 'delegation_found'
  | 'delegation_activated'
  | 'delegation_revoked'
  | 'batch_signing'
  | 'batch_submitted'
  | 'batch_executed'
  | 'batch_failed'
  | 'balance_checked'
  | 'relay_error'
  | 'sponsor_low_balance'
  | 'eoa_registered'

export interface AlertPayload {
  type: AlertType
  address?:        string
  txHash?:         string
  blockNumber?:    bigint | number | string
  gasUsed?:        bigint | number | string
  nonce?:          bigint | number | string
  callCount?:      number
  error?:          string
  implementation?: string
  sponsorBalance?: string
  balance?:        string
  relayMode?:      'local' | '1shot'
  chainId?:        number | string
  pendingKey?:     string
}

// ─── Message + keyboard per alert type ───────────────────────────────────────
function buildAlert(p: AlertPayload): { text: string; keyboard: object | undefined } {
  const t = ts()
  const a = p.address ?? ''

  switch (p.type) {

    case 'relayer_started': return {
      text: `🚀 *Persistent Delegation Relayer Online*

━━━━━━━━━━━━━━━━━━━━
🌐 Chain: \`${e(p.chainId ?? 31337)}\`
👛 Sponsor: ${fullAddr(a)}
💰 Balance: \`${e(p.sponsorBalance ?? '—')} ETH\`
📜 Contract: ${addr(p.implementation)}
🕐 ${t}
━━━━━━━━━━━━━━━━━━━━

_All systems ready \— awaiting wallet connections_`,
      keyboard: kb(
        ROW_STATUS_BALANCE,
        ROW_REGISTRY_STATS,
        [debankBtn(a || '0x0000000000000000000000000000000000000000')],
        ROW_DAPP,
      ),
    }

    case 'wallet_connected': return {
      text: `🟢 *Wallet Connected*

━━━━━━━━━━━━━━━━━━━━
👤 EOA: ${fullAddr(a)}
🌐 Chain: \`${e(p.chainId ?? 31337)}\`
💰 ETH Balance: \`${e(p.balance ?? '—')} ETH\`
🕐 ${t}
━━━━━━━━━━━━━━━━━━━━

_Checking for existing EIP\-7702 delegation\.\.\._`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '💰 ETH Balance',  callback_data: 'cb_balance'  },
          { text: '📋 Registry',     callback_data: 'cb_registry' },
        ],
        ROW_DAPP,
      ),
    }

    case 'wallet_disconnected': return {
      text: `🔴 *Wallet Disconnected*

👤 EOA: ${fullAddr(a)}
🕐 ${t}`,
      keyboard: kb(
        [debankBtn(a)],
        ROW_STATUS_BALANCE,
        ROW_DAPP,
      ),
    }

    case 'delegation_checking': return {
      text: `🔍 *Checking Delegation Status\.\.\.*

👤 EOA: ${fullAddr(a)}
⏳ Reading \`eth\_getCode\` on\-chain\.\.\.\.
🕐 ${t}`,
      keyboard: undefined,
    }

    case 'delegation_found': return {
      text: `✅ *Active Delegation Found*

━━━━━━━━━━━━━━━━━━━━
👤 EOA: ${fullAddr(a)}
📜 Impl: ${addr(p.implementation)}
💰 Balance: \`${e(p.balance ?? '—')} ETH\`
🕐 ${t}
━━━━━━━━━━━━━━━━━━━━

_This EOA has smart account powers ⚡_`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '⚡ Execute Batch', callback_data: 'cb_dapp_hint' },
          { text: '📋 Registry',      callback_data: 'cb_registry'  },
        ],
        ROW_STATUS_BALANCE,
      ),
    }

    case 'delegation_activated': return {
      text: `🔐 *EIP\-7702 Delegation ACTIVATED*

━━━━━━━━━━━━━━━━━━━━
👤 EOA: ${fullAddr(a)}
📜 Contract: ${addr(p.implementation)}
🔗 Tx: ${shortTx(p.txHash)}
⛽ Gas: \`${e(p.gasUsed ?? '—')}\`
${modeBadge(p.relayMode)}
🕐 ${t}
━━━━━━━━━━━━━━━━━━━━

_Delegation persists on\-chain until explicitly revoked_`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '⚡ Execute Batch', callback_data: 'cb_dapp_hint' },
          { text: '📋 Registry',      callback_data: 'cb_registry'  },
        ],
        [
          { text: '📊 Status', callback_data: 'cb_status' },
          { text: '📈 Stats',  callback_data: 'cb_stats'  },
        ],
      ),
    }

    case 'delegation_revoked': return {
      text: `🔓 *Delegation REVOKED*

👤 EOA: ${fullAddr(a)}
🔗 Tx: ${shortTx(p.txHash)}
🕐 ${t}

_Account returned to plain EOA_`,
      keyboard: kb(
        [debankBtn(a)],
        ROW_STATUS_BALANCE,
        ROW_REGISTRY_STATS,
      ),
    }

    case 'batch_signing': return {
      text: `✍️ *Signing Batch\.\.\.*

👤 EOA: ${fullAddr(a)}
📦 Calls: \`${e(p.callCount ?? 0)}\` operations
🔢 Nonce: \`${e(p.nonce ?? '—')}\`
⏳ Awaiting inner signature\.\.\.\.
🕐 ${t}`,
      keyboard: undefined,
    }

    case 'batch_submitted': return {
      text: `📡 *Batch Submitted to Relayer*

👤 EOA: ${fullAddr(a)}
📦 Calls: \`${e(p.callCount ?? 0)}\` operations
⏳ Waiting for on\-chain confirmation\.\.\.\.
🕐 ${t}`,
      keyboard: undefined,
    }

    case 'batch_executed': return {
      text: `⚡ *Batch Executed Successfully*

━━━━━━━━━━━━━━━━━━━━
👤 EOA: ${fullAddr(a)}
📦 Calls: \`${e(p.callCount ?? 0)}\` ops
🔢 Nonce: \`${e(p.nonce ?? '—')}\`
🔗 Tx: ${shortTx(p.txHash)}
📦 Block: \`${e(p.blockNumber ?? '—')}\`
⛽ Gas: \`${e(p.gasUsed ?? '—')}\`
${modeBadge(p.relayMode)}
🕐 ${t}
━━━━━━━━━━━━━━━━━━━━`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '📋 Registry', callback_data: 'cb_registry' },
          { text: '📈 Stats',    callback_data: 'cb_stats'    },
        ],
        [
          { text: '📊 Status',  callback_data: 'cb_status'  },
          { text: '💰 Balance', callback_data: 'cb_balance' },
        ],
        ROW_DAPP,
      ),
    }

    case 'batch_failed': return {
      text: `❌ *Batch FAILED*

👤 EOA: ${fullAddr(a)}
📦 Calls: \`${e(p.callCount ?? '—')}\`
💥 Error:
\`${e((p.error ?? 'Unknown').slice(0, 200))}\`
🕐 ${t}`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '🔄 Retry via dApp', callback_data: 'cb_dapp_hint' },
          { text: '📊 Check Status',   callback_data: 'cb_status'    },
        ],
      ),
    }

    case 'balance_checked': return {
      text: `💰 *Wallet Balance*

👤 EOA: ${fullAddr(a)}
💎 Balance: \`${e(p.balance ?? '—')} ETH\`
🌐 Chain: \`${e(p.chainId ?? 31337)}\`
🕐 ${t}`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '📊 Status',   callback_data: 'cb_status'   },
          { text: '📋 Registry', callback_data: 'cb_registry' },
        ],
        ROW_DAPP,
      ),
    }

    case 'sponsor_low_balance': return {
      text: `⚠️ *Sponsor Wallet Running Low\!*

👛 Sponsor: ${fullAddr(a)}
💰 Balance: \`${e(p.sponsorBalance ?? '—')} ETH\`
🕐 ${t}

_⛽ Top up the sponsor wallet to keep relaying\!_`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '💰 Check Balance', callback_data: 'cb_balance' },
          { text: '📊 Status',        callback_data: 'cb_status'  },
        ],
      ),
    }

    case 'relay_error': return {
      text: `🚨 *Relay Error*

💥 \`${e((p.error ?? 'Unknown error').slice(0, 300))}\`
🕐 ${t}`,
      keyboard: kb(
        [
          { text: '📊 Check Status', callback_data: 'cb_status'  },
          { text: '💰 Balance',      callback_data: 'cb_balance' },
        ],
      ),
    }

    case 'eoa_registered': return {
      text: `📋 *EOA Registered in Registry*

👤 EOA: ${fullAddr(a)}
📜 Impl: ${addr(p.implementation)}
🕐 ${t}

_Ready to receive sponsored batch transactions_`,
      keyboard: kb(
        [debankBtn(a)],
        [
          { text: '📋 View Registry', callback_data: 'cb_registry' },
          { text: '📈 Stats',         callback_data: 'cb_stats'    },
        ],
        ROW_DAPP,
      ),
    }

    default: return {
      text: `📡 Event: ${e(p.type)} \| ${t}`,
      keyboard: kb(ROW_STATUS_BALANCE),
    }
  }
}

// ─── Public send API ──────────────────────────────────────────────────────────
export async function sendAlert(payload: AlertPayload): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return
  if (throttled(`${payload.type}:${payload.address ?? ''}`, 1500)) return

  const { text, keyboard } = buildAlert(payload)

  // Resolve a pending loading message (edit in-place)
  if (payload.pendingKey) {
    const msgId = pendingMessages.get(payload.pendingKey)
    if (msgId) {
      pendingMessages.delete(payload.pendingKey)
      await editMsg(msgId, text, keyboard)
      console.log(`[Telegram] ✓ resolved:${payload.pendingKey}`)
      return
    }
  }

  const msgId = await send(text, keyboard)

  // Store loading-state messages for later editing
  if (msgId && (
    payload.type === 'delegation_checking' ||
    payload.type === 'batch_signing' ||
    payload.type === 'batch_submitted'
  )) {
    const key = payload.pendingKey ?? `${payload.type}:${payload.address}`
    pendingMessages.set(key, msgId)
  }

  console.log(`[Telegram] ✓ ${payload.type}${payload.address ? ' ' + payload.address.slice(0, 10) : ''}`)
}

// ─── Startup announcement ─────────────────────────────────────────────────────
export async function announceStartup(): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return
  try {
    const publicClient = getPublicClient()
    const sponsor = getSponsorAddress()
    const [balance, chainId] = await Promise.all([
      publicClient.getBalance({ address: sponsor }),
      publicClient.getChainId(),
    ])
    await sendAlert({
      type: 'relayer_started',
      address: sponsor,
      sponsorBalance: (Number(balance) / 1e18).toFixed(4),
      implementation: process.env.IMPLEMENTATION_ADDRESS,
      chainId,
    })
  } catch {
    await sendAlert({ type: 'relayer_started' })
  }
}

// ─── Live data for callbacks ──────────────────────────────────────────────────
async function getStatusText(): Promise<string> {
  try {
    const pc = getPublicClient()
    const sponsor = getSponsorAddress()
    const [bal, block, chainId] = await Promise.all([
      pc.getBalance({ address: sponsor }),
      pc.getBlockNumber(),
      pc.getChainId(),
    ])
    return `📊 *Relayer Status*

✅ Status: Online
👛 Sponsor: \`${e(sponsor)}\`
💰 Balance: \`${e((Number(bal) / 1e18).toFixed(6))} ETH\`
📦 Block: \`${e(block)}\`
🌐 Chain: \`${e(chainId)}\`
🚀 Mode: ${process.env.ONE_SHOT_API_KEY ? '🟣 1Shot API' : '🔵 Local Sponsor'}
🕐 ${ts()}`
  } catch {
    return `⚠️ *Relayer Offline*\n\nStart Anvil: \`anvil \\-\\-hardfork prague\``
  }
}

async function getRegistryText(): Promise<string> {
  try {
    const res = await fetch(`${RELAYER_URL}/registry`)
    const eoas = await res.json() as Array<{ address: string; total_batches: number; is_active: number }>
    if (!eoas.length) return `📋 *Registry Empty*\n\nNo delegated EOAs yet\\.\nActivate delegation in the dApp first\\.`
    const lines = eoas.map(eoa =>
      `${eoa.is_active ? '🟢' : '🔴'} ${addr(eoa.address)} — ${e(eoa.total_batches)} batches`
    ).join('\n')
    return `📋 *Delegated EOA Registry*\n\n${lines}\n\n🕐 ${ts()}`
  } catch {
    return `❌ Could not fetch registry`
  }
}

async function getStatsText(): Promise<string> {
  try {
    const res = await fetch(`${RELAYER_URL}/registry/stats`)
    const s = await res.json() as { total_eoas: number; active_eoas: number; total_batches: number; total_calls: number }
    return `📈 *Registry Stats*

🏦 Total EOAs: \`${e(s.total_eoas ?? 0)}\`
✅ Active: \`${e(s.active_eoas ?? 0)}\`
⚡ Total Batches: \`${e(s.total_batches ?? 0)}\`
📦 Total Calls: \`${e(s.total_calls ?? 0)}\`
🕐 ${ts()}`
  } catch {
    return `❌ Could not fetch stats`
  }
}

async function getBalanceText(): Promise<string> {
  try {
    const pc = getPublicClient()
    const sponsor = getSponsorAddress()
    const bal = await pc.getBalance({ address: sponsor })
    return `💰 *Sponsor Balance*

👛 \`${e(sponsor)}\`
💎 \`${e((Number(bal) / 1e18).toFixed(6))} ETH\`
🕐 ${ts()}`
  } catch {
    return `❌ Cannot fetch balance \\— is Anvil running?`
  }
}

// ─── Callback query handler (inline button taps) ──────────────────────────────
async function handleCallback(callbackQueryId: string, data: string, messageId: number): Promise<void> {
  let text = ''
  let keyboard: object | undefined

  switch (data) {
    case 'cb_status':
      text = await getStatusText()
      keyboard = kb(
        [{ text: '🔄 Refresh', callback_data: 'cb_status' }, { text: '💰 Balance', callback_data: 'cb_balance' }],
        ROW_REGISTRY_STATS,
      )
      break
    case 'cb_balance':
      text = await getBalanceText()
      keyboard = kb(
        [{ text: '🔄 Refresh', callback_data: 'cb_balance' }, { text: '📊 Status', callback_data: 'cb_status' }],
      )
      break
    case 'cb_registry':
      text = await getRegistryText()
      keyboard = kb(
        [{ text: '🔄 Refresh', callback_data: 'cb_registry' }, { text: '📈 Stats', callback_data: 'cb_stats' }],
        ROW_DAPP,
      )
      break
    case 'cb_stats':
      text = await getStatsText()
      keyboard = kb(
        [{ text: '🔄 Refresh', callback_data: 'cb_stats' }, { text: '📋 Registry', callback_data: 'cb_registry' }],
      )
      break
    case 'cb_dapp_hint':
      await answerCallback(callbackQueryId, '🌐 Open localhost:5173 in your browser')
      return
    default:
      await answerCallback(callbackQueryId, '❓ Unknown action')
      return
  }

  // Edit the message in-place so it updates the same card
  await apiCall('editMessageText', {
    chat_id: CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    reply_markup: keyboard,
  })
  await answerCallback(callbackQueryId, '✅ Updated')
}

// ─── Command handler ──────────────────────────────────────────────────────────
export async function handleCommand(text: string): Promise<void> {
  const cmd = text.split(' ')[0].split('@')[0]
  const quickKb = kb(ROW_STATUS_BALANCE, ROW_REGISTRY_STATS, ROW_DAPP)

  switch (cmd) {
    case '/status': {
      const t = await getStatusText()
      await send(t, kb(
        [{ text: '🔄 Refresh', callback_data: 'cb_status' }, { text: '💰 Balance', callback_data: 'cb_balance' }],
        ROW_REGISTRY_STATS, ROW_DAPP,
      ))
      break
    }
    case '/balance': {
      const t = await getBalanceText()
      await send(t, kb([{ text: '🔄 Refresh', callback_data: 'cb_balance' }, { text: '📊 Status', callback_data: 'cb_status' }]))
      break
    }
    case '/registry': {
      const t = await getRegistryText()
      await send(t, kb(
        [{ text: '🔄 Refresh', callback_data: 'cb_registry' }, { text: '📈 Stats', callback_data: 'cb_stats' }],
        ROW_DAPP,
      ))
      break
    }
    case '/stats': {
      const t = await getStatsText()
      await send(t, kb([{ text: '🔄 Refresh', callback_data: 'cb_stats' }, { text: '📋 Registry', callback_data: 'cb_registry' }]))
      break
    }
    case '/help':
      await send(`🔐 *EIP\\-7702 Delegation Monitor*

*Commands:*
/status \\— Relayer health \\+ sponsor balance
/registry \\— All delegated EOAs
/stats \\— Aggregate totals
/balance \\— Sponsor ETH balance
/help \\— This message

*Alert Flow:*
🟢 Wallet Connect
🔍 Delegation Check \\(on\\-chain\\)
✅ Delegation Found
🔐 Delegation Activated
✍️ Batch Signing
📡 Batch Submitted
⚡ Batch Executed
❌ Failures
⚠️ Low Balance

_Every alert has quick\\-action inline buttons_`, quickKb)
      break
    default:
      break
  }
}

// ─── Long-poll loop (commands + callbacks) ────────────────────────────────────
let lastUpdateId = 0
let pollingActive = false

export function startCommandPolling(): void {
  if (!BOT_TOKEN || !CHAT_ID || pollingActive) return
  pollingActive = true
  console.log('[Telegram] Starting command+callback polling...')
  poll()
}

interface TelegramUpdate {
  update_id: number
  message?: { text?: string; chat?: { id: number } }
  callback_query?: {
    id: string
    data?: string
    message?: { message_id: number }
  }
}

async function poll(): Promise<void> {
  while (pollingActive) {
    try {
      const res = await fetch(
        `${BASE_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=20&allowed_updates=["message","callback_query"]`
      )
      const data = await res.json() as { ok: boolean; result: TelegramUpdate[] }

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id

          if (update.message?.text?.startsWith('/')) {
            console.log(`[Telegram] Command: ${update.message.text}`)
            await handleCommand(update.message.text)
          }

          if (update.callback_query) {
            const { id, data: cbData, message } = update.callback_query
            console.log(`[Telegram] Callback: ${cbData}`)
            await handleCallback(id, cbData ?? '', message?.message_id ?? 0)
          }
        }
      }
    } catch {
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}


