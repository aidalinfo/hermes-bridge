import { describe, it, expect } from 'vitest'
import { AgentRegistry } from '../../src/server/registry.js'
import { ConversationStore } from '../../src/server/conversations.js'
import { createTelemetry } from '../../src/server/telemetry.js'
import { buildStateJson, renderUiPage } from '../../src/server/ui.js'

function setup() {
  const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
  const conversations = new ConversationStore(1000)
  const telemetry = createTelemetry(undefined)
  return { deps: { registry, conversations, telemetry }, telemetry }
}

describe('buildStateJson', () => {
  it('reports agents and recorded exchanges', () => {
    const { deps, telemetry } = setup()
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })

    const state = JSON.parse(buildStateJson(deps))
    expect(state.agents).toEqual([{ name: 'daniel-bot', online: false }])
    expect(state.exchanges).toEqual([
      expect.objectContaining({ conversation_id: 'conv-1', status: 'ok', answer: '42' }),
    ])
  })
})

describe('renderUiPage', () => {
  it('renders an html page that polls the state endpoint', () => {
    const html = renderUiPage()
    expect(html).toContain('<html')
    expect(html).toContain('/ui/api/state')
  })

  it('renders the Agent Conversations layout (agents row, search/filter, exchanges list)', () => {
    const html = renderUiPage()
    expect(html).toContain('Conversations entre agents')
    expect(html).toContain('id="agents-row"')
    expect(html).toContain('id="search-input"')
    expect(html).toContain('id="agent-filter"')
    expect(html).toContain('id="exchanges-list"')
  })
})
