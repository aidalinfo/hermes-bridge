import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { runInstall } from '../../src/cli/install.js'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'hermes-bridge-data-'))
})

describe('runInstall', () => {
  it('copies the adapter files into plugins/hermes-bridge (Hermes user-plugin dir when HERMES_HOME=dataDir)', () => {
    runInstall({ token: 'tok-daniel', relayUrl: 'wss://relay.example/bridge/connect', dataDir })
    // NOT `.hermes/plugins/hermes-bridge` — Hermes' get_hermes_home() only
    // appends `.hermes` when HERMES_HOME is unset (native default: ~/.hermes).
    // The bot image sets HERMES_HOME=/opt/data explicitly, so the user-plugin
    // scan dir is `<dataDir>/plugins`, not `<dataDir>/.hermes/plugins`.
    const pluginDir = join(dataDir, 'plugins', 'hermes-bridge')
    expect(existsSync(join(pluginDir, 'plugin.yaml'))).toBe(true)
    expect(existsSync(join(pluginDir, '__init__.py'))).toBe(true)
    expect(existsSync(join(pluginDir, 'adapter.py'))).toBe(true)
    expect(existsSync(join(pluginDir, 'wake.py'))).toBe(true)
    expect(existsSync(join(dataDir, '.hermes', 'plugins', 'hermes-bridge'))).toBe(false)
  })

  it('adds hermes-bridge to plugins.enabled in config.yaml without duplicating it on a second run', () => {
    runInstall({ token: 'tok-daniel', relayUrl: 'wss://relay.example/bridge/connect', dataDir })
    runInstall({ token: 'tok-daniel', relayUrl: 'wss://relay.example/bridge/connect', dataDir })
    const config = load(readFileSync(join(dataDir, 'config.yaml'), 'utf8')) as {
      plugins: { enabled: string[] }
    }
    expect(config.plugins.enabled.filter((name) => name === 'hermes-bridge')).toHaveLength(1)
  })

  it('writes HERMES_BRIDGE_TOKEN and HERMES_BRIDGE_RELAY_URL into .env, upserting on re-run', () => {
    runInstall({ token: 'tok-daniel', relayUrl: 'wss://relay.example/bridge/connect', dataDir })
    runInstall({ token: 'tok-daniel-2', relayUrl: 'wss://relay.example/bridge/connect', dataDir })
    const env = readFileSync(join(dataDir, '.env'), 'utf8')
    const tokenLines = env.split('\n').filter((line) => line.startsWith('HERMES_BRIDGE_TOKEN='))
    expect(tokenLines).toEqual(['HERMES_BRIDGE_TOKEN=tok-daniel-2'])
    expect(env).toContain('HERMES_BRIDGE_RELAY_URL=wss://relay.example/bridge/connect')
  })
})
