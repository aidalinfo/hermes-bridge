import { createHttpServer } from './http.js'
import { attachBridgeWs } from './bridge-ws.js'
import { AgentRegistry } from './registry.js'
import { ConversationStore } from './conversations.js'
import { loadConfig } from './config.js'

async function main(): Promise<void> {
  const configPath = process.env.HERMES_BRIDGE_CONFIG ?? './config.yaml'
  const port = Number(process.env.PORT ?? 8787)
  const config = loadConfig(configPath)

  const registry = new AgentRegistry(config.agents)
  const conversations = new ConversationStore(config.ask_timeout_ms)

  const httpServer = await createHttpServer({ registry, conversations })
  attachBridgeWs(httpServer, { registry, conversations })

  httpServer.listen(port, () => {
    console.log(`hermes-bridge listening on :${port}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
