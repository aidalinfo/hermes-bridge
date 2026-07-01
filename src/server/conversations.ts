import { randomUUID } from 'node:crypto'

export interface PendingRequest {
  requestId: string
  conversationId: string
  to: string
  from: string
}

interface InternalPending extends PendingRequest {
  resolve: (answer: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class ConversationStore {
  private readonly pending = new Map<string, InternalPending>()
  private readonly knownConversations = new Set<string>()

  constructor(private readonly defaultTimeoutMs: number) {}

  createRequest(
    params: { to: string; from: string; conversationId?: string },
    timeoutMs: number = this.defaultTimeoutMs,
  ): { requestId: string; conversationId: string; promise: Promise<string> } {
    const requestId = randomUUID()
    const conversationId = params.conversationId ?? randomUUID()
    this.knownConversations.add(conversationId)
    const promise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('timeout'))
      }, timeoutMs)
      this.pending.set(requestId, {
        requestId,
        conversationId,
        to: params.to,
        from: params.from,
        resolve,
        reject,
        timer,
      })
    })
    return { requestId, conversationId, promise }
  }

  resolveRequest(requestId: string, answer: string): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    clearTimeout(entry.timer)
    this.pending.delete(requestId)
    entry.resolve(answer)
    return true
  }

  /**
   * Push out a pending request's deadline — called when the target agent's
   * adapter reports it's still actively working (post_tool_call /
   * post_llm_call hooks), so slow-but-alive answers aren't killed by a fixed
   * `ask_timeout_ms`. Re-arms the same timeout window from now; does nothing
   * (returns false) if the request already resolved or timed out.
   */
  extendRequest(requestId: string, timeoutMs: number = this.defaultTimeoutMs): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      this.pending.delete(requestId)
      entry.reject(new Error('timeout'))
    }, timeoutMs)
    return true
  }

  rejectAllTo(agentName: string, reason: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.to === agentName) {
        clearTimeout(entry.timer)
        this.pending.delete(requestId)
        entry.reject(new Error(reason))
      }
    }
  }

  hasConversation(conversationId: string): boolean {
    return this.knownConversations.has(conversationId)
  }

  get size(): number {
    return this.pending.size
  }
}
