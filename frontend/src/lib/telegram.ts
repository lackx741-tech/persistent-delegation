// Telegram alert service for on-chain events
// Sends structured alerts for: delegation activated, batch executed, delegation revoked

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {}
const TELEGRAM_BOT_TOKEN: string = env.VITE_TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_CHAT_ID: string = env.VITE_TELEGRAM_CHAT_ID ?? ''

const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

export type AlertType =
  | 'delegation_activated'
  | 'delegation_revoked'
  | 'batch_executed'
  | 'batch_failed'
  | 'tx_confirmed'

interface AlertPayload {
  type: AlertType
  address?: string
  txHash?: string
  blockNumber?: bigint
  gasUsed?: bigint
  nonce?: bigint
  callCount?: number
  error?: string
  implementation?: string
}

function truncate(addr: string) {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function escapeMarkdown(text: string) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

function buildMessage(payload: AlertPayload): string {
  const time = new Date().toUTCString()

  switch (payload.type) {
    case 'delegation_activated':
      return `🔐 *Persistent Delegation ACTIVATED*

👤 Account: \`${payload.address}\`
📜 Implementation: \`${payload.implementation ?? 'BatchCallAndSponsor'}\`
🔗 Tx: \`${truncate(payload.txHash ?? '')}\`
⛽ Gas: ${payload.gasUsed?.toString() ?? '-'}
🕐 ${time}

_EIP\\-7702 delegation now persists on\\-chain until revoked_`

    case 'delegation_revoked':
      return `🔓 *Delegation REVOKED*

👤 Account: \`${payload.address}\`
🔗 Tx: \`${truncate(payload.txHash ?? '')}\`
🕐 ${time}

_Account returned to plain EOA_`

    case 'batch_executed':
      return `⚡ *Batch Executed Successfully*

👤 EOA: \`${payload.address}\`
📦 Calls: ${payload.callCount ?? 0} atomic operations
🔢 Nonce: ${payload.nonce?.toString() ?? '-'}
🔗 Tx: \`${truncate(payload.txHash ?? '')}\`
⛽ Gas: ${payload.gasUsed?.toString() ?? '-'}
📦 Block: ${payload.blockNumber?.toString() ?? '-'}
🕐 ${time}

_Executed via delegatecall on EOA_`

    case 'batch_failed':
      return `❌ *Batch Execution FAILED*

👤 EOA: \`${payload.address}\`
💥 Error: ${escapeMarkdown(payload.error ?? 'Unknown error')}
🕐 ${time}`

    case 'tx_confirmed':
      return `✅ *Transaction Confirmed*

🔗 Tx: \`${payload.txHash}\`
📦 Block: ${payload.blockNumber?.toString() ?? '-'}
⛽ Gas Used: ${payload.gasUsed?.toString() ?? '-'}
🕐 ${time}`

    default:
      return `📡 Event: ${payload.type} at ${time}`
  }
}

export async function sendTelegramAlert(payload: AlertPayload): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] VITE_TELEGRAM_BOT_TOKEN or VITE_TELEGRAM_CHAT_ID not set — skipping alert')
    return
  }

  const message = buildMessage(payload)

  try {
    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[Telegram] Failed to send alert:', err)
    } else {
      console.log('[Telegram] Alert sent:', payload.type)
    }
  } catch (e) {
    console.error('[Telegram] Network error:', e)
  }
}

// Convenience helpers
export const alertDelegationActivated = (address: string, txHash: string, implementation: string, gasUsed?: bigint) =>
  sendTelegramAlert({ type: 'delegation_activated', address, txHash, implementation, gasUsed })

export const alertDelegationRevoked = (address: string, txHash: string) =>
  sendTelegramAlert({ type: 'delegation_revoked', address, txHash })

export const alertBatchExecuted = (address: string, txHash: string, nonce: bigint, callCount: number, blockNumber?: bigint, gasUsed?: bigint) =>
  sendTelegramAlert({ type: 'batch_executed', address, txHash, nonce, callCount, blockNumber, gasUsed })

export const alertBatchFailed = (address: string, error: string) =>
  sendTelegramAlert({ type: 'batch_failed', address, error })
