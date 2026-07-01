import { describe, it, expect, vi } from 'vitest'
import { createPostgresStoreWithPool, type PoolLike } from '../../src/server/db.js'
import type { ExchangeRecord } from '../../src/server/telemetry.js'

// Exercises the SQL-shaping logic (params, ON CONFLICT, ordering/reversal)
// against a fake PoolLike instead of a real Postgres instance — no db
// service needed in CI. createPostgresStore() itself (Pool construction +
// migration) is a thin wrapper around this and is not separately unit-tested.
function fakePool(rows: any[] = []): PoolLike & { calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = []
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params })
      return { rows }
    },
    async end() {},
  }
}

const baseRecord: ExchangeRecord = {
  conversation_id: 'conv-1',
  request_id: 'req-1',
  from: 'daniel-bot',
  to: 'helpdesk-bot',
  message: 'hi',
  status: 'pending',
  started_at: 1_700_000_000_000,
}

describe('createPostgresStoreWithPool', () => {
  it('insertStart writes all fields with an ON CONFLICT DO NOTHING guard', async () => {
    const pool = fakePool()
    const store = createPostgresStoreWithPool(pool)
    await store.insertStart(baseRecord)

    expect(pool.calls).toHaveLength(1)
    expect(pool.calls[0].text).toContain('ON CONFLICT (request_id) DO NOTHING')
    expect(pool.calls[0].params).toEqual([
      'req-1',
      'conv-1',
      'daniel-bot',
      'helpdesk-bot',
      'hi',
      'pending',
      1_700_000_000_000,
    ])
  })

  it('updateEnd writes status/answer/error/ended_at keyed by request_id', async () => {
    const pool = fakePool()
    const store = createPostgresStoreWithPool(pool)
    const ended: ExchangeRecord = { ...baseRecord, status: 'ok', answer: '42', ended_at: 1_700_000_001_000 }
    await store.updateEnd(ended)

    expect(pool.calls[0].params).toEqual(['req-1', 'ok', '42', null, 1_700_000_001_000])
  })

  it('updateEnd falls back to null for a missing answer/error', async () => {
    const pool = fakePool()
    const store = createPostgresStoreWithPool(pool)
    await store.updateEnd({ ...baseRecord, status: 'timeout', error: 'timeout', ended_at: 1_700_000_002_000 })

    expect(pool.calls[0].params).toEqual(['req-1', 'timeout', null, 'timeout', 1_700_000_002_000])
  })

  it('recentExchanges queries newest-first (for LIMIT) but returns oldest-first (matching in-memory history)', async () => {
    const rows = [
      { request_id: 'req-3', conversation_id: 'c', from_agent: 'a', to_agent: 'b', message: 'm3', status: 'ok', answer: null, error: null, started_at: '2026-01-01T00:00:03Z', ended_at: null },
      { request_id: 'req-2', conversation_id: 'c', from_agent: 'a', to_agent: 'b', message: 'm2', status: 'ok', answer: null, error: null, started_at: '2026-01-01T00:00:02Z', ended_at: null },
      { request_id: 'req-1', conversation_id: 'c', from_agent: 'a', to_agent: 'b', message: 'm1', status: 'ok', answer: null, error: null, started_at: '2026-01-01T00:00:01Z', ended_at: null },
    ]
    const pool = fakePool(rows)
    const store = createPostgresStoreWithPool(pool)
    const result = await store.recentExchanges(3)

    expect(pool.calls[0].text).toContain('ORDER BY started_at DESC')
    expect(pool.calls[0].params).toEqual([3])
    expect(result.map((r) => r.request_id)).toEqual(['req-1', 'req-2', 'req-3'])
  })

  it('recentExchanges maps DB rows (from_agent/to_agent, timestamps) back to ExchangeRecord', async () => {
    const pool = fakePool([
      {
        request_id: 'req-1',
        conversation_id: 'conv-1',
        from_agent: 'daniel-bot',
        to_agent: 'helpdesk-bot',
        message: 'hi',
        status: 'ok',
        answer: '42',
        error: null,
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:01.000Z',
      },
    ])
    const store = createPostgresStoreWithPool(pool)
    const [record] = await store.recentExchanges(10)

    expect(record).toEqual({
      request_id: 'req-1',
      conversation_id: 'conv-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
      status: 'ok',
      answer: '42',
      error: undefined,
      started_at: new Date('2026-01-01T00:00:00.000Z').getTime(),
      ended_at: new Date('2026-01-01T00:00:01.000Z').getTime(),
    })
  })

  it('shutdown ends the pool', async () => {
    const pool = fakePool()
    const endSpy = vi.spyOn(pool, 'end')
    const store = createPostgresStoreWithPool(pool)
    await store.shutdown()
    expect(endSpy).toHaveBeenCalledOnce()
  })
})
