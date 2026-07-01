import { Langfuse } from 'langfuse'

export type ExchangeStatus =
  | 'pending'
  | 'ok'
  | 'timeout'
  | 'agent_offline'
  | 'agent_disconnected'
  | 'unknown_agent'
  | 'unknown_conversation'

export interface ExchangeRecord {
  conversation_id: string
  request_id: string
  from: string
  to: string
  message: string
  status: ExchangeStatus
  answer?: string
  error?: string
  started_at: number
  ended_at?: number
}

export interface LangfuseConfig {
  public_key: string
  secret_key: string
  base_url?: string
}

export interface TelemetryRecorder {
  recordStart(params: {
    conversationId: string
    requestId: string
    from: string
    to: string
    message: string
  }): ExchangeRecord
  recordEnd(
    record: ExchangeRecord,
    result: { status: ExchangeStatus; answer?: string; error?: string },
  ): void
  recentExchanges(): ExchangeRecord[]
  shutdown(): Promise<void>
}

export function createTelemetry(config: LangfuseConfig | undefined, maxHistory = 200): TelemetryRecorder {
  const history: ExchangeRecord[] = []
  let warned = false
  const warnOnce = (err: unknown): void => {
    if (warned) return
    warned = true
    console.warn('hermes-bridge: langfuse export failed, continuing without telemetry export', err)
  }

  let langfuse: InstanceType<typeof Langfuse> | undefined
  if (config) {
    try {
      langfuse = new Langfuse({ publicKey: config.public_key, secretKey: config.secret_key, baseUrl: config.base_url })
    } catch (err) {
      warnOnce(err)
      langfuse = undefined
    }
  }

  return {
    recordStart(params) {
      const record: ExchangeRecord = {
        conversation_id: params.conversationId,
        request_id: params.requestId,
        from: params.from,
        to: params.to,
        message: params.message,
        status: 'pending',
        started_at: Date.now(),
      }
      history.push(record)
      if (history.length > maxHistory) history.shift()
      return record
    },
    recordEnd(record, result) {
      record.status = result.status
      record.answer = result.answer
      record.error = result.error
      record.ended_at = Date.now()

      if (!langfuse) return
      try {
        const trace = langfuse.trace({ id: record.conversation_id, name: 'hermes-conversation' })
        trace.span({
          id: record.request_id,
          name: 'ask_agent',
          input: { from: record.from, to: record.to, message: record.message },
          output: result.answer !== undefined ? { answer: result.answer } : { error: result.error },
          startTime: new Date(record.started_at),
          endTime: new Date(record.ended_at),
        })
      } catch (err) {
        warnOnce(err)
      }
    },
    recentExchanges() {
      return [...history]
    },
    async shutdown() {
      if (!langfuse) return
      try {
        await langfuse.shutdownAsync()
      } catch (err) {
        warnOnce(err)
      }
    },
  }
}
