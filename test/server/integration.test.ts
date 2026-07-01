import { describe, it, expect, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import WebSocket from 'ws'
import { createHttpServer } from '../../src/server/http.js'
import { attachBridgeWs } from '../../src/server/bridge-ws.js'
import { AgentRegistry } from '../../src/server/registry.js'
import { ConversationStore } from '../../src/server/conversations.js'
import { createTelemetry } from '../../src/server/telemetry.js'

const AGENTS = [
  { name: 'daniel-bot', token: 'tok-daniel' },
  { name: 'helpdesk-bot', token: 'tok-helpdesk' },
]

async function startServer(timeoutMs = 5000) {
  const registry = new AgentRegistry(AGENTS)
  const conversations = new ConversationStore(timeoutMs)
  const telemetry = createTelemetry(undefined)
  const httpServer = await createHttpServer({ registry, conversations, telemetry })
  attachBridgeWs(httpServer, { registry, conversations })
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  return { httpServer, port }
}

function connectBot(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/connect`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

async function mcpClient(port: number, token: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

function payloadOf(result: { content: unknown }): any {
  const content = result.content as Array<{ text: string }>
  return JSON.parse(content[0].text)
}

describe('hermes-bridge end-to-end', () => {
  let httpServer: Server | undefined

  afterEach(() => {
    httpServer?.close()
  })

  it('delivers ask_agent to the woken bot and returns its reply', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const helpdeskWs = await connectBot(started.port, 'tok-helpdesk')
    helpdeskWs.on('message', async (raw) => {
      const wake = JSON.parse(raw.toString())
      const helpdeskClient = await mcpClient(started.port, 'tok-helpdesk')
      await helpdeskClient.callTool({
        name: 'reply',
        arguments: { request_id: wake.request_id, answer: 'pong' },
      })
    })

    const danielClient = await mcpClient(started.port, 'tok-daniel')
    const result = await danielClient.callTool({
      name: 'ask_agent',
      arguments: { to: 'helpdesk-bot', message: 'ping' },
    })
    expect(payloadOf(result)).toEqual({
      ok: true,
      conversation_id: expect.any(String),
      answer: 'pong',
    })
  })

  it('returns agent_offline immediately when the target has no connection', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const danielClient = await mcpClient(started.port, 'tok-daniel')
    const result = await danielClient.callTool({
      name: 'ask_agent',
      arguments: { to: 'helpdesk-bot', message: 'ping' },
    })
    expect(payloadOf(result)).toEqual({ ok: false, error: 'agent_offline' })
  })

  it('returns timeout when the woken bot never replies', async () => {
    const started = await startServer(30)
    httpServer = started.httpServer
    await connectBot(started.port, 'tok-helpdesk')
    const danielClient = await mcpClient(started.port, 'tok-daniel')
    const result = await danielClient.callTool({
      name: 'ask_agent',
      arguments: { to: 'helpdesk-bot', message: 'ping' },
    })
    expect(payloadOf(result)).toEqual({ ok: false, error: 'timeout' })
  })

  it('supports a sequential multi-turn exchange on the same conversation_id', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const helpdeskWs = await connectBot(started.port, 'tok-helpdesk')
    let turn = 0
    helpdeskWs.on('message', async (raw) => {
      turn += 1
      const wake = JSON.parse(raw.toString())
      const helpdeskClient = await mcpClient(started.port, 'tok-helpdesk')
      await helpdeskClient.callTool({
        name: 'reply',
        arguments: { request_id: wake.request_id, answer: `answer-${turn}` },
      })
    })

    const danielClient = await mcpClient(started.port, 'tok-daniel')
    const first = payloadOf(
      await danielClient.callTool({
        name: 'ask_agent',
        arguments: { to: 'helpdesk-bot', message: 'first question' },
      }),
    )
    expect(first.answer).toBe('answer-1')

    const second = payloadOf(
      await danielClient.callTool({
        name: 'ask_agent',
        arguments: {
          to: 'helpdesk-bot',
          message: 'follow-up question',
          conversation_id: first.conversation_id,
        },
      }),
    )
    expect(second.conversation_id).toBe(first.conversation_id)
    expect(second.answer).toBe('answer-2')
  })

  it('list_agents reports online status for both bots', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    await connectBot(started.port, 'tok-daniel')
    const client = await mcpClient(started.port, 'tok-daniel')
    const result = await client.callTool({ name: 'list_agents', arguments: {} })
    expect(payloadOf(result)).toEqual(
      expect.arrayContaining([
        { name: 'daniel-bot', online: true },
        { name: 'helpdesk-bot', online: false },
      ]),
    )
  })

  it('rejects an MCP call with an invalid token', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const response = await fetch(`http://127.0.0.1:${started.port}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(response.status).toBe(401)
  })

  it('serves the ui html page', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const response = await fetch(`http://127.0.0.1:${started.port}/ui`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('serves the ui state as json with agents and exchanges', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    await connectBot(started.port, 'tok-daniel')
    const helpdeskWs = await connectBot(started.port, 'tok-helpdesk')
    helpdeskWs.on('message', async (raw) => {
      const wake = JSON.parse(raw.toString())
      const helpdeskClient = await mcpClient(started.port, 'tok-helpdesk')
      await helpdeskClient.callTool({
        name: 'reply',
        arguments: { request_id: wake.request_id, answer: 'pong' },
      })
    })
    const danielClient = await mcpClient(started.port, 'tok-daniel')
    await danielClient.callTool({ name: 'ask_agent', arguments: { to: 'helpdesk-bot', message: 'ping' } })

    const response = await fetch(`http://127.0.0.1:${started.port}/ui/api/state`)
    const state = await response.json()
    expect(state.agents).toEqual(
      expect.arrayContaining([
        { name: 'daniel-bot', online: true },
        { name: 'helpdesk-bot', online: true },
      ]),
    )
    expect(state.exchanges).toEqual([
      expect.objectContaining({
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'ping',
        status: 'ok',
        answer: 'pong',
      }),
    ])
  })
})
