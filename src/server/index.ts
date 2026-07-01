import { createHttpServer } from './http.js'
import { attachBridgeWs } from './bridge-ws.js'
import { AgentRegistry } from './registry.js'
import { ConversationStore } from './conversations.js'
import { createTelemetry } from './telemetry.js'
import { createPostgresStore, type ExchangeStore } from './db.js'
import { loadConfig } from './config.js'

async function main(): Promise<void> {
  const configPath = process.env.HERMES_BRIDGE_CONFIG ?? './config.yaml'
  const port = Number(process.env.PORT ?? 8787)
  const config = loadConfig(configPath)

  const registry = new AgentRegistry(config.agents)
  const conversations = new ConversationStore(config.ask_timeout_ms)

  // db mode: enabled by either `db.connection_string` in config.yaml or the
  // DATABASE_URL env var (preferred — keeps the connection string, which is
  // a secret, out of a file that tends to get committed). Only postgres is
  // implemented; `driver` exists for a future non-breaking extension.
  const connectionString = config.db?.connection_string ?? process.env.DATABASE_URL
  let store: ExchangeStore | undefined
  if (connectionString) {
    store = await createPostgresStore({ driver: 'postgres', connection_string: connectionString })
    console.log('hermes-bridge: db mode enabled (postgres) — exchange history is now durable across restarts')
  }

  const telemetry = createTelemetry(config.langfuse, store)

  const httpServer = await createHttpServer({ registry, conversations, telemetry })
  attachBridgeWs(httpServer, { registry, conversations })

  httpServer.listen(port, () => {
    console.log(`hermes-bridge listening on :${port}`)
  })

  const shutdown = async (): Promise<void> => {
    await telemetry.shutdown()
    httpServer.close(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
