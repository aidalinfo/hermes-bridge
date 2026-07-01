import { describe, it, expect, vi, beforeEach } from 'vitest'

const traceSpanMock = vi.fn()
const traceMock = vi.fn(() => ({ span: traceSpanMock }))
const shutdownAsyncMock = vi.fn().mockResolvedValue(undefined)

vi.mock('langfuse', () => ({
  Langfuse: vi.fn().mockImplementation(() => ({
    trace: traceMock,
    shutdownAsync: shutdownAsyncMock,
  })),
}))

import { createTelemetry } from '../../src/server/telemetry.js'
import type { ExchangeStore } from '../../src/server/db.js'
import { Langfuse } from 'langfuse'

const LangfuseMock = vi.mocked(Langfuse)

beforeEach(() => {
  LangfuseMock.mockImplementation(() => ({
    trace: traceMock,
    shutdownAsync: shutdownAsyncMock,
  }))
  traceMock.mockClear()
  traceSpanMock.mockClear()
  shutdownAsyncMock.mockClear()
})

describe('createTelemetry without config (no-op)', () => {
  it('records start and end without throwing, and without calling langfuse', () => {
    const telemetry = createTelemetry(undefined)
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    expect(record.status).toBe('pending')
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })
    expect(record.status).toBe('ok')
    expect(record.answer).toBe('42')
    expect(traceMock).not.toHaveBeenCalled()
  })

  it('caps history at maxHistory entries, oldest first out', async () => {
    const telemetry = createTelemetry(undefined, undefined, 2)
    for (let i = 0; i < 3; i++) {
      telemetry.recordStart({
        conversationId: `conv-${i}`,
        requestId: `req-${i}`,
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'hi',
      })
    }
    const exchanges = await telemetry.recentExchanges()
    expect(exchanges).toHaveLength(2)
    expect(exchanges.map((e) => e.request_id)).toEqual(['req-1', 'req-2'])
  })

  it('shutdown resolves without a configured client', async () => {
    const telemetry = createTelemetry(undefined)
    await expect(telemetry.shutdown()).resolves.toBeUndefined()
  })
})

describe('createTelemetry with langfuse config', () => {
  it('sends a span covering the full exchange once it ends', () => {
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })

    expect(traceMock).toHaveBeenCalledWith({ id: 'conv-1', name: 'hermes-conversation' })
    expect(traceSpanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'req-1',
        name: 'ask_agent',
        input: { from: 'daniel-bot', to: 'helpdesk-bot', message: 'hi' },
        output: { answer: '42' },
      }),
    )
  })

  it('sends the error as output when the exchange fails', () => {
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'timeout', error: 'timeout' })

    expect(traceSpanMock).toHaveBeenCalledWith(
      expect.objectContaining({ output: { error: 'timeout' } }),
    )
  })

  it('does not throw when the langfuse client errors', () => {
    traceMock.mockImplementationOnce(() => {
      throw new Error('network down')
    })
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    expect(() => telemetry.recordEnd(record, { status: 'ok', answer: '42' })).not.toThrow()
  })

  it('shutdown flushes the langfuse client', async () => {
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    await telemetry.shutdown()
    expect(shutdownAsyncMock).toHaveBeenCalled()
  })

  it('does not throw when the langfuse constructor throws', async () => {
    LangfuseMock.mockImplementationOnce(() => {
      throw new Error('constructor failed')
    })
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    expect(record.status).toBe('pending')
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })
    expect(record.status).toBe('ok')
    await expect(telemetry.recentExchanges()).resolves.toHaveLength(1)
    // Verify the instance fell back to no-op mode: trace mock should not have been called
    expect(traceMock).not.toHaveBeenCalled()
  })
})

function fakeStore(): ExchangeStore & { started: any[]; ended: any[] } {
  const started: any[] = []
  const ended: any[] = []
  const rows: any[] = []
  return {
    started,
    ended,
    async insertStart(record) {
      started.push(record)
      rows.push({ ...record })
    },
    async updateEnd(record) {
      ended.push(record)
      const row = rows.find((r) => r.request_id === record.request_id)
      if (row) Object.assign(row, record)
    },
    async recentExchanges() {
      return [...rows]
    },
    async shutdown() {},
  }
}

describe('createTelemetry with a db store', () => {
  it('persists recordStart/recordEnd to the store without blocking the caller', async () => {
    const store = fakeStore()
    const telemetry = createTelemetry(undefined, store)
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })
    // Fire-and-forget: give the microtask queue a turn to flush the writes.
    await new Promise((r) => setTimeout(r, 0))

    expect(store.started).toHaveLength(1)
    expect(store.ended).toHaveLength(1)
    expect(store.ended[0]).toEqual(expect.objectContaining({ request_id: 'req-1', status: 'ok', answer: '42' }))
  })

  it('recentExchanges reads from the store (durable) instead of the in-memory array', async () => {
    const store = fakeStore()
    const telemetry = createTelemetry(undefined, store)
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })
    await new Promise((r) => setTimeout(r, 0))

    await expect(telemetry.recentExchanges()).resolves.toEqual([
      expect.objectContaining({ request_id: 'req-1', status: 'ok', answer: '42' }),
    ])
  })

  it('falls back to in-memory history when the store read fails', async () => {
    const store = fakeStore()
    store.recentExchanges = async () => {
      throw new Error('db down')
    }
    const telemetry = createTelemetry(undefined, store)
    telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })

    await expect(telemetry.recentExchanges()).resolves.toEqual([
      expect.objectContaining({ request_id: 'req-1', status: 'pending' }),
    ])
  })

  it('shutdown closes the store', async () => {
    const store = fakeStore()
    const shutdownSpy = vi.spyOn(store, 'shutdown')
    const telemetry = createTelemetry(undefined, store)
    await telemetry.shutdown()
    expect(shutdownSpy).toHaveBeenCalledOnce()
  })
})
