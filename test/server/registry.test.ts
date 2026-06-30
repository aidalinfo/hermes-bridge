import { describe, it, expect, vi } from 'vitest'
import { AgentRegistry } from '../../src/server/registry.js'

describe('AgentRegistry', () => {
  it('finds an agent by token', () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    expect(registry.findByToken('tok-daniel')?.name).toBe('daniel-bot')
    expect(registry.findByToken('wrong')).toBeUndefined()
  })

  it('reports has() for known and unknown names', () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    expect(registry.has('daniel-bot')).toBe(true)
    expect(registry.has('ghost-bot')).toBe(false)
    expect(registry.names()).toEqual(['daniel-bot'])
  })

  it('tracks online status via setOnline/setOffline', () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    expect(registry.isOnline('daniel-bot')).toBe(false)
    registry.setOnline('daniel-bot', vi.fn())
    expect(registry.isOnline('daniel-bot')).toBe(true)
    registry.setOffline('daniel-bot')
    expect(registry.isOnline('daniel-bot')).toBe(false)
  })

  it('sendTo delivers through the registered sender and returns false when offline', () => {
    const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
    expect(registry.sendTo('daniel-bot', { hello: 'world' })).toBe(false)
    const send = vi.fn()
    registry.setOnline('daniel-bot', send)
    expect(registry.sendTo('daniel-bot', { hello: 'world' })).toBe(true)
    expect(send).toHaveBeenCalledWith(JSON.stringify({ hello: 'world' }))
  })
})
