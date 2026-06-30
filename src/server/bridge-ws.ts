import { WebSocketServer, type WebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { AgentRegistry } from './registry.js'
import type { ConversationStore } from './conversations.js'

const BRIDGE_PATH = '/bridge/connect'

export function attachBridgeWs(
  httpServer: HttpServer,
  deps: { registry: AgentRegistry; conversations: ConversationStore },
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== BRIDGE_PATH) {
      socket.destroy()
      return
    }
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    const agent = deps.registry.findByToken(token)
    if (!agent) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, agent.name, deps)
    })
  })

  return wss
}

function onConnection(
  ws: WebSocket,
  agentName: string,
  deps: { registry: AgentRegistry; conversations: ConversationStore },
): void {
  deps.registry.setOnline(agentName, (data) => ws.send(data))

  ws.on('close', () => {
    deps.registry.setOffline(agentName)
    deps.conversations.rejectAllTo(agentName, 'agent_disconnected')
  })

  ws.on('error', () => {
    ws.close()
  })
}
