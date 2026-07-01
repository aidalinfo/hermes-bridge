import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { HandlerDeps } from './handlers.js'
import { buildMcpServer } from './mcp.js'
import { buildStateJson, renderUiPage } from './ui.js'

const MCP_PATH = '/mcp'
const UI_PATH = '/ui'
const UI_STATE_PATH = '/ui/api/state'

export async function createHttpServer(deps: HandlerDeps): Promise<Server> {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://localhost')

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (url.pathname === UI_PATH) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(renderUiPage())
      return
    }

    if (url.pathname === UI_STATE_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(buildStateJson(deps))
      return
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    const caller = deps.registry.findByToken(token)
    if (!caller) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    const mcpServer = buildMcpServer(deps, caller.name)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close().catch((err) => console.error('Error closing MCP transport:', err))
      mcpServer.close().catch((err) => console.error('Error closing MCP server:', err))
    })
    await mcpServer.connect(transport)
    await transport.handleRequest(req, res)
  })
}
