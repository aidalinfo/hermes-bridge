import type { HandlerDeps } from './handlers.js'
import { handleListAgents } from './handlers.js'

export async function buildStateJson(deps: HandlerDeps): Promise<string> {
  return JSON.stringify({
    agents: handleListAgents(deps),
    exchanges: await deps.telemetry.recentExchanges(),
  })
}

export function renderUiPage(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hermes-bridge — Conversations entre agents</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #f7f5f0; font-family: 'Inter', system-ui, sans-serif; color: #1f2937; padding: 40px 24px 64px; }
  .wrap { max-width: 940px; margin: 0 auto; }
  .eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 6px; }
  h1 { font-size: 28px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em; }
  .subtitle { font-size: 15px; color: #6b7280; margin: 0 0 28px; }
  .mono { font-family: 'IBM Plex Mono', monospace; }
  .agents { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 22px; }
  .agent { background: #fff; border: 1px solid #e7e3da; border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
  .agent .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .agent .name { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500; color: #1f2937; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agent .pill { font-size: 11px; font-weight: 500; padding: 3px 8px; border-radius: 20px; white-space: nowrap; }
  .toolbar { display: flex; gap: 12px; margin-bottom: 32px; }
  .search { flex: 1; position: relative; }
  .search svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9ca3af; }
  .search input { width: 100%; background: #fff; border: 1px solid #e7e3da; border-radius: 10px; padding: 12px 14px 12px 40px; font-size: 14px; color: #1f2937; outline: none; }
  .toolbar select { background: #fff; border: 1px solid #e7e3da; border-radius: 10px; padding: 0 14px; font-size: 14px; color: #1f2937; outline: none; min-width: 180px; cursor: pointer; }
  input, select, button { font-family: inherit; }
  ::placeholder { color: #9ca3af; }
  .section-label { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; letter-spacing: 0.09em; color: #9ca3af; text-transform: uppercase; margin-bottom: 16px; }
  .threads { display: flex; flex-direction: column; gap: 16px; }
  .card { background: #fff; border: 1px solid #e7e3da; border-radius: 14px; overflow: hidden; }
  .card-head { display: flex; align-items: center; gap: 10px; padding: 14px 22px; border-bottom: 1px solid #efece4; background: #fcfbf8; }
  .avatar { width: 26px; height: 26px; border-radius: 7px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .card-head .who { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; color: #1f2937; }
  .spacer { flex: 1; }
  .time { display: flex; align-items: center; gap: 5px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #6b7280; }
  .status { font-size: 11px; font-weight: 600; font-family: 'IBM Plex Mono', monospace; padding: 3px 8px; border-radius: 6px; }
  .card-body { padding: 18px 22px; }
  .msg-label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .msg-label .lbl { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.06em; color: #9ca3af; text-transform: uppercase; }
  .msg-label .id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #b6b2a8; }
  .msg { font-size: 14px; line-height: 1.6; color: #374151; margin: 0; white-space: pre-wrap; }
  .answer { border-left: 2px solid #cfeae4; padding-left: 16px; margin-top: 18px; }
  .answer .lbl { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.06em; color: #0f766e; text-transform: uppercase; margin-bottom: 8px; }
  .card-foot { display: flex; align-items: center; gap: 20px; padding: 12px 22px; border-top: 1px solid #efece4; background: #fcfbf8; }
  .meta { display: flex; align-items: center; gap: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #6b7280; }
  .toggle { background: none; border: none; padding: 0; font-size: 13px; font-weight: 600; color: #0f766e; cursor: pointer; display: flex; align-items: center; gap: 5px; }
  .toggle:hover { color: #0d5f58; }
  .toggle svg { transition: transform 0.15s; }
  .empty { background: #fff; border: 1px dashed #d9d6cf; border-radius: 14px; padding: 48px 24px; text-align: center; color: #9ca3af; font-size: 14px; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: #d9d6cf; border-radius: 8px; border: 2px solid #f7f5f0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">hermes-bridge</div>
  <h1>Conversations entre agents</h1>
  <p class="subtitle">Suivi des échanges entre vos agents en temps réel</p>

  <div class="agents" id="agents-row"></div>

  <div class="toolbar">
    <div class="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>
      <input id="search-input" type="text" placeholder="Rechercher dans les messages…" />
    </div>
    <select id="agent-filter"><option value="all">Tous les agents</option></select>
  </div>

  <div class="section-label">Échanges récents</div>
  <div class="threads" id="exchanges-list"></div>
</div>

<script>
const state = { agents: [], exchanges: [], query: '', filter: 'all', expanded: {} }

const AVATARS = [
  { bg: '#e0e7ff', color: '#4338ca' },
  { bg: '#d5efe9', color: '#0f766e' },
  { bg: '#fdecc8', color: '#b45309' },
  { bg: '#fbdedb', color: '#b91c1c' },
  { bg: '#e9d8fd', color: '#7c3aed' },
  { bg: '#d1f2eb', color: '#0e7490' },
]

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, (c) => map[c])
}

function avatarFor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length]
}

function initials(name) {
  const base = String(name).replace(/-bot$/, '')
  return base.slice(0, 2).toUpperCase()
}

// Statuts métier -> libellé + couleurs
const STATUS = {
  ok:                    { label: 'ok',           color: '#0f766e', bg: '#d5efe9' },
  pending:               { label: 'en cours',     color: '#b45309', bg: '#fdecc8' },
  timeout:               { label: 'timeout',      color: '#b91c1c', bg: '#fbdedb' },
  agent_offline:         { label: 'hors ligne',   color: '#b91c1c', bg: '#fbdedb' },
  agent_disconnected:    { label: 'déconnecté',   color: '#b91c1c', bg: '#fbdedb' },
  unknown_agent:         { label: 'agent inconnu', color: '#b91c1c', bg: '#fbdedb' },
  unknown_conversation:  { label: 'conv. inconnue', color: '#b91c1c', bg: '#fbdedb' },
}
function statusInfo(s) { return STATUS[s] || { label: s || '?', color: '#6b7280', bg: '#f0efe9' } }

function formatTime(ts) {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function formatLatency(e) {
  if (!e.ended_at) return '—'
  const ms = e.ended_at - e.started_at
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
}

function renderAgents() {
  const el = document.getElementById('agents-row')
  el.innerHTML = state.agents.map((a) => {
    const dot = a.online ? '#10b981' : '#d1d5db'
    const label = a.online ? 'en ligne' : 'hors ligne'
    const color = a.online ? '#0f766e' : '#9ca3af'
    const bg = a.online ? '#d5efe9' : '#f0efe9'
    return '<div class="agent"><span class="dot" style="background:' + dot + '"></span>' +
      '<span class="name">' + escapeHtml(a.name) + '</span>' +
      '<span class="pill" style="color:' + color + ';background:' + bg + '">' + label + '</span></div>'
  }).join('')
}

function renderFilter() {
  const sel = document.getElementById('agent-filter')
  if (sel.dataset.count === String(state.agents.length)) return
  sel.dataset.count = String(state.agents.length)
  const current = state.filter
  sel.innerHTML = '<option value="all">Tous les agents</option>' +
    state.agents.map((a) => '<option value="' + escapeHtml(a.name) + '">' + escapeHtml(a.name) + '</option>').join('')
  sel.value = current
}

function renderThreads() {
  const q = state.query.trim().toLowerCase()
  const filter = state.filter
  const visible = state.exchanges.slice().reverse().filter((e) => {
    if (filter !== 'all' && e.from !== filter && e.to !== filter) return false
    if (q) {
      const hay = (e.message + ' ' + (e.answer || e.error || '') + ' ' + e.from + ' ' + e.to).toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const el = document.getElementById('exchanges-list')
  if (visible.length === 0) {
    el.innerHTML = '<div class="empty">Aucun échange ne correspond à votre recherche.</div>'
    return
  }

  el.innerHTML = visible.map((e) => {
    const fa = avatarFor(e.from), ta = avatarFor(e.to)
    const si = statusInfo(e.status)
    const id = '#' + String(e.request_id).slice(0, 8)
    const result = e.answer != null ? e.answer : (e.error != null ? e.error : '—')
    const expanded = !!state.expanded[e.request_id]
    const arrow = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>'
    const answerBlock = expanded
      ? '<div class="answer"><div class="lbl">Réponse · ' + escapeHtml(e.to) + '</div><p class="msg">' + escapeHtml(result) + '</p></div>'
      : ''
    return '<div class="card">' +
      '<div class="card-head">' +
        '<span class="avatar" style="background:' + fa.bg + ';color:' + fa.color + '">' + escapeHtml(initials(e.from)) + '</span>' +
        '<span class="who">' + escapeHtml(e.from) + '</span>' + arrow +
        '<span class="avatar" style="background:' + ta.bg + ';color:' + ta.color + '">' + escapeHtml(initials(e.to)) + '</span>' +
        '<span class="who">' + escapeHtml(e.to) + '</span>' +
        '<span class="spacer"></span>' +
        '<span class="time"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>' + formatTime(e.started_at) + '</span>' +
        '<span class="status" style="color:' + si.color + ';background:' + si.bg + '">' + escapeHtml(si.label) + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="msg-label"><span class="lbl">Message</span><span class="id">' + escapeHtml(id) + '</span></div>' +
        '<p class="msg">' + escapeHtml(e.message) + '</p>' + answerBlock +
      '</div>' +
      '<div class="card-foot">' +
        '<span class="meta"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"></path></svg>' + formatLatency(e) + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="toggle" data-id="' + escapeHtml(e.request_id) + '">' + (expanded ? 'Masquer la réponse' : 'Voir la réponse') +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(' + (expanded ? 180 : 0) + 'deg)"><path d="m6 9 6 6 6-6"></path></svg>' +
        '</button>' +
      '</div>' +
    '</div>'
  }).join('')

  el.querySelectorAll('.toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      state.expanded[id] = !state.expanded[id]
      renderThreads()
    })
  })
}

async function refresh() {
  try {
    const res = await fetch('/ui/api/state')
    const data = await res.json()
    state.agents = data.agents || []
    state.exchanges = data.exchanges || []
    renderAgents()
    renderFilter()
    renderThreads()
  } catch (err) {
    // silencieux : on retentera au prochain tick
  }
}

document.getElementById('search-input').addEventListener('input', (e) => {
  state.query = e.target.value
  renderThreads()
})
document.getElementById('agent-filter').addEventListener('change', (e) => {
  state.filter = e.target.value
  renderThreads()
})

refresh()
setInterval(refresh, 3000)
</script>
</body>
</html>`
}
