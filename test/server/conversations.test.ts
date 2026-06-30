import { describe, it, expect } from 'vitest'
import { ConversationStore } from '../../src/server/conversations.js'

describe('ConversationStore', () => {
  it('resolves a pending request with the matching requestId', async () => {
    const store = new ConversationStore(5000)
    const { requestId, promise } = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    expect(store.resolveRequest(requestId, '42')).toBe(true)
    await expect(promise).resolves.toBe('42')
  })

  it('reuses the given conversationId across requests', () => {
    const store = new ConversationStore(5000)
    const first = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    const second = store.createRequest({
      to: 'daniel-bot',
      from: 'helpdesk-bot',
      conversationId: first.conversationId,
    })
    expect(second.conversationId).toBe(first.conversationId)
  })

  it('generates a fresh conversationId when none is given', () => {
    const store = new ConversationStore(5000)
    const first = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    const second = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    expect(first.conversationId).not.toBe(second.conversationId)
  })

  it('returns false when resolving an unknown requestId', () => {
    const store = new ConversationStore(5000)
    expect(store.resolveRequest('does-not-exist', 'x')).toBe(false)
  })

  it('rejects a request after the timeout elapses', async () => {
    const store = new ConversationStore(10)
    const { promise } = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    await expect(promise).rejects.toThrow('timeout')
  })

  it('a late resolveRequest after timeout is a no-op (returns false)', async () => {
    const store = new ConversationStore(10)
    const { requestId, promise } = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    await expect(promise).rejects.toThrow('timeout')
    expect(store.resolveRequest(requestId, 'too-late')).toBe(false)
  })

  it('rejectAllTo rejects only requests addressed to the given agent', async () => {
    const store = new ConversationStore(5000)
    const toHelpdesk = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    const toDaniel = store.createRequest({ to: 'daniel-bot', from: 'helpdesk-bot' })
    store.rejectAllTo('helpdesk-bot', 'agent_disconnected')
    await expect(toHelpdesk.promise).rejects.toThrow('agent_disconnected')
    expect(store.resolveRequest(toDaniel.requestId, 'ok')).toBe(true)
  })

  it('hasConversation is true for a conversationId seen via createRequest, false otherwise', () => {
    const store = new ConversationStore(5000)
    const { conversationId } = store.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    expect(store.hasConversation(conversationId)).toBe(true)
    expect(store.hasConversation('never-seen')).toBe(false)
  })
})
