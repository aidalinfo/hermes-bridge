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

  it('parses an optional langfuse section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-bridge-'))
    const path = join(dir, 'config.yaml')
    writeFileSync(
      path,
      'agents: []\nlangfuse:\n  public_key: pk-test\n  secret_key: sk-test\n  base_url: https://langfuse.example.com\n',
    )
    const config = loadConfig(path)
    expect(config.langfuse).toEqual({
      public_key: 'pk-test',
      secret_key: 'sk-test',
      base_url: 'https://langfuse.example.com',
    })
  })

  it('leaves langfuse undefined when omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-bridge-'))
    const path = join(dir, 'config.yaml')
    writeFileSync(path, 'agents: []\n')
    expect(loadConfig(path).langfuse).toBeUndefined()
  })

  it('throws when langfuse is present but missing secret_key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-bridge-'))
    const path = join(dir, 'config.yaml')
    writeFileSync(path, 'agents: []\nlangfuse:\n  public_key: pk-test\n')
    expect(() => loadConfig(path)).toThrow()
  })
})
