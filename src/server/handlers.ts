import type { AgentRegistry } from './registry.js'
import type { ConversationStore } from './conversations.js'

export interface HandlerDeps {
  registry: AgentRegistry
  conversations: ConversationStore
}

export type AskAgentResult =
  | { ok: true; conversation_id: string; answer: string }
  | {
      ok: false
      error: 'unknown_agent' | 'unknown_conversation' | 'agent_offline' | 'timeout' | 'agent_disconnected'
    }

export async function handleAskAgent(
  deps: HandlerDeps,
  from: string,
  args: { to: string; message: string; conversation_id?: string },
): Promise<AskAgentResult> {
  const { registry, conversations } = deps
  if (!registry.has(args.to)) {
    return { ok: false, error: 'unknown_agent' }
  }
  if (!registry.isOnline(args.to)) {
    return { ok: false, error: 'agent_offline' }
  }
  if (args.conversation_id && !conversations.hasConversation(args.conversation_id)) {
    return { ok: false, error: 'unknown_conversation' }
  }
  const { requestId, conversationId, promise } = conversations.createRequest({
    to: args.to,
    from,
    conversationId: args.conversation_id,
  })
  const delivered = registry.sendTo(args.to, {
    request_id: requestId,
    conversation_id: conversationId,
    from,
    message: args.message,
  })
  if (!delivered) {
    return { ok: false, error: 'agent_offline' }
  }
  try {
    const answer = await promise
    return { ok: true, conversation_id: conversationId, answer }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'timeout'
    return { ok: false, error: reason as 'timeout' | 'agent_disconnected' }
  }
}

export type ReplyResult = { ok: true } | { ok: false; error: 'unknown_request' }

export function handleReply(
  deps: HandlerDeps,
  args: { request_id: string; answer: string },
): ReplyResult {
  const resolved = deps.conversations.resolveRequest(args.request_id, args.answer)
  return resolved ? { ok: true } : { ok: false, error: 'unknown_request' }
}

export interface AgentStatus {
  name: string
  online: boolean
}

export function handleListAgents(deps: HandlerDeps): AgentStatus[] {
  return deps.registry.names().map((name) => ({ name, online: deps.registry.isOnline(name) }))
}
