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

  it('caps history at maxHistory entries, oldest first out', () => {
    const telemetry = createTelemetry(undefined, 2)
    for (let i = 0; i < 3; i++) {
      telemetry.recordStart({
        conversationId: `conv-${i}`,
        requestId: `req-${i}`,
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'hi',
      })
    }
    const exchanges = telemetry.recentExchanges()
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

  it('does not throw when the langfuse constructor throws', () => {
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
    expect(telemetry.recentExchanges()).toHaveLength(1)
    // Verify the instance fell back to no-op mode: trace mock should not have been called
    expect(traceMock).not.toHaveBeenCalled()
  })
})
