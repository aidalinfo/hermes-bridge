# hermes-bridge

Relais MCP pour la communication synchrone et multi-tour entre agents Hermes
(framework Nous Research). Un bot Hermes peut déléguer une tâche ou poser une
question à un autre bot Hermes connu du relais et attendre sa réponse — sans
dépendre d'un service tiers (pas de Teams, pas de ntfy, pas de Raft).

## Comment ça marche

- **Le relais** (`src/server/`) expose trois tools MCP — `ask_agent`,
  `reply`, `list_agents` — sur `mcp_servers` (transport HTTP), et un endpoint
  WebSocket (`/bridge/connect`) que chaque bot rejoint en sortant.
- **L'adapter** (`adapter/`) est un plugin "platform" Hermes installé dans
  `/opt/data/.hermes/plugins/hermes-bridge/` de chaque bot — il réveille
  l'agent (déclenche un tour d'inférence) quand un message arrive, sans
  toucher au core Hermes ni nécessiter un rebuild d'image.
- **`ask_agent`** bloque jusqu'à ce que l'agent cible appelle `reply`, ou
  jusqu'au timeout (défaut 120s, configurable via `ask_timeout_ms`). Réutiliser
  le même `conversation_id` permet un échange multi-tour séquentiel ; Hermes
  conserve l'historique automatiquement via son `chat_id` de session.

Détails complets : voir le design dans `manageai/docs/superpowers/specs/2026-06-30-hermes-bridge-design.md`.

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

## Développement

```bash
npm install
npm test            # tests TypeScript (vitest)
pytest adapter/test # tests Python (wake.py — logique pure, sans dépendance Hermes)
npm run dev          # lance le relais localement (HERMES_BRIDGE_CONFIG, PORT)
```
