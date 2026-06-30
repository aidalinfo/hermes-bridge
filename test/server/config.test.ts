import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/server/config.js'

describe('loadConfig', () => {
  it('parses agents and applies the default ask_timeout_ms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-bridge-'))
    const path = join(dir, 'config.yaml')
    writeFileSync(
      path,
      'agents:\n  - name: daniel-bot\n    token: tok-daniel\n  - name: helpdesk-bot\n    token: tok-helpdesk\n',
    )
    const config = loadConfig(path)
    expect(config.agents).toEqual([
      { name: 'daniel-bot', token: 'tok-daniel' },
      { name: 'helpdesk-bot', token: 'tok-helpdesk' },
    ])
    expect(config.ask_timeout_ms).toBe(120_000)
  })

  it('honors an explicit ask_timeout_ms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-bridge-'))
    const path = join(dir, 'config.yaml')
    writeFileSync(path, 'agents: []\nask_timeout_ms: 5000\n')
    expect(loadConfig(path).ask_timeout_ms).toBe(5000)
  })

  it('throws when an agent is missing a token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-bridge-'))
    const path = join(dir, 'config.yaml')
    writeFileSync(path, 'agents:\n  - name: daniel-bot\n')
    expect(() => loadConfig(path)).toThrow()
  })
})
