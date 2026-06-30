import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, dump } from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the published package, dist/cli/install.js sits at <pkg>/dist/cli/, so the
// bundled adapter/ directory (declared in package.json "files") is two levels up.
const ADAPTER_SRC_DIR = join(__dirname, '..', '..', 'adapter')

export interface InstallOptions {
  token: string
  relayUrl: string
  dataDir?: string
}

export function runInstall(opts: InstallOptions): void {
  const dataDir = opts.dataDir ?? '/opt/data'
  const pluginDir = join(dataDir, '.hermes', 'plugins', 'hermes-bridge')
  mkdirSync(pluginDir, { recursive: true })
  cpSync(join(ADAPTER_SRC_DIR, 'plugin.yaml'), join(pluginDir, 'plugin.yaml'))
  cpSync(join(ADAPTER_SRC_DIR, 'adapter.py'), join(pluginDir, 'adapter.py'))
  cpSync(join(ADAPTER_SRC_DIR, 'wake.py'), join(pluginDir, 'wake.py'))

  mergeConfigYaml(join(dataDir, 'config.yaml'))
  mergeEnvFile(join(dataDir, '.env'), opts)
}

function mergeConfigYaml(configPath: string): void {
  const existing: Record<string, unknown> = existsSync(configPath)
    ? ((load(readFileSync(configPath, 'utf8')) as Record<string, unknown>) ?? {})
    : {}
  const plugins = (existing.plugins as Record<string, unknown>) ?? {}
  const enabled = Array.isArray(plugins.enabled) ? [...(plugins.enabled as string[])] : []
  if (!enabled.includes('hermes-bridge')) {
    enabled.push('hermes-bridge')
  }
  plugins.enabled = enabled
  existing.plugins = plugins
  writeFileSync(configPath, dump(existing))
}

function mergeEnvFile(envPath: string, opts: InstallOptions): void {
  const lines = existsSync(envPath)
    ? readFileSync(envPath, 'utf8').split('\n').filter((line) => line.length > 0)
    : []
  const upsert = (key: string, value: string): void => {
    const idx = lines.findIndex((line) => line.startsWith(`${key}=`))
    const entry = `${key}=${value}`
    if (idx >= 0) {
      lines[idx] = entry
    } else {
      lines.push(entry)
    }
  }
  upsert('HERMES_BRIDGE_TOKEN', opts.token)
  upsert('HERMES_BRIDGE_RELAY_URL', opts.relayUrl)
  writeFileSync(envPath, lines.join('\n') + '\n')
}
