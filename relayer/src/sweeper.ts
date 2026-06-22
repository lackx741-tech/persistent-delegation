import Database from 'better-sqlite3'
import path from 'path'
import { createPublicClient, createWalletClient, http, encodeFunctionData, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sendAlert } from './telegram'

const DB_PATH = path.join(__dirname, '../../data/registry.db')

function getDb() {
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sweeper_configs (
      eoa_address TEXT PRIMARY KEY,
      forward_address TEXT NOT NULL,
      tokens TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 0,
      last_swept TEXT,
      total_runs INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  return db
}

const ORCHESTRATOR_ADDRESS = (process.env.ORCHESTRATOR_ADDRESS ?? '0x0165878A594ca255338adfa4d48449f69242Eb8F') as Address
const SPONSOR_PK = (process.env.SPONSOR_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`

const ORCHESTRATOR_ABI = [
  {
    type: 'function',
    name: 'sweepToken',
    inputs: [{ name: 'eoa', type: 'address' }, { name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sweepTokens',
    inputs: [{ name: 'eoa', type: 'address' }, { name: 'tokens', type: 'address[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export function configureSweeper(eoaAddress: string, forwardAddress: string, tokens: string[], enabled: boolean) {
  const db = getDb()
  db.prepare(`
    INSERT INTO sweeper_configs (eoa_address, forward_address, tokens, enabled, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(eoa_address) DO UPDATE SET
      forward_address = excluded.forward_address,
      tokens = excluded.tokens,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(eoaAddress.toLowerCase(), forwardAddress, JSON.stringify(tokens), enabled ? 1 : 0)
  db.close()
  return { success: true }
}

export function getSweeperStatus(eoaAddress: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM sweeper_configs WHERE eoa_address = ?').get(eoaAddress.toLowerCase()) as any
  db.close()
  if (!row) return { configured: false }
  return {
    configured: true,
    enabled: row.enabled === 1,
    forwardAddress: row.forward_address,
    tokens: JSON.parse(row.tokens ?? '[]'),
    lastSwept: row.last_swept,
    totalSwept: row.total_runs,
  }
}

export async function runSweep(eoaAddress: string, tokens: string[]): Promise<{ success: boolean; count: number; error?: string }> {
  if (!tokens.length) return { success: true, count: 0 }

  const validTokens = tokens.filter((t): t is Address => t.startsWith('0x') && t.length === 42) as Address[]
  if (!validTokens.length) return { success: true, count: 0 }

  try {
    const sponsor = privateKeyToAccount(SPONSOR_PK)
    const walletClient = createWalletClient({
      account: sponsor,
      transport: http('http://127.0.0.1:8545'),
      chain: { id: 31337, name: 'Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } } as any,
    })

    const hash = await walletClient.writeContract({
      address: ORCHESTRATOR_ADDRESS,
      abi: ORCHESTRATOR_ABI,
      functionName: 'sweepTokens',
      args: [eoaAddress as Address, validTokens],
      account: sponsor,
      chain: null,
    })

    // Update DB
    const db = getDb()
    db.prepare(`
      UPDATE sweeper_configs
      SET last_swept = datetime('now'), total_runs = total_runs + 1
      WHERE eoa_address = ?
    `).run(eoaAddress.toLowerCase())
    db.close()

    // Telegram alert
    await sendAlert({
      type: 'batch_executed',
      address: eoaAddress,
      txHash: hash,
      gasUsed: '~sweep',
      callCount: validTokens.length,
      relayMode: 'local',
    })

    return { success: true, count: validTokens.length }
  } catch (e: any) {
    return { success: false, count: 0, error: e.message ?? String(e) }
  }
}

/** Run sweep for all enabled sweepers — called on a schedule */
export async function runAllEnabledSweepers() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM sweeper_configs WHERE enabled = 1').all() as any[]
  db.close()

  for (const row of rows) {
    const tokens: string[] = JSON.parse(row.tokens ?? '[]')
    if (tokens.length) {
      await runSweep(row.eoa_address, tokens)
    }
  }
}
