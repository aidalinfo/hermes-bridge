import type { HandlerDeps } from './handlers.js'
import { handleListAgents } from './handlers.js'

export function buildStateJson(deps: HandlerDeps): string {
  return JSON.stringify({
    agents: handleListAgents(deps),
    exchanges: deps.telemetry.recentExchanges(),
  })
}

// "Agent Conversations" — imported from the Claude Design project
// https://claude.ai/design/p/2463da63-90c9-4f82-9afd-d2011605f90c (Forma design
// system tokens: colors/typography/spacing/shadows). The design's prototype used
// its own component runtime (x-dc/sc-for/sc-if + a Forma JSX bundle); this is a
// plain-HTML/vanilla-JS re-implementation of the same layout and Forma component
// styles (Card/Badge/Input/Select/Button), wired to the real /ui/api/state feed
// instead of the design's mock exchanges.
export function renderUiPage(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hermes-bridge — Conversations entre agents</title>
<style>
  /* Forma tokens actually used here (see tokens/*.css in the design project) —
     inlined rather than @imported so this page has zero external dependencies. */
  :root {
    --stone-50:#fafaf9; --stone-100:#f5f5f4; --stone-200:#e7e5e4; --stone-300:#d6d3d1;
    --stone-400:#a8a29e; --stone-500:#78716c; --stone-600:#57534e; --stone-700:#44403c;
    --stone-900:#1c1917;
    --teal-50:#f0fdfa; --teal-100:#ccfbf1; --teal-200:#99f6e4; --teal-600:#0d9488; --teal-700:#0f766e;
    --amber-50:#fffbeb; --amber-100:#fef3c7; --amber-200:#fde68a; --amber-600:#d97706; --amber-700:#b45309;
    --red-50:#fef2f2; --red-100:#fee2e2; --red-200:#fecaca; --red-600:#dc2626; --red-700:#b91c1c;
    --violet-400:#a78bfa;
    --radius-sm:4px; --radius-md:6px; --radius-lg:10px;
    --shadow-card: 0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10);
    --ring-focus: 0 0 0 3px rgb(139 92 246 / 0.3);
    --inset-sm: inset 0 1px 2px rgb(0 0 0 / 0.06);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: var(--stone-900);
    background: var(--stone-50);
  }
  .ac-shell { min-height: 100vh; padding: 32px; }
  .ac-container { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }

  .ac-tag { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; color: var(--stone-500); letter-spacing: 0.02em; }
  .ac-title { margin: 0; font-size: 24px; font-weight: 700; color: var(--stone-900); letter-spacing: -0.025em; }
  .ac-subtitle { font-size: 14px; color: var(--stone-500); }

  .ac-agents-row { display: flex; gap: 12px; flex-wrap: wrap; }

  .ac-card {
    background: #fff;
    border-radius: var(--radius-lg);
    border: 1px solid var(--stone-200);
    box-shadow: var(--shadow-card);
    overflow: hidden;
  }
  .ac-card-pad { padding: 16px; }

  .ac-agent-card { min-width: 220px; flex: 1 1 220px; }
  .ac-agent-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ac-agent-left { display: flex; align-items: center; gap: 10px; }
  .ac-dot { width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0; }
  .ac-dot-online { background: var(--teal-600); }
  .ac-dot-offline { background: var(--stone-300); }
  .ac-agent-name { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; font-weight: 500; color: var(--stone-900); }

  .ac-badge {
    display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; white-space: nowrap;
    font-family: inherit; font-weight: 500; letter-spacing: 0.025em;
    font-size: 0.65rem; padding: 1px 5px; border-radius: var(--radius-sm); border: 1px solid transparent;
  }
  .ac-badge-subtle-success { background: var(--teal-100); color: var(--teal-700); }
  .ac-badge-subtle-neutral { background: var(--stone-100); color: var(--stone-700); }
  .ac-badge-soft-success { background: var(--teal-50); color: var(--teal-600); border-color: var(--teal-200); }
  .ac-badge-soft-warning { background: var(--amber-50); color: var(--amber-600); border-color: var(--amber-200); }
  .ac-badge-soft-error { background: var(--red-50); color: var(--red-600); border-color: var(--red-200); }
  .ac-badge-soft-neutral { background: var(--stone-50); color: var(--stone-600); border-color: var(--stone-200); }

  .ac-filter-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .ac-search-wrap { flex: 1 1 240px; min-width: 200px; }
  .ac-select-wrap { width: 200px; position: relative; }

  .ac-input, .ac-select {
    display: block; width: 100%; height: 28px; padding: 0 8px; font-size: 14px;
    font-family: inherit; color: var(--stone-900); background: #fff;
    border: 1px solid var(--stone-200); border-radius: var(--radius-md);
    box-shadow: var(--inset-sm); outline: none; transition: border-color 120ms, box-shadow 120ms;
  }
  .ac-input:focus, .ac-select:focus { border-color: var(--violet-400); box-shadow: var(--ring-focus); }
  .ac-select { appearance: none; padding-right: 28px; cursor: pointer; }
  .ac-select-wrap svg { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; }

  .ac-section-label { margin: 0; font-size: 14px; font-weight: 600; color: var(--stone-500); text-transform: uppercase; letter-spacing: 0.04em; }
  .ac-exchanges { display: flex; flex-direction: column; gap: 14px; }
  .ac-exchange-inner { display: flex; flex-direction: column; gap: 10px; }
  .ac-exchange-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ac-route { display: flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; color: var(--stone-900); }
  .ac-route strong { font-weight: 600; }
  .ac-arrow { color: var(--stone-400); }
  .ac-exchange-meta { display: flex; align-items: center; gap: 8px; }
  .ac-duration { font-size: 12px; color: var(--stone-400); }

  .ac-message { font-size: 14px; line-height: 1.5; color: var(--stone-700); }
  .ac-message strong { font-weight: 600; color: var(--stone-900); }
  .ac-result-box {
    font-size: 14px; line-height: 1.5; color: var(--stone-700);
    background: var(--stone-50); border: 1px solid var(--stone-200); border-radius: 8px; padding: 12px;
  }
  .ac-result-box.ac-pending { color: var(--stone-400); font-style: italic; }

  .ac-button-ghost {
    display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 24px; padding: 0 8px;
    font-size: 0.75rem; font-family: inherit; font-weight: 500; color: var(--stone-700);
    background: transparent; border: 1px solid transparent; border-radius: var(--radius-md);
    cursor: pointer; transition: background 120ms;
  }
  .ac-button-ghost:hover { background: var(--stone-100); }

  .ac-empty { text-align: center; padding: 40px 0; color: var(--stone-500); font-size: 14px; }
  .ac-empty-inline { color: var(--stone-400); font-size: 14px; padding: 8px 0; }
</style>
</head>
<body>
<div class="ac-shell">
  <div class="ac-container">

    <div>
      <div class="ac-tag">hermes-bridge</div>
      <h1 class="ac-title">Conversations entre agents</h1>
      <div class="ac-subtitle">Suivi des échanges entre vos agents en temps réel</div>
    </div>

    <div class="ac-agents-row" id="agents-row"></div>

    <div class="ac-filter-bar">
      <div class="ac-search-wrap">
        <input class="ac-input" id="search-input" type="text" placeholder="Rechercher dans les messages…">
      </div>
      <div class="ac-select-wrap">
        <select class="ac-select" id="agent-filter">
          <option value="all">Tous les agents</option>
        </select>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
    </div>

    <div class="ac-exchanges">
      <h2 class="ac-section-label">Échanges récents</h2>
      <div id="exchanges-list"></div>
    </div>

  </div>
</div>
<script>
let state = { agents: [], exchanges: [] }
let searchText = ''
let filterAgent = 'all'
const expandedIds = new Set()

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, (c) => map[c])
}

function fmtDuration(ms) {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.max(0, Math.round(ms)) + 'ms'
}

function statusMeta(status) {
  switch (status) {
    case 'ok': return { label: 'ok', cls: 'ac-badge-soft-success' }
    case 'pending': return { label: 'en cours', cls: 'ac-badge-soft-warning' }
    case 'timeout': return { label: 'timeout', cls: 'ac-badge-soft-error' }
    case 'agent_offline': return { label: 'agent hors ligne', cls: 'ac-badge-soft-error' }
    case 'agent_disconnected': return { label: 'agent déconnecté', cls: 'ac-badge-soft-error' }
    case 'unknown_agent': return { label: 'agent inconnu', cls: 'ac-badge-soft-error' }
    case 'unknown_conversation': return { label: 'conversation inconnue', cls: 'ac-badge-soft-error' }
    default: return { label: String(status), cls: 'ac-badge-soft-neutral' }
  }
}

function renderAgents() {
  const row = document.getElementById('agents-row')
  if (!state.agents.length) {
    row.innerHTML = '<div class="ac-empty-inline">Aucun agent connu.</div>'
    return
  }
  row.innerHTML = state.agents.map((a) => {
    const dotCls = a.online ? 'ac-dot-online' : 'ac-dot-offline'
    const badgeCls = a.online ? 'ac-badge-subtle-success' : 'ac-badge-subtle-neutral'
    const label = a.online ? 'en ligne' : 'hors ligne'
    return (
      '<div class="ac-card ac-card-pad ac-agent-card"><div class="ac-agent-row">' +
      '<div class="ac-agent-left"><div class="ac-dot ' + dotCls + '"></div>' +
      '<span class="ac-agent-name">' + escapeHtml(a.name) + '</span></div>' +
      '<span class="ac-badge ' + badgeCls + '">' + label + '</span>' +
      '</div></div>'
    )
  }).join('')
}

function renderFilterOptions() {
  const sel = document.getElementById('agent-filter')
  const current = sel.value || filterAgent
  sel.innerHTML = '<option value="all">Tous les agents</option>' +
    state.agents.map((a) => '<option value="' + escapeHtml(a.name) + '">' + escapeHtml(a.name) + '</option>').join('')
  sel.value = current
  filterAgent = sel.value
}

function renderExchangeCard(ex) {
  const expanded = expandedIds.has(ex.request_id)
  const message = ex.message || ''
  const truncated = message.length > 180 ? message.slice(0, 180).trim() + '…' : message
  const meta = statusMeta(ex.status)
  const durationMs = ex.ended_at ? (ex.ended_at - ex.started_at) : (Date.now() - ex.started_at)
  const durationLabel = fmtDuration(durationMs) + (ex.ended_at ? '' : ' (en cours)')
  const hasResult = ex.status !== 'pending'
  const resultText = ex.answer ?? ex.error ?? ''

  let resultHtml = ''
  if (expanded) {
    resultHtml = hasResult
      ? '<div class="ac-result-box"><strong>Résultat — </strong>' + escapeHtml(resultText) + '</div>'
      : '<div class="ac-result-box ac-pending">En attente de réponse…</div>'
  }

  return (
    '<div class="ac-card ac-card-pad"><div class="ac-exchange-inner">' +
    '<div class="ac-exchange-header">' +
    '<div class="ac-route"><strong>' + escapeHtml(ex.from) + '</strong><span class="ac-arrow">→</span><strong>' + escapeHtml(ex.to) + '</strong></div>' +
    '<div class="ac-exchange-meta"><span class="ac-duration">' + escapeHtml(durationLabel) + '</span>' +
    '<span class="ac-badge ' + meta.cls + '">' + escapeHtml(meta.label) + '</span></div>' +
    '</div>' +
    '<div class="ac-message"><strong>Message — </strong>' + escapeHtml(expanded ? message : truncated) + '</div>' +
    resultHtml +
    '<div><button class="ac-button-ghost" data-toggle="' + escapeHtml(ex.request_id) + '">' + (expanded ? 'Voir moins' : 'Voir plus') + '</button></div>' +
    '</div></div>'
  )
}

function renderExchanges() {
  const search = searchText.trim().toLowerCase()
  const filtered = state.exchanges.filter((ex) => {
    const matchesAgent = filterAgent === 'all' || ex.from === filterAgent || ex.to === filterAgent
    const haystack = (ex.message + ' ' + (ex.answer || '') + ' ' + (ex.error || '')).toLowerCase()
    const matchesSearch = !search || haystack.includes(search)
    return matchesAgent && matchesSearch
  }).slice().reverse()

  const list = document.getElementById('exchanges-list')
  if (!filtered.length) {
    list.innerHTML = '<div class="ac-empty">Aucun échange ne correspond à votre recherche.</div>'
    return
  }
  list.innerHTML = filtered.map(renderExchangeCard).join('')
}

document.getElementById('search-input').addEventListener('input', (e) => {
  searchText = e.target.value
  renderExchanges()
})
document.getElementById('agent-filter').addEventListener('change', (e) => {
  filterAgent = e.target.value
  renderExchanges()
})
document.getElementById('exchanges-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]')
  if (!btn) return
  const id = btn.getAttribute('data-toggle')
  if (expandedIds.has(id)) expandedIds.delete(id)
  else expandedIds.add(id)
  renderExchanges()
})

async function refresh() {
  const res = await fetch('/ui/api/state')
  state = await res.json()
  renderAgents()
  renderFilterOptions()
  renderExchanges()
}
refresh()
setInterval(refresh, 3000)
</script>
</body>
</html>`
}
