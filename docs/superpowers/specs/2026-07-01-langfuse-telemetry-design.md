# Télémétrie Langfuse + UI de suivi — design

## Contexte

`hermes-bridge` relaie des échanges `ask_agent` / `reply` entre bots Hermes.
Le relais lui-même n'appelle aucun LLM : il ne voit que le texte des messages
qui transitent, pas les détails d'inférence (tokens, modèle) qui restent côté
bots. Le besoin est de pouvoir observer ces échanges dans Langfuse (instance
existante, cloud ou self-hosted, clés API déjà disponibles) et d'avoir un
aperçu rapide sans ouvrir Langfuse.

## Objectifs

- Envoyer chaque échange `ask_agent` → `reply` (ou timeout / déconnexion) vers
  Langfuse comme un span, regroupé par `conversation_id` pour les échanges
  multi-tours.
- Fournir une page web servie par le relais lui-même listant les agents
  connus et les échanges récents/en cours, sans dépendre de Langfuse.
- Zéro impact sur la latence ou la fiabilité du relais si Langfuse est
  indisponible ou non configuré.

## Point d'intégration

`handleAskAgent` (`src/server/handlers.ts`) est le seul endroit qui voit le
cycle complet d'un échange : l'appel `ask_agent` entrant, l'envoi au bot
cible, et soit la réponse (`reply`), soit une erreur (`timeout`,
`agent_disconnected`, `agent_offline`, ...). C'est le seul point
d'instrumentation nécessaire — pas besoin de toucher `mcp.ts` ni
`bridge-ws.ts`, qui ne voient chacun qu'une moitié du cycle.

## Composants

### `src/server/telemetry.ts` (nouveau)

```ts
export interface LangfuseConfig {
  public_key: string
  secret_key: string
  base_url?: string
}

export interface ExchangeRecord {
  conversation_id: string
  request_id: string
  from: string
  to: string
  message: string
  status: 'pending' | 'ok' | 'timeout' | 'agent_offline' | 'agent_disconnected' | 'unknown_agent' | 'unknown_conversation'
  answer?: string
  error?: string
  started_at: number
  ended_at?: number
}

export interface TelemetryRecorder {
  recordStart(params: { conversationId: string; requestId: string; from: string; to: string; message: string }): ExchangeRecord
  recordEnd(record: ExchangeRecord, result: { status: ExchangeRecord['status']; answer?: string; error?: string }): void
  recentExchanges(): ExchangeRecord[]
  shutdown(): Promise<void>
}

export function createTelemetry(config: LangfuseConfig | undefined, maxHistory = 200): TelemetryRecorder
```

- `recordStart` pousse un `ExchangeRecord` (statut `pending`) dans un buffer
  mémoire borné (`maxHistory`, FIFO) et le retourne. Ce buffer existe
  **toujours**, même sans Langfuse configuré — c'est la source de données de
  l'UI.
- `recordEnd` met à jour l'objet `record` en place (statut final, réponse ou
  erreur, `ended_at`), puis, si Langfuse est configuré, envoie un span :
  ```ts
  langfuse
    .trace({ id: conversationId, name: 'hermes-conversation' })
    .span({
      id: requestId,
      name: 'ask_agent',
      input: { from, to, message },
      output: result.answer ? { answer: result.answer } : { error: result.error },
      startTime: new Date(record.started_at),
      endTime: new Date(record.ended_at),
    })
  ```
  Toute erreur d'envoi (réseau, auth) est capturée en `try/catch` +
  `.catch()`, loggée une fois via `console.warn`, et n'affecte jamais la
  valeur retournée par `handleAskAgent`.
- Sans config Langfuse, `recordEnd` ne fait que mettre à jour le buffer — pas
  d'appel réseau.
- `shutdown()` appelle `langfuse.shutdownAsync()` si le client existe (no-op
  sinon), pour flush les derniers événements à l'arrêt du process.

### Câblage dans `handlers.ts` / `HandlerDeps`

- `HandlerDeps` gagne un champ `telemetry: TelemetryRecorder`.
- `handleAskAgent` :
  ```ts
  const record = deps.telemetry.recordStart({ conversationId, requestId, from, to: args.to, message: args.message })
  try {
    const answer = await promise
    deps.telemetry.recordEnd(record, { status: 'ok', answer })
    return { ok: true, conversation_id: conversationId, answer }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'timeout'
    deps.telemetry.recordEnd(record, { status: reason as ExchangeRecord['status'], error: reason })
    return { ok: false, error: reason as 'timeout' | 'agent_disconnected' }
  }
  ```
- Les retours anticipés (`unknown_agent`, `agent_offline`, `unknown_conversation`
  avant la création de la requête) ne passent pas par `recordStart` — ce sont
  des rejets immédiats, pas des échanges ; ils n'apparaissent pas dans l'UI ni
  Langfuse. C'est cohérent avec « voir les conversations », pas « logger tous
  les appels ».

### `src/server/ui.ts` (nouveau)

- `buildStateJson(deps: HandlerDeps): string` → sérialise
  `{ agents: handleListAgents(deps), exchanges: deps.telemetry.recentExchanges() }`.
- `renderUiPage(): string` → une page HTML unique, CSS inline minimal, un
  `<script>` vanilla JS qui `fetch('/ui/api/state')` toutes les 3s et
  remplit deux tables (agents / échanges récents, avec un badge de couleur
  par statut). Aucune dépendance externe (pas de CDN — cohérent avec l'esprit
  « pas de service tiers » du projet).

### Câblage dans `http.ts`

Deux routes ajoutées dans le handler existant, avant le `404` :

```ts
if (url.pathname === '/ui') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(renderUiPage()); return }
if (url.pathname === '/ui/api/state') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(buildStateJson(deps)); return }
```

Pas d'authentification sur ces deux routes (choix explicite). À noter dans le
README : si le relais est exposé publiquement sans reverse-proxy dédié, cette
page est lisible par quiconque a l'URL.

### Config (`src/server/config.ts`)

```ts
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
```

### `index.ts`

- `const telemetry = createTelemetry(config.langfuse)`.
- `telemetry` ajouté à `HandlerDeps` transmis à `createHttpServer` et
  `attachBridgeWs` (ce dernier n'en a pas besoin directement mais
  `HandlerDeps` reste le seul objet de deps partagé).
- `process.on('SIGTERM', ...)` / `SIGINT` → `await telemetry.shutdown()` puis
  `httpServer.close()`.

## Dépendances

- Ajout de `langfuse` (SDK Node officiel) aux `dependencies` de
  `package.json`.

## Gestion d'erreurs

- Aucune erreur Langfuse ne doit se propager jusqu'à `handleAskAgent` ni
  jusqu'au client MCP appelant.
- Le buffer mémoire de l'UI n'a pas de persistance : un restart du relais le
  vide. Langfuse reste la source de vérité durable.

## Tests

- `test/server/telemetry.test.ts` :
  - mode no-op (pas de config) : `recordStart`/`recordEnd` ne lèvent pas,
    `recentExchanges()` renvoie l'historique attendu.
  - le buffer plafonne à `maxHistory` entrées (FIFO).
  - avec un client Langfuse mocké (injecté ou module mocké via `vi.mock`),
    vérifier que `trace().span()` est appelé avec les bons `id`/`input`/`output`.
- `test/server/handlers.test.ts` : `setup()` construit désormais un
  `TelemetryRecorder` no-op réel (`createTelemetry(undefined)`) plutôt qu'un
  objet `deps` partiel, pour rester aligné avec `HandlerDeps`.
- `test/server/ui.test.ts` : `buildStateJson` renvoie la forme attendue
  (agents + exchanges) à partir de deps de test.

## Hors scope

- Authentification de l'UI (explicitement refusée pour cette itération).
- Tracing des appels LLM internes aux bots Hermes (hors de portée du relais).
- Persistance de l'historique des échanges au-delà du buffer mémoire.
