import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import WebSocket from 'ws'
import { AgentRegistry } from '../../src/server/registry.js'
import { ConversationStore } from '../../src/server/conversations.js'
import { attachBridgeWs } from '../../src/server/bridge-ws.js'

describe('attachBridgeWs', () => {
  let httpServer: Server | undefined

  afterEach(() => {
    httpServer?.close()
  })

  function start(registry: AgentRegistry, conversations: ConversationStore): Promise<number> {
    httpServer = createServer()
    attachBridgeWs(httpServer, { registry, conversations })
    return new Promise((resolve) => {
      httpServer!.listen(0, () => {
        const address = httpServer!.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
  }

  it('marks the agent online on a valid token and offline on close', async () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    const conversations = new ConversationStore(1000)
    const port = await start(registry, conversations)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/connect`, {
      headers: { Authorization: 'Bearer tok-daniel' },
    })
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    expect(registry.isOnline('daniel-bot')).toBe(true)
    ws.close()
    await new Promise((resolve) => ws.on('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(registry.isOnline('daniel-bot')).toBe(false)
  })

  it('rejects the upgrade when the token is invalid', async () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    const conversations = new ConversationStore(1000)
    const port = await start(registry, conversations)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/connect`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const rejected = await new Promise<boolean>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode === 401))
      ws.on('error', () => resolve(true))
    })
    expect(rejected).toBe(true)
  })

  it('rejects pending requests addressed to an agent whose connection closes', async () => {
    const registry = new AgentRegistry([
      { name: 'daniel-bot', token: 'tok-daniel' },
      { name: 'helpdesk-bot', token: 'tok-helpdesk' },
    ])
    const conversations = new ConversationStore(5000)
    const port = await start(registry, conversations)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/connect`, {
      headers: { Authorization: 'Bearer tok-helpdesk' },
    })
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const { promise } = conversations.createRequest({ to: 'helpdesk-bot', from: 'daniel-bot' })
    ws.close()
    await expect(promise).rejects.toThrow('agent_disconnected')
  })

  it('a heartbeat frame from the bot extends its own pending request past the original timeout', async () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    const conversations = new ConversationStore(60)
    const port = await start(registry, conversations)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/connect`, {
      headers: { Authorization: 'Bearer tok-daniel' },
    })
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    const { requestId, promise } = conversations.createRequest({ to: 'daniel-bot', from: 'helpdesk-bot' })
    // Original deadline is at t=60ms. Heartbeat at t=40ms re-arms it to
    // t=40+60=100ms. Checking at t=80ms is past the original deadline but
    // still inside the extended one — proves the extend, not slack, saved it.
    await new Promise((r) => setTimeout(r, 40))
    ws.send(JSON.stringify({ type: 'heartbeat', request_id: requestId }))
    await new Promise((r) => setTimeout(r, 40))
    expect(conversations.resolveRequest(requestId, 'ok')).toBe(true)
    await expect(promise).resolves.toBe('ok')
    ws.close()
  })

  it('malformed or unrecognized inbound frames are ignored, not a connection error', async () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    const conversations = new ConversationStore(1000)
    const port = await start(registry, conversations)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/connect`, {
      headers: { Authorization: 'Bearer tok-daniel' },
    })
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    ws.send('not json')
    ws.send(JSON.stringify({ type: 'heartbeat', request_id: 'unknown-id' }))
    ws.send(JSON.stringify({ type: 'something-else' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(registry.isOnline('daniel-bot')).toBe(true)
    ws.close()
  })
})
