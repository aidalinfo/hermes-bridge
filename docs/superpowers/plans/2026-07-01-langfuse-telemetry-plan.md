# Langfuse Telemetry + Status UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send every `ask_agent` → `reply` exchange to an existing Langfuse instance as a span grouped by `conversation_id`, and serve a lightweight unauthenticated `/ui` page from the relay showing agent status and recent exchanges.

**Architecture:** A new `telemetry.ts` module owns both the in-memory recent-exchange buffer (used by the UI) and the optional Langfuse client (no-op if unconfigured). It is threaded through `HandlerDeps` and called from `handleAskAgent`, the single choke point that sees a full exchange (request + final outcome). A new `ui.ts` module renders the HTML page and the JSON state endpoint, wired into the existing `http.ts` request handler.

**Tech Stack:** TypeScript, Node.js `http`/`ws`, `@modelcontextprotocol/sdk`, `zod`, `vitest`, `langfuse` (new dependency, official Node SDK).

## Global Constraints

- No code comments unless documenting a non-obvious WHY (per project style already in the codebase — the existing files have none).
- No semicolons, single quotes, 2-space indent — match existing code style exactly (see `src/server/*.ts`).
- Telemetry (Langfuse) failures must never throw out of `handleAskAgent` or affect its return value.
- The `/ui` and `/ui/api/state` routes have **no authentication** (explicit decision — see spec's "Hors scope").
- The in-memory exchange buffer is capped (default 200 entries, FIFO) and is not persisted.
- Spec reference: `docs/superpowers/specs/2026-07-01-langfuse-telemetry-design.md`.

---

### Task 1: `telemetry.ts` — Langfuse export + in-memory exchange buffer

**Files:**
- Modify: `package.json` (add `langfuse` dependency)
- Create: `src/server/telemetry.ts`
- Test: `test/server/telemetry.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 4, 5, 6):
  - `export type ExchangeStatus = 'pending' | 'ok' | 'timeout' | 'agent_offline' | 'agent_disconnected' | 'unknown_agent' | 'unknown_conversation'`
  - `export interface ExchangeRecord { conversation_id: string; request_id: string; from: string; to: string; message: string; status: ExchangeStatus; answer?: string; error?: string; started_at: number; ended_at?: number }`
  - `export interface LangfuseConfig { public_key: string; secret_key: string; base_url?: string }`
  - `export interface TelemetryRecorder { recordStart(params: { conversationId: string; requestId: string; from: string; to: string; message: string }): ExchangeRecord; recordEnd(record: ExchangeRecord, result: { status: ExchangeStatus; answer?: string; error?: string }): void; recentExchanges(): ExchangeRecord[]; shutdown(): Promise<void> }`
  - `export function createTelemetry(config: LangfuseConfig | undefined, maxHistory = 200): TelemetryRecorder`

- [ ] **Step 1: Add the `langfuse` dependency**

Run: `npm install langfuse`

Expected: `package.json` gains `"langfuse": "^3.x.x"` under `dependencies`, `package-lock.json` updates.

- [ ] **Step 2: Write the failing test file**

Create `test/server/telemetry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const traceSpanMock = vi.fn()
const traceMock = vi.fn(() => ({ span: traceSpanMock }))
const shutdownAsyncMock = vi.fn().mockResolvedValue(undefined)

vi.mock('langfuse', () => ({
  Langfuse: vi.fn().mockImplementation(() => ({
    trace: traceMock,
    shutdownAsync: shutdownAsyncMock,
  })),
}))

import { createTelemetry } from '../../src/server/telemetry.js'

beforeEach(() => {
  traceMock.mockClear()
  traceSpanMock.mockClear()
  shutdownAsyncMock.mockClear()
})

describe('createTelemetry without config (no-op)', () => {
  it('records start and end without throwing, and without calling langfuse', () => {
    const telemetry = createTelemetry(undefined)
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    expect(record.status).toBe('pending')
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })
    expect(record.status).toBe('ok')
    expect(record.answer).toBe('42')
    expect(traceMock).not.toHaveBeenCalled()
  })

  it('caps history at maxHistory entries, oldest first out', () => {
    const telemetry = createTelemetry(undefined, 2)
    for (let i = 0; i < 3; i++) {
      telemetry.recordStart({
        conversationId: `conv-${i}`,
        requestId: `req-${i}`,
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'hi',
      })
    }
    const exchanges = telemetry.recentExchanges()
    expect(exchanges).toHaveLength(2)
    expect(exchanges.map((e) => e.request_id)).toEqual(['req-1', 'req-2'])
  })

  it('shutdown resolves without a configured client', async () => {
    const telemetry = createTelemetry(undefined)
    await expect(telemetry.shutdown()).resolves.toBeUndefined()
  })
})

describe('createTelemetry with langfuse config', () => {
  it('sends a span covering the full exchange once it ends', () => {
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })

    expect(traceMock).toHaveBeenCalledWith({ id: 'conv-1', name: 'hermes-conversation' })
    expect(traceSpanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'req-1',
        name: 'ask_agent',
        input: { from: 'daniel-bot', to: 'helpdesk-bot', message: 'hi' },
        output: { answer: '42' },
      }),
    )
  })

  it('sends the error as output when the exchange fails', () => {
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'timeout', error: 'timeout' })

    expect(traceSpanMock).toHaveBeenCalledWith(
      expect.objectContaining({ output: { error: 'timeout' } }),
    )
  })

  it('does not throw when the langfuse client errors', () => {
    traceMock.mockImplementationOnce(() => {
      throw new Error('network down')
    })
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    expect(() => telemetry.recordEnd(record, { status: 'ok', answer: '42' })).not.toThrow()
  })

  it('shutdown flushes the langfuse client', async () => {
    const telemetry = createTelemetry({ public_key: 'pk', secret_key: 'sk' })
    await telemetry.shutdown()
    expect(shutdownAsyncMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- telemetry`
Expected: FAIL — `Cannot find module '../../src/server/telemetry.js'`

- [ ] **Step 4: Implement `src/server/telemetry.ts`**

```ts
import { Langfuse } from 'langfuse'

export type ExchangeStatus =
  | 'pending'
  | 'ok'
  | 'timeout'
  | 'agent_offline'
  | 'agent_disconnected'
  | 'unknown_agent'
  | 'unknown_conversation'

export interface ExchangeRecord {
  conversation_id: string
  request_id: string
  from: string
  to: string
  message: string
  status: ExchangeStatus
  answer?: string
  error?: string
  started_at: number
  ended_at?: number
}

export interface LangfuseConfig {
  public_key: string
  secret_key: string
  base_url?: string
}

export interface TelemetryRecorder {
  recordStart(params: {
    conversationId: string
    requestId: string
    from: string
    to: string
    message: string
  }): ExchangeRecord
  recordEnd(
    record: ExchangeRecord,
    result: { status: ExchangeStatus; answer?: string; error?: string },
  ): void
  recentExchanges(): ExchangeRecord[]
  shutdown(): Promise<void>
}

export function createTelemetry(config: LangfuseConfig | undefined, maxHistory = 200): TelemetryRecorder {
  const history: ExchangeRecord[] = []
  const langfuse = config
    ? new Langfuse({ publicKey: config.public_key, secretKey: config.secret_key, baseUrl: config.base_url })
    : undefined

  let warned = false
  const warnOnce = (err: unknown): void => {
    if (warned) return
    warned = true
    console.warn('hermes-bridge: langfuse export failed, continuing without telemetry export', err)
  }

  return {
    recordStart(params) {
      const record: ExchangeRecord = {
        conversation_id: params.conversationId,
        request_id: params.requestId,
        from: params.from,
        to: params.to,
        message: params.message,
        status: 'pending',
        started_at: Date.now(),
      }
      history.push(record)
      if (history.length > maxHistory) history.shift()
      return record
    },
    recordEnd(record, result) {
      record.status = result.status
      record.answer = result.answer
      record.error = result.error
      record.ended_at = Date.now()

      if (!langfuse) return
      try {
        const trace = langfuse.trace({ id: record.conversation_id, name: 'hermes-conversation' })
        trace.span({
          id: record.request_id,
          name: 'ask_agent',
          input: { from: record.from, to: record.to, message: record.message },
          output: result.answer !== undefined ? { answer: result.answer } : { error: result.error },
          startTime: new Date(record.started_at),
          endTime: new Date(record.ended_at),
        })
      } catch (err) {
        warnOnce(err)
      }
    },
    recentExchanges() {
      return [...history]
    },
    async shutdown() {
      if (!langfuse) return
      try {
        await langfuse.shutdownAsync()
      } catch (err) {
        warnOnce(err)
      }
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- telemetry`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/telemetry.ts test/server/telemetry.test.ts
git commit -m "feat: add telemetry module with langfuse export and exchange buffer"
```

---

### Task 2: Wire telemetry into `handleAskAgent`

**Files:**
- Modify: `src/server/handlers.ts`
- Modify: `test/server/handlers.test.ts`

**Interfaces:**
- Consumes: `TelemetryRecorder`, `createTelemetry` from Task 1 (`src/server/telemetry.ts`).
- Produces: `HandlerDeps.telemetry: TelemetryRecorder` (consumed by Tasks 4, 5, 6).

- [ ] **Step 1: Write the failing test**

In `test/server/handlers.test.ts`, replace the imports and `setup()` function:

```ts
import { describe, it, expect } from 'vitest'
import { AgentRegistry } from '../../src/server/registry.js'
import { ConversationStore } from '../../src/server/conversations.js'
import { createTelemetry } from '../../src/server/telemetry.js'
import { handleAskAgent, handleReply, handleListAgents } from '../../src/server/handlers.js'

function setup(timeoutMs = 50) {
  const registry = new AgentRegistry([
    { name: 'daniel-bot', token: 'tok-daniel' },
    { name: 'helpdesk-bot', token: 'tok-helpdesk' },
  ])
  const conversations = new ConversationStore(timeoutMs)
  const telemetry = createTelemetry(undefined)
  return { registry, conversations, telemetry, deps: { registry, conversations, telemetry } }
}
```

Add a new test at the end of the `describe('handleAskAgent', ...)` block (after the last existing `it`, before the closing `})`):

```ts
  it('records a completed exchange in telemetry once the reply arrives', async () => {
    const { deps, registry, telemetry } = setup()
    let delivered: { request_id: string } | undefined
    registry.setOnline('helpdesk-bot', (data) => {
      delivered = JSON.parse(data)
    })
    const pending = handleAskAgent(deps, 'daniel-bot', { to: 'helpdesk-bot', message: 'hi' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    handleReply(deps, { request_id: delivered!.request_id, answer: '42' })
    await pending

    const exchanges = telemetry.recentExchanges()
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]).toEqual(
      expect.objectContaining({
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'hi',
        status: 'ok',
        answer: '42',
      }),
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- handlers`
Expected: FAIL — `deps` object is missing `telemetry`, so `handleAskAgent` throws `Cannot read properties of undefined (reading 'recordStart')`.

- [ ] **Step 3: Update `src/server/handlers.ts`**

Replace the top of the file (imports + `HandlerDeps`):

```ts
import type { AgentRegistry } from './registry.js'
import type { ConversationStore } from './conversations.js'
import type { TelemetryRecorder } from './telemetry.js'

export interface HandlerDeps {
  registry: AgentRegistry
  conversations: ConversationStore
  telemetry: TelemetryRecorder
}
```

Replace `handleAskAgent`:

```ts
export async function handleAskAgent(
  deps: HandlerDeps,
  from: string,
  args: { to: string; message: string; conversation_id?: string },
): Promise<AskAgentResult> {
  const { registry, conversations, telemetry } = deps
  if (!registry.has(args.to)) {
    return { ok: false, error: 'unknown_agent' }
  }
  if (!registry.isOnline(args.to)) {
    return { ok: false, error: 'agent_offline' }
  }
  if (args.conversation_id && !conversations.hasConversation(args.conversation_id)) {
    return { ok: false, error: 'unknown_conversation' }
  }
  const { requestId, conversationId, promise } = conversations.createRequest({
    to: args.to,
    from,
    conversationId: args.conversation_id,
  })
  const delivered = registry.sendTo(args.to, {
    request_id: requestId,
    conversation_id: conversationId,
    from,
    message: args.message,
  })
  if (!delivered) {
    return { ok: false, error: 'agent_offline' }
  }
  const record = telemetry.recordStart({
    conversationId,
    requestId,
    from,
    to: args.to,
    message: args.message,
  })
  try {
    const answer = await promise
    telemetry.recordEnd(record, { status: 'ok', answer })
    return { ok: true, conversation_id: conversationId, answer }
  } catch (err) {
    const reason = (err instanceof Error ? err.message : 'timeout') as 'timeout' | 'agent_disconnected'
    telemetry.recordEnd(record, { status: reason, error: reason })
    return { ok: false, error: reason }
  }
}
```

Leave `handleReply` and `handleListAgents` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- handlers`
Expected: PASS (all existing tests + the new one)

- [ ] **Step 5: Commit**

```bash
git add src/server/handlers.ts test/server/handlers.test.ts
git commit -m "feat: record ask_agent exchanges in telemetry"
```

---

### Task 3: `langfuse` config section

**Files:**
- Modify: `src/server/config.ts`
- Modify: `test/server/config.test.ts`

**Interfaces:**
- Produces: `BridgeConfig.langfuse?: { public_key: string; secret_key: string; base_url?: string }` (consumed by Task 6).

- [ ] **Step 1: Write the failing tests**

In `test/server/config.test.ts`, add these three `it` blocks inside `describe('loadConfig', ...)`, after the existing `it('throws when an agent is missing a token', ...)` block:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- config`
Expected: FAIL — `config.langfuse` is `undefined` in the first new test because the schema doesn't declare it yet (zod strips unknown keys silently, so the assertion fails rather than throwing).

- [ ] **Step 3: Update `src/server/config.ts`**

```ts
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { z } from 'zod'

const ConfigSchema = z.object({
  agents: z.array(z.object({ name: z.string(), token: z.string() })),
  ask_timeout_ms: z.number().int().positive().default(120_000),
  langfuse: z
    .object({
      public_key: z.string(),
      secret_key: z.string(),
      base_url: z.string().optional(),
    })
    .optional(),
})

export type BridgeConfig = z.infer<typeof ConfigSchema>

export function loadConfig(path: string): BridgeConfig {
  const raw = readFileSync(path, 'utf8')
  const parsed = load(raw)
  return ConfigSchema.parse(parsed)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- config`
Expected: PASS (all existing tests + the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts test/server/config.test.ts
git commit -m "feat: add optional langfuse config section"
```

---

### Task 4: `ui.ts` — state JSON + HTML page

**Files:**
- Create: `src/server/ui.ts`
- Test: `test/server/ui.test.ts`

**Interfaces:**
- Consumes: `HandlerDeps` (Task 2), `handleListAgents` (`src/server/handlers.ts`), `TelemetryRecorder.recentExchanges()` (Task 1).
- Produces (consumed by Task 5): `export function buildStateJson(deps: HandlerDeps): string`, `export function renderUiPage(): string`.

- [ ] **Step 1: Write the failing test**

Create `test/server/ui.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AgentRegistry } from '../../src/server/registry.js'
import { ConversationStore } from '../../src/server/conversations.js'
import { createTelemetry } from '../../src/server/telemetry.js'
import { buildStateJson, renderUiPage } from '../../src/server/ui.js'

function setup() {
  const registry = new AgentRegistry([{ name: 'daniel-bot', token: 'tok-daniel' }])
  const conversations = new ConversationStore(1000)
  const telemetry = createTelemetry(undefined)
  return { deps: { registry, conversations, telemetry }, telemetry }
}

describe('buildStateJson', () => {
  it('reports agents and recorded exchanges', () => {
    const { deps, telemetry } = setup()
    const record = telemetry.recordStart({
      conversationId: 'conv-1',
      requestId: 'req-1',
      from: 'daniel-bot',
      to: 'helpdesk-bot',
      message: 'hi',
    })
    telemetry.recordEnd(record, { status: 'ok', answer: '42' })

    const state = JSON.parse(buildStateJson(deps))
    expect(state.agents).toEqual([{ name: 'daniel-bot', online: false }])
    expect(state.exchanges).toEqual([
      expect.objectContaining({ conversation_id: 'conv-1', status: 'ok', answer: '42' }),
    ])
  })
})

describe('renderUiPage', () => {
  it('renders an html page that polls the state endpoint', () => {
    const html = renderUiPage()
    expect(html).toContain('<html')
    expect(html).toContain('/ui/api/state')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ui`
Expected: FAIL — `Cannot find module '../../src/server/ui.js'`

- [ ] **Step 3: Implement `src/server/ui.ts`**

```ts
import type { HandlerDeps } from './handlers.js'
import { handleListAgents } from './handlers.js'

export function buildStateJson(deps: HandlerDeps): string {
  return JSON.stringify({
    agents: handleListAgents(deps),
    exchanges: deps.telemetry.recentExchanges(),
  })
}

export function renderUiPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>hermes-bridge</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.2rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { text-align: left; padding: 0.4rem 0.8rem; border-bottom: 1px solid #ddd; font-size: 0.85rem; }
  .status-ok { color: #146c2e; }
  .status-pending { color: #8a6d00; }
  .status-error { color: #a4262c; }
  .online { color: #146c2e; }
  .offline { color: #a4262c; }
</style>
</head>
<body>
<h1>hermes-bridge</h1>
<h2>Agents</h2>
<table id="agents"><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody></tbody></table>
<h2>Recent exchanges</h2>
<table id="exchanges">
  <thead><tr><th>From</th><th>To</th><th>Message</th><th>Result</th><th>Status</th><th>Duration</th></tr></thead>
  <tbody></tbody>
</table>
<script>
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, (c) => map[c])
}
function statusClass(status) {
  if (status === 'ok') return 'status-ok'
  if (status === 'pending') return 'status-pending'
  return 'status-error'
}
async function refresh() {
  const res = await fetch('/ui/api/state')
  const state = await res.json()
  document.querySelector('#agents tbody').innerHTML = state.agents
    .map((a) => {
      const label = a.online ? 'online' : 'offline'
      return '<tr><td>' + escapeHtml(a.name) + '</td><td class="' + label + '">' + label + '</td></tr>'
    })
    .join('')
  document.querySelector('#exchanges tbody').innerHTML = state.exchanges
    .slice()
    .reverse()
    .map((e) => {
      const duration = e.ended_at ? (e.ended_at - e.started_at) + 'ms' : '-'
      const result = escapeHtml(e.answer ?? e.error ?? '-')
      return (
        '<tr><td>' + escapeHtml(e.from) + '</td><td>' + escapeHtml(e.to) + '</td><td>' +
        escapeHtml(e.message) + '</td><td>' + result + '</td><td class="' + statusClass(e.status) +
        '">' + escapeHtml(e.status) + '</td><td>' + duration + '</td></tr>'
      )
    })
    .join('')
}
refresh()
setInterval(refresh, 3000)
</script>
</body>
</html>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ui`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/ui.ts test/server/ui.test.ts
git commit -m "feat: add ui.ts rendering the status page and state endpoint"
```

---

### Task 5: Wire `/ui` routes into `http.ts` + integration tests

**Files:**
- Modify: `src/server/http.ts`
- Modify: `test/server/integration.test.ts`

**Interfaces:**
- Consumes: `buildStateJson`, `renderUiPage` (Task 4), `TelemetryRecorder`/`createTelemetry` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `test/server/integration.test.ts`, add the import and update `startServer`:

```ts
import { createTelemetry } from '../../src/server/telemetry.js'
```

Replace `startServer`:

```ts
async function startServer(timeoutMs = 5000) {
  const registry = new AgentRegistry(AGENTS)
  const conversations = new ConversationStore(timeoutMs)
  const telemetry = createTelemetry(undefined)
  const httpServer = await createHttpServer({ registry, conversations, telemetry })
  attachBridgeWs(httpServer, { registry, conversations })
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  return { httpServer, port }
}
```

Add two new tests at the end of `describe('hermes-bridge end-to-end', ...)`, before the closing `})`:

```ts
  it('serves the ui html page', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const response = await fetch(`http://127.0.0.1:${started.port}/ui`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('serves the ui state as json with agents and exchanges', async () => {
    const started = await startServer()
    httpServer = started.httpServer
    const helpdeskWs = await connectBot(started.port, 'tok-helpdesk')
    helpdeskWs.on('message', async (raw) => {
      const wake = JSON.parse(raw.toString())
      const helpdeskClient = await mcpClient(started.port, 'tok-helpdesk')
      await helpdeskClient.callTool({
        name: 'reply',
        arguments: { request_id: wake.request_id, answer: 'pong' },
      })
    })
    const danielClient = await mcpClient(started.port, 'tok-daniel')
    await danielClient.callTool({ name: 'ask_agent', arguments: { to: 'helpdesk-bot', message: 'ping' } })

    const response = await fetch(`http://127.0.0.1:${started.port}/ui/api/state`)
    const state = await response.json()
    expect(state.agents).toEqual(
      expect.arrayContaining([
        { name: 'daniel-bot', online: true },
        { name: 'helpdesk-bot', online: true },
      ]),
    )
    expect(state.exchanges).toEqual([
      expect.objectContaining({
        from: 'daniel-bot',
        to: 'helpdesk-bot',
        message: 'ping',
        status: 'ok',
        answer: 'pong',
      }),
    ])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- integration`
Expected: FAIL — `createHttpServer` call sites are missing `telemetry` (TypeScript error) and `/ui` routes return 404.

- [ ] **Step 3: Update `src/server/http.ts`**

```ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { HandlerDeps } from './handlers.js'
import { buildMcpServer } from './mcp.js'
import { buildStateJson, renderUiPage } from './ui.js'

const MCP_PATH = '/mcp'
const UI_PATH = '/ui'
const UI_STATE_PATH = '/ui/api/state'

export async function createHttpServer(deps: HandlerDeps): Promise<Server> {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://localhost')

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (url.pathname === UI_PATH) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(renderUiPage())
      return
    }

    if (url.pathname === UI_STATE_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(buildStateJson(deps))
      return
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    const caller = deps.registry.findByToken(token)
    if (!caller) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    const mcpServer = buildMcpServer(deps, caller.name)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close().catch((err) => console.error('Error closing MCP transport:', err))
      mcpServer.close().catch((err) => console.error('Error closing MCP server:', err))
    })
    await mcpServer.connect(transport)
    await transport.handleRequest(req, res)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- integration`
Expected: PASS (all existing tests + the 2 new ones)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all test files, no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/server/http.ts test/server/integration.test.ts
git commit -m "feat: serve /ui status page and /ui/api/state from the relay"
```

---

### Task 6: Construct telemetry in `index.ts` + graceful shutdown

**Files:**
- Modify: `src/server/index.ts`

**Interfaces:**
- Consumes: `createTelemetry` (Task 1), `BridgeConfig.langfuse` (Task 3), `HandlerDeps` (Task 2).

There is no existing test file for `index.ts` (it's the process entrypoint, exercised manually and via Docker). This task is verified by manual smoke test in Step 2.

- [ ] **Step 1: Update `src/server/index.ts`**

```ts
import { createHttpServer } from './http.js'
import { attachBridgeWs } from './bridge-ws.js'
import { AgentRegistry } from './registry.js'
import { ConversationStore } from './conversations.js'
import { createTelemetry } from './telemetry.js'
import { loadConfig } from './config.js'

async function main(): Promise<void> {
  const configPath = process.env.HERMES_BRIDGE_CONFIG ?? './config.yaml'
  const port = Number(process.env.PORT ?? 8787)
  const config = loadConfig(configPath)

  const registry = new AgentRegistry(config.agents)
  const conversations = new ConversationStore(config.ask_timeout_ms)
  const telemetry = createTelemetry(config.langfuse)

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
```

- [ ] **Step 2: Manual smoke test**

```bash
cp config.example.yaml /tmp/hermes-bridge-smoke.yaml
HERMES_BRIDGE_CONFIG=/tmp/hermes-bridge-smoke.yaml PORT=8799 npm run dev
```

In another terminal, while it's running:

```bash
curl -s http://localhost:8799/health
curl -s http://localhost:8799/ui/api/state
curl -s http://localhost:8799/ui | head -5
```

Expected: `/health` returns `{"status":"ok"}`, `/ui/api/state` returns `{"agents":[...],"exchanges":[]}`, `/ui` returns the HTML page starting with `<!doctype html>`.

Stop the server with `Ctrl+C` — it should exit cleanly (no hanging process, since `config.example.yaml` has no `langfuse` section, `telemetry.shutdown()` is a no-op).

- [ ] **Step 3: Run the full test suite once more**

Run: `npm test && npm run lint`
Expected: all tests PASS, `tsc --noEmit` reports no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: construct telemetry from config and flush it on shutdown"
```

---

### Task 7: Documentation

**Files:**
- Modify: `config.example.yaml`
- Modify: `README.md`

- [ ] **Step 1: Update `config.example.yaml`**

```yaml
agents:
  - name: daniel-bot
    token: change-me-daniel-token
  - name: helpdesk-bot
    token: change-me-helpdesk-token
ask_timeout_ms: 120000
# Optionnel : export des échanges vers une instance Langfuse existante,
# et active les données affichées par /ui.
# langfuse:
#   public_key: pk-lf-...
#   secret_key: sk-lf-...
#   base_url: https://cloud.langfuse.com
```

- [ ] **Step 2: Add an "Observabilité" section to `README.md`**

Insert this new section right after the "## Ajouter le relais aux `mcp_servers` du bot" section (before "## Développement"):

```markdown
## Observabilité

Chaque échange `ask_agent` → `reply` (ou timeout/déconnexion) peut être
exporté vers une instance [Langfuse](https://langfuse.com/) existante
(cloud ou self-hosted), regroupé par `conversation_id` — les échanges
multi-tours d'une même conversation apparaissent comme plusieurs spans
d'une seule trace :

```yaml
langfuse:
  public_key: pk-lf-...
  secret_key: sk-lf-...
  base_url: https://cloud.langfuse.com   # optionnel, défaut cloud Langfuse
```

Sans cette section, le relais fonctionne normalement sans appel réseau vers
Langfuse.

Le relais expose aussi une page `/ui` (ex: `http://<host-du-relais>:8787/ui`)
listant les agents connus et les échanges récents, rafraîchie automatiquement
toutes les 3 secondes. Cette page **n'est pas authentifiée** — si le relais
est exposé publiquement, mettez-la derrière un reverse-proxy protégé si vous
ne voulez pas qu'elle soit visible de tous.
```

- [ ] **Step 3: Commit**

```bash
git add config.example.yaml README.md
git commit -m "docs: document the langfuse config section and the /ui page"
```

---

### Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: every test file passes, no regressions.

- [ ] **Step 2: Type check**

Run: `npm run lint`
Expected: `tsc --noEmit` reports no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles cleanly into `dist/`, including `dist/server/telemetry.js` and `dist/server/ui.js`.

- [ ] **Step 4: Python adapter tests (unaffected, regression check)**

Run: `pytest adapter/test`
Expected: PASS (this feature doesn't touch the adapter).
