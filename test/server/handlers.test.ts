import { describe, it, expect } from 'vitest'
import { AgentRegistry } from '../../src/server/registry.js'
import { ConversationStore } from '../../src/server/conversations.js'
import { createTelemetry } from '../../src/server/telemetry.js'
import { handleAskAgent, handleReply, handleListAgents } from '../../src/server/handlers.js'

function setup(timeoutMs = 50) {
  const registry = new AgentRegistry([
    { name: 'daniel-bot', token: 'tok-daniel' },
    { name: 'helpdesk-bot', token: 'tok-helpdesk' },
  ])
  const conversations = new ConversationStore(timeoutMs)
  const telemetry = createTelemetry(undefined)
  return { registry, conversations, telemetry, deps: { registry, conversations, telemetry } }
}

describe('handleAskAgent', () => {
  it('returns unknown_agent for a target not in the registry', async () => {
    const { deps } = setup()
    const result = await handleAskAgent(deps, 'daniel-bot', { to: 'ghost-bot', message: 'hi' })
    expect(result).toEqual({ ok: false, error: 'unknown_agent' })
  })

  it('returns agent_offline when the target has no active connection', async () => {
    const { deps } = setup()
    const result = await handleAskAgent(deps, 'daniel-bot', { to: 'helpdesk-bot', message: 'hi' })
    expect(result).toEqual({ ok: false, error: 'agent_offline' })
  })

  it('resolves with the answer once reply is called for the delivered request', async () => {
    const { deps, registry } = setup()
    let delivered: { request_id: string } | undefined
    registry.setOnline('helpdesk-bot', (data) => {
      delivered = JSON.parse(data)
    })
    const pending = handleAskAgent(deps, 'daniel-bot', { to: 'helpdesk-bot', message: 'hi' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(delivered?.request_id).toBeDefined()
    const reply = handleReply(deps, { request_id: delivered!.request_id, answer: '42' })
    expect(reply).toEqual({ ok: true })
    await expect(pending).resolves.toEqual({
      ok: true,
      conversation_id: expect.any(String),
      answer: '42',
    })
  })

  it('returns timeout when no reply arrives in time', async () => {
    const { deps, registry } = setup()
    registry.setOnline('helpdesk-bot', () => {})
    const result = await handleAskAgent(deps, 'daniel-bot', { to: 'helpdesk-bot', message: 'hi' })
    expect(result).toEqual({ ok: false, error: 'timeout' })
  })

  it('returns unknown_conversation when conversation_id is provided but never seen', async () => {
    const { deps, registry } = setup()
    registry.setOnline('helpdesk-bot', () => {})
    const result = await handleAskAgent(deps, 'daniel-bot', {
      to: 'helpdesk-bot',
      message: 'hi',
      conversation_id: 'never-seen',
    })
    expect(result).toEqual({ ok: false, error: 'unknown_conversation' })
  })

  it('accepts a conversation_id that was returned by a previous ask_agent call', async () => {
    const { deps, registry } = setup()
    let delivered: { request_id: string; conversation_id: string } | undefined
    registry.setOnline('helpdesk-bot', (data) => {
      delivered = JSON.parse(data)
    })
    const first = handleAskAgent(deps, 'daniel-bot', { to: 'helpdesk-bot', message: 'first' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    handleReply(deps, { request_id: delivered!.request_id, answer: 'first-answer' })
    const firstResult = await first
    expect(firstResult.ok).toBe(true)
    const conversationId = (firstResult as { conversation_id: string }).conversation_id

    const second = handleAskAgent(deps, 'daniel-bot', {
      to: 'helpdesk-bot',
      message: 'follow-up',
      conversation_id: conversationId,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    handleReply(deps, { request_id: delivered!.request_id, answer: 'second-answer' })
    await expect(second).resolves.toEqual({
      ok: true,
      conversation_id: conversationId,
      answer: 'second-answer',
    })
  })

  it('records a completed exchange in telemetry once the reply arrives', async () => {
    const { deps, registry, telemetry } = setup()
    let delivered: { request_id: string } | undefined
    registry.setOnline('helpdesk-bot', (data) => {
      delivered = JSON.parse(data)
    })
    const pending = handleAskAgent(deps, 'daniel-bot', { to: 'helpdesk-bot', message: 'hi' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    handleReply(deps, { request_id: delivered!.request_id, answer: '42' })
    await pending

    const exchanges = await telemetry.recentExchanges()
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]).toEqual(
      expect.objectContaining({
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'hi',
        status: 'ok',
        answer: '42',
      }),
    )
  })
})

describe('handleReply', () => {
  it('returns unknown_request for an unknown request_id', () => {
    const { deps } = setup()
    expect(handleReply(deps, { request_id: 'ghost', answer: 'x' })).toEqual({
      ok: false,
      error: 'unknown_request',
    })
  })
})

describe('handleListAgents', () => {
  it('reports the online status of every registered agent', () => {
    const { deps, registry } = setup()
    registry.setOnline('daniel-bot', () => {})
    expect(handleListAgents(deps)).toEqual(
      expect.arrayContaining([
        { name: 'daniel-bot', online: true },
        { name: 'helpdesk-bot', online: false },
      ]),
    )
  })
})
