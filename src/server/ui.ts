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
