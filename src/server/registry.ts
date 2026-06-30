export interface AgentRecord {
  name: string
  token: string
}

type Sender = (data: string) => void

export class AgentRegistry {
  private readonly byToken = new Map<string, AgentRecord>()
  private readonly byName = new Map<string, AgentRecord>()
  private readonly online = new Map<string, Sender>()

  constructor(agents: AgentRecord[]) {
    for (const agent of agents) {
      this.byToken.set(agent.token, agent)
      this.byName.set(agent.name, agent)
    }
  }

  findByToken(token: string): AgentRecord | undefined {
    return this.byToken.get(token)
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  names(): string[] {
    return [...this.byName.keys()]
  }

  setOnline(name: string, send: Sender): void {
    this.online.set(name, send)
  }

  setOffline(name: string): void {
    this.online.delete(name)
  }

  isOnline(name: string): boolean {
    return this.online.has(name)
  }

  sendTo(name: string, payload: unknown): boolean {
    const send = this.online.get(name)
    if (!send) return false
    send(JSON.stringify(payload))
    return true
  }
}
