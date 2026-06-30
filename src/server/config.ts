import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { z } from 'zod'

const ConfigSchema = z.object({
  agents: z.array(z.object({ name: z.string(), token: z.string() })),
  ask_timeout_ms: z.number().int().positive().default(120_000),
})

export type BridgeConfig = z.infer<typeof ConfigSchema>

export function loadConfig(path: string): BridgeConfig {
  const raw = readFileSync(path, 'utf8')
  const parsed = load(raw)
  return ConfigSchema.parse(parsed)
}
