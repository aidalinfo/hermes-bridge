import { Pool } from 'pg'
import type { ExchangeRecord, ExchangeStatus } from './telemetry.js'

export interface DbConfig {
  // Only postgres today — kept as a field (not inferred) so a future driver
  // doesn't need a breaking config change, just a new branch in createExchangeStore.
  driver?: 'postgres'
  connection_string: string
}

/**
 * Durable audit trail for ask_agent <-> reply exchanges, independent of the
 * in-memory history (`telemetry.ts`, capped + wiped on every restart) and of
 * Langfuse (external, opt-in tracing). This is "did agent X really tell
 * agent Y that at 14:32 last Tuesday" — the kind of question you can't
 * answer once a Coolify redeploy has cycled the container.
 */
export interface ExchangeStore {
  insertStart(record: ExchangeRecord): Promise<void>
  updateEnd(record: ExchangeRecord): Promise<void>
  recentExchanges(limit: number): Promise<ExchangeRecord[]>
  shutdown(): Promise<void>
}

// The subset of `pg.Pool` this module actually uses — lets tests inject a
// fake without spinning up a real Postgres instance.
export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>
  end(): Promise<void>
}

const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS hermes_bridge_exchanges (
  request_id      TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  from_agent      TEXT NOT NULL,
  to_agent        TEXT NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL,
  answer          TEXT,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS hermes_bridge_exchanges_started_at_idx
  ON hermes_bridge_exchanges (started_at DESC);
`

function rowToRecord(row: any): ExchangeRecord {
  return {
    request_id: row.request_id,
    conversation_id: row.conversation_id,
    from: row.from_agent,
    to: row.to_agent,
    message: row.message,
    status: row.status as ExchangeStatus,
    answer: row.answer ?? undefined,
    error: row.error ?? undefined,
    started_at: new Date(row.started_at).getTime(),
    ended_at: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
  }
}

export function createPostgresStoreWithPool(pool: PoolLike): ExchangeStore {
  return {
    async insertStart(record) {
      await pool.query(
        `INSERT INTO hermes_bridge_exchanges
           (request_id, conversation_id, from_agent, to_agent, message, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
         ON CONFLICT (request_id) DO NOTHING`,
        [record.request_id, record.conversation_id, record.from, record.to, record.message, record.status, record.started_at],
      )
    },
    async updateEnd(record) {
      await pool.query(
        `UPDATE hermes_bridge_exchanges
         SET status = $2, answer = $3, error = $4, ended_at = to_timestamp($5 / 1000.0)
         WHERE request_id = $1`,
        [record.request_id, record.status, record.answer ?? null, record.error ?? null, record.ended_at ?? Date.now()],
      )
    },
    async recentExchanges(limit) {
      const { rows } = await pool.query(
        `SELECT * FROM hermes_bridge_exchanges ORDER BY started_at DESC LIMIT $1`,
        [limit],
      )
      // Stored/queried newest-first (for an efficient LIMIT); callers
      // (telemetry.ts, ui.ts) expect the same oldest-first order the
      // in-memory history has always returned.
      return rows.map(rowToRecord).reverse()
    },
    async shutdown() {
      await pool.end()
    },
  }
}

export async function createPostgresStore(config: DbConfig): Promise<ExchangeStore> {
  const pool = new Pool({ connectionString: config.connection_string })
  await pool.query(MIGRATE_SQL)
  return createPostgresStoreWithPool(pool)
}
