import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { HandlerDeps } from './handlers.js'
import { handleAskAgent, handleReply, handleListAgents } from './handlers.js'

function textResult(value: unknown, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

export function buildMcpServer(deps: HandlerDeps, callerName: string): McpServer {
  const server = new McpServer({ name: 'hermes-bridge', version: '0.1.0' })

  server.registerTool(
    'ask_agent',
    {
      description:
        "Pose une question ou délègue une tâche à un autre agent Hermes connu du relais. Bloque jusqu'à la réponse ou le timeout.",
      inputSchema: {
        to: z.string().describe("Nom de l'agent cible"),
        message: z.string().describe('Question ou tâche à transmettre'),
        conversation_id: z
          .string()
          .optional()
          .describe('Identifiant de conversation existant, pour poursuivre un échange'),
      },
    },
    async (args: { to: string; message: string; conversation_id?: string }) => {
      const result = await handleAskAgent(deps, callerName, args)
      return textResult(result, !result.ok)
    },
  )

  server.registerTool(
    'reply',
    {
      description: 'Répond à une requête ask_agent en attente, identifiée par request_id.',
      inputSchema: {
        request_id: z.string(),
        answer: z.string(),
      },
    },
    async (args: { request_id: string; answer: string }) => {
      const result = handleReply(deps, args)
      return textResult(result, !result.ok)
    },
  )

  server.registerTool(
    'list_agents',
    {
      description: 'Liste les agents connus du relais et leur statut (online/offline).',
      inputSchema: {},
    },
    async () => textResult(handleListAgents(deps)),
  )

  return server
}
