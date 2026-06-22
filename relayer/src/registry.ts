import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(__dirname, '../../data/registry.db')

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS delegated_eoas (
    address         TEXT PRIMARY KEY,
    implementation  TEXT NOT NULL,
    chain_id        INTEGER NOT NULL,
    delegated_at    TEXT NOT NULL,
    last_executed   TEXT,
    total_batches   INTEGER DEFAULT 0,
    total_calls     INTEGER DEFAULT 0,
    total_gas_used  TEXT DEFAULT '0',
    is_active       INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS batch_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    eoa_address     TEXT NOT NULL,
    tx_hash         TEXT NOT NULL,
    block_number    TEXT,
    gas_used        TEXT,
    call_count      INTEGER,
    relay_mode      TEXT,
    executed_at     TEXT NOT NULL,
    FOREIGN KEY (eoa_address) REFERENCES delegated_eoas(address)
  );
`)

export interface DelegatedEOA {
  address: string
  implementation: string
  chain_id: number
  delegated_at: string
  last_executed: string | null
  total_batches: number
  total_calls: number
  total_gas_used: string
  is_active: number
}

export interface BatchHistory {
  id: number
  eoa_address: string
  tx_hash: string
  block_number: string
  gas_used: string
  call_count: number
  relay_mode: string
  executed_at: string
}

// ─── Registry operations ──────────────────────────────────────────────────────

export function registerEOA(address: string, implementation: string, chainId: number): void {
  db.prepare(`
    INSERT INTO delegated_eoas (address, implementation, chain_id, delegated_at, is_active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(address) DO UPDATE SET
      implementation = excluded.implementation,
      delegated_at = excluded.delegated_at,
      is_active = 1
  `).run(address.toLowerCase(), implementation.toLowerCase(), chainId, new Date().toISOString())
}

export function deactivateEOA(address: string): void {
  db.prepare(`UPDATE delegated_eoas SET is_active = 0 WHERE address = ?`)
    .run(address.toLowerCase())
}

export function recordBatch(params: {
  eoaAddress: string
  txHash: string
  blockNumber: string
  gasUsed: string
  callCount: number
  relayMode: string
}): void {
  const addr = params.eoaAddress.toLowerCase()

  db.prepare(`
    INSERT INTO batch_history (eoa_address, tx_hash, block_number, gas_used, call_count, relay_mode, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(addr, params.txHash, params.blockNumber, params.gasUsed, params.callCount, params.relayMode, new Date().toISOString())

  db.prepare(`
    UPDATE delegated_eoas SET
      last_executed = ?,
      total_batches = total_batches + 1,
      total_calls = total_calls + ?,
      total_gas_used = CAST(CAST(total_gas_used AS INTEGER) + ? AS TEXT)
    WHERE address = ?
  `).run(new Date().toISOString(), params.callCount, parseInt(params.gasUsed), addr)
}

export function getAllDelegatedEOAs(): DelegatedEOA[] {
  return db.prepare(`SELECT * FROM delegated_eoas ORDER BY delegated_at DESC`).all() as DelegatedEOA[]
}

export function getActiveDelegatedEOAs(): DelegatedEOA[] {
  return db.prepare(`SELECT * FROM delegated_eoas WHERE is_active = 1 ORDER BY delegated_at DESC`).all() as DelegatedEOA[]
}

export function getEOA(address: string): DelegatedEOA | undefined {
  return db.prepare(`SELECT * FROM delegated_eoas WHERE address = ?`).get(address.toLowerCase()) as DelegatedEOA | undefined
}

export function getBatchHistory(eoaAddress?: string): BatchHistory[] {
  if (eoaAddress) {
    return db.prepare(`SELECT * FROM batch_history WHERE eoa_address = ? ORDER BY executed_at DESC LIMIT 50`).all(eoaAddress.toLowerCase()) as BatchHistory[]
  }
  return db.prepare(`SELECT * FROM batch_history ORDER BY executed_at DESC LIMIT 100`).all() as BatchHistory[]
}

export function getStats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_eoas,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_eoas,
      SUM(total_batches) as total_batches,
      SUM(total_calls) as total_calls
    FROM delegated_eoas
  `).get() as { total_eoas: number; active_eoas: number; total_batches: number; total_calls: number }

  return totals
}
