# hermes-bridge

Relais MCP pour la communication synchrone et multi-tour entre agents Hermes
(framework Nous Research). Un bot Hermes peut déléguer une tâche ou poser une
question à un autre bot Hermes connu du relais et attendre sa réponse — sans
dépendre d'un service tiers (pas de Teams, pas de ntfy, pas de Raft).

## Architecture

```
  bot A (adapter)                    relais (src/server/)                  bot B (adapter)
  ──────────────                     ────────────────────                  ──────────────
  tool ask_agent(to=B,...) ───HTTP/MCP──▶ handleAskAgent                     
                                       │  registry.has(B)?
                                       │  ConversationStore.createRequest ── wake JSON ──WS──▶ _on_wake()
                                       │  (request_id, timer=ask_timeout_ms)                    │
                                       │                                                        │ tour d'inférence
                                       │                       ◀── heartbeat {request_id} ──WS── │ (post_tool_call/
                                       │  extendRequest (ré-arme le timer)                       │  post_llm_call)
                                       │                                                        │
                                       │  ◀── tool reply(request_id, answer) ───HTTP/MCP────────┘
  ask_agent() se résout ◀── answer ────┘  resolveRequest
```

- **Le relais** (`src/server/`) expose trois tools MCP — `ask_agent`,
  `reply`, `list_agents` — sur `mcp_servers` (transport HTTP), et un endpoint
  WebSocket (`/bridge/connect`) que chaque bot rejoint en sortant (jamais
  l'inverse : le relais n'a besoin d'aucun accès réseau vers les bots).
- **L'adapter** (`adapter/`) est un plugin "platform" Hermes installé dans
  `/opt/data/plugins/hermes-bridge/` de chaque bot — il réveille
  l'agent (déclenche un tour d'inférence) quand un message arrive, sans
  toucher au core Hermes ni nécessiter un rebuild d'image.
  - ⚠️ Le chemin compte : c'est `<HERMES_HOME>/plugins/<name>/`, **pas**
    `<HERMES_HOME>/.hermes/plugins/<name>/`. `get_hermes_home()` (Hermes)
    n'ajoute `.hermes` que quand `HERMES_HOME` est *absent* (défaut natif
    `~/.hermes`) — l'image Docker des bots fixe `HERMES_HOME=/opt/data`
    explicitement, donc le dossier de scan réel est `/opt/data/plugins`.
    `npx @aidalinfo/hermes-bridge install` gère ça correctement depuis la
    0.1.1 ; si un bot a été installé avant, relancer `install` pour corriger
    l'emplacement, puis redémarrer le conteneur.
- **`ask_agent`** bloque jusqu'à ce que l'agent cible appelle `reply`, ou
  jusqu'au timeout (défaut 120s, configurable via `ask_timeout_ms`). Réutiliser
  le même `conversation_id` permet un échange multi-tour séquentiel ; Hermes
  conserve l'historique automatiquement via son `chat_id` de session.
- **Timeout intelligent (heartbeat)** : `ask_timeout_ms` n'est qu'un filet de
  sécurité contre un agent réellement bloqué/planté, pas une estimation à
  deviner pour les réponses lentes (plusieurs tool calls, lookup mémoire…).
  L'adapter de l'agent **cible** s'abonne aux hooks Hermes `pre_llm_call` /
  `post_tool_call` / `post_llm_call` (les mêmes points d'extension que le
  statut « busy » natif de Hermes, et le même pattern que l'adapter `raft`
  bundlé). Tant que la session ouverte par le wake est active, l'adapter
  envoie une frame `{"type":"heartbeat","request_id":"..."}` sur la **même
  connexion WebSocket sortante** (pas un nouveau canal), throttlée à 1 toutes
  les 5s par session. Le relais (`ConversationStore.extendRequest`) ré-arme
  alors le timer de ce `request_id` pour une fenêtre complète. `on_session_end`
  nettoie le suivi quand le tour se termine. Résultat : le délai ne compte
  vraiment que si l'agent s'est *arrêté* de travailler, pas s'il est juste lent.
  - ⚠️ **Le point piégeux** : les hooks Hermes exposent `session_id =
    agent.session_id`, un identifiant généré à chaque run d'agent
    (`f"{timestamp}_{uuid}"`) — **sans aucun rapport** avec la clé de session
    que l'adapter calcule lui-même pour le routage
    (`gateway.session.build_session_key`, utilisée pour la queue de wakes,
    jamais exposée aux hooks). Impossible donc de précalculer la
    correspondance `session_id → request_id` au moment du wake. La solution :
    `wake.build_wake_text()` embarque déjà `request_id=<id>` en clair dans le
    texte injecté ; le hook `pre_llm_call` (seul à fournir à la fois
    `session_id` et `user_message`) relit cet identifiant dans le texte
    (`wake.extract_request_id`) et fixe la correspondance à ce moment précis —
    les `post_tool_call`/`post_llm_call` suivants du même run la réutilisent.
    Autre piège du même hook : `platform` y est le membre d'enum
    `gateway.config.Platform` (pas une chaîne) — `platform_value()` le
    déballe avant toute comparaison, sans quoi le filtre `== "hermes-bridge"`
    est toujours faux. Sans ces deux corrections, le heartbeat ne se déclenche
    *jamais* (échec silencieux — aucune erreur, juste des frames qui ne
    partent jamais), et `ask_timeout_ms` reste un mur fixe malgré un adapter
    et un relais à jour.
  - ⚠️ Ce mécanisme est **entièrement côté adapter + relais** — aucune action
    requise de l'agent/LLM cible (il ne « sait » même pas que ça existe).
  - ⚠️ **Le relais doit être redéployé** pour que le heartbeat fonctionne :
    publier une nouvelle version npm de l'adapter ne suffit pas, le serveur
    (`src/server/bridge-ws.ts` + `conversations.ts`) doit tourner avec le code
    à jour pour comprendre les frames `heartbeat`.

Détails de conception complets : voir `manageai/docs/superpowers/specs/2026-06-30-hermes-bridge-design.md`.

## Déployer le relais

```bash
docker build -t hermes-bridge .
docker run -d -p 8787:8787 -v $(pwd)/config.yaml:/app/config.yaml:ro hermes-bridge
```

`config.yaml` (voir `config.example.yaml`) :

```yaml
agents:
  - name: daniel-bot
    token: <token-secret-par-bot>
  - name: helpdesk-bot
    token: <token-secret-par-bot>
ask_timeout_ms: 120000
```

## Installer l'adapter sur un bot

```bash
docker exec -it -u hermes <bot> npx @aidalinfo/hermes-bridge install \
  --token=<token-du-bot> \
  --relay-url=wss://<host-du-relais>/bridge/connect
```

Puis redémarrer le conteneur du bot pour charger le plugin.

## Ajouter le relais aux `mcp_servers` du bot

```yaml
mcp_servers:
  hermes-bridge:
    enabled: true
    transport: http
    url: https://<host-du-relais>/mcp
    headers:
      Authorization: Bearer ${HERMES_BRIDGE_TOKEN}
    access_mode: read_write
```

## Persistance (mode db)

Par défaut, l'historique des échanges vit en mémoire (`maxHistory=200`,
`telemetry.ts`) et **disparaît à chaque redémarrage du relais** — y compris
un redeploy Coolify normal sur push. Pour une traçabilité durable (audit,
« qu'est-ce que daniel-bot a répondu à helpdesk-bot mardi dernier ? »),
configurez une base — seul postgres est implémenté, et c'est le driver par
défaut :

```yaml
db:
  driver: postgres              # défaut si omis
  connection_string: postgresql://user:pass@host:5432/hermes_bridge
```

`connection_string` peut aussi venir de la variable d'env `DATABASE_URL`
(recommandé — évite de committer un secret dans `config.yaml` ; dans ce cas
le bloc `db:` peut être omis entièrement). Le mode db s'active dès que
`config.db.connection_string` **ou** `DATABASE_URL` est renseigné.

Ce que ça change concrètement :

- La table `hermes_bridge_exchanges` est créée automatiquement au démarrage
  (`src/server/db.ts`, `CREATE TABLE IF NOT EXISTS`) — aucune migration
  manuelle.
- Chaque `recordStart`/`recordEnd` écrit dans la base **en plus** de la
  mémoire, en fire-and-forget (comme l'export Langfuse existant) : une
  panne db ne bloque jamais un `ask_agent`/`reply`, juste un `console.warn`
  (throttlé à une fois).
- **`/ui` et `/ui/api/state` lisent depuis la base** quand le mode db est
  actif (pas depuis la mémoire) — c'est ce qui les rend durables : le flux
  affiché après un redémarrage n'est plus vide, il reprend l'historique.
  En cas d'échec de lecture db, repli silencieux sur la mémoire (mieux
  vaut un historique tronqué qu'une page cassée).
- Sans `db` configuré, comportement strictement inchangé (mémoire
  uniquement, comme avant cette fonctionnalité).

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
Langfuse. Langfuse et le mode db sont indépendants — Langfuse pour tracer
en externe, le mode db pour l'audit local/`/ui` durable — activables
séparément ou ensemble.

Le relais expose aussi une page `/ui` (ex: `http://<host-du-relais>:8787/ui`),
**« Conversations entre agents »** — layout et styles Forma importés du
projet Claude Design
[`Visualiser les conversations d'agents`](https://claude.ai/design/p/2463da63-90c9-4f82-9afd-d2011605f90c?file=Agent+Conversations.dc.html)
(voir `src/server/ui.ts`, réimplémenté en HTML/JS sans dépendance, branché sur
les vraies données au lieu des exemples du prototype) :

- Un badge par agent connu (en ligne / hors ligne, point de couleur), rangée
  du haut.
- Une recherche texte (message + réponse/erreur) et un filtre par agent.
- Un flux des échanges les plus récents en premier, chacun avec `from → to`,
  durée, badge de statut (`ok`, `timeout`, `agent hors ligne`,
  `agent déconnecté`, `agent inconnu`, `conversation inconnue`, `en cours`),
  message tronqué à 180 caractères avec un bouton **Voir plus/moins** qui
  révèle la réponse (ou « En attente de réponse… » tant que c'est `pending`).
- Rafraîchissement automatique (`fetch('/ui/api/state')` toutes les 3s) sans
  perdre la recherche/le filtre/les échanges dépliés en cours.

Cette page **n'est pas authentifiée** — elle affiche le contenu intégral des
messages/réponses. Si le relais est exposé au-delà d'un LAN de confiance,
mettez-la derrière un reverse-proxy protégé.

## Développement

```bash
npm install
npm test            # tests TypeScript (vitest)
pytest adapter/test # tests Python (wake.py — logique pure, sans dépendance Hermes)
npm run dev          # lance le relais localement (HERMES_BRIDGE_CONFIG, PORT)
```
