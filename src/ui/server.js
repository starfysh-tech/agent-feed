import http from 'node:http';
import { URL } from 'node:url';

const VALID_REVIEW_STATUSES = ['unreviewed', 'accepted', 'needs_change', 'false_positive'];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Feed</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d0f11; --surface: #141618; --surface2: #1c1f22;
      --border: #262a2e; --text: #d4d8dc; --text-muted: #5a6370;
      --text-dim: #8a929c; --accent: #4a9eff; --accent-dim: #1a3a5e;
      --green: #3dd68c; --yellow: #f0c040; --red: #f05060; --orange: #f08030; --purple: #a070e8;
    }
    body { background: var(--bg); color: var(--text); font-family: 'IBM Plex Sans', sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; }
    #app { display: flex; height: 100vh; overflow: hidden; }
    #sidebar { width: 280px; min-width: 280px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
    #main { flex: 1; overflow-y: auto; padding: 24px; }
    .sidebar-header { padding: 20px 16px 12px; border-bottom: 1px solid var(--border); }
    .sidebar-title { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; }
    .sidebar-subtitle { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .filter-bar { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
    .filter-bar select, .filter-bar input { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; padding: 5px 8px; border-radius: 3px; width: 100%; outline: none; }
    .filter-bar select:focus, .filter-bar input:focus { border-color: var(--accent); }
    #session-list { flex: 1; overflow-y: auto; padding: 8px 0; }
    .session-item { padding: 10px 16px; cursor: pointer; border-left: 2px solid transparent; transition: background 0.1s, border-color 0.1s; }
    .session-item:hover { background: var(--surface2); }
    .session-item.active { border-left-color: var(--accent); background: var(--surface2); }
    .session-id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .session-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; }
    .session-badge { display: inline-block; padding: 1px 5px; border-radius: 2px; font-size: 10px; font-family: 'IBM Plex Mono', monospace; }
    .badge-unreviewed { background: #1a2a3a; color: var(--accent); }
    .badge-ok { background: #0f2a1a; color: var(--green); }
    .page-header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .page-title { font-size: 16px; font-weight: 600; color: var(--text); }
    .page-meta { font-size: 12px; color: var(--text-muted); margin-top: 4px; font-family: 'IBM Plex Mono', monospace; }
    .progress-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
    .progress-pill { padding: 4px 10px; border-radius: 2px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; border: 1px solid var(--border); color: var(--text-dim); }
    .progress-pill.highlight { border-color: var(--yellow); color: var(--yellow); }
    .turn-block { margin-bottom: 16px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
    .turn-header { padding: 8px 14px; background: var(--surface2); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .turn-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-muted); }
    .turn-summary { padding: 10px 14px; font-size: 13px; color: var(--text-dim); border-bottom: 1px solid var(--border); }
    .flag-card { padding: 12px 14px; border-bottom: 1px solid var(--border); }
    .flag-card:last-child { border-bottom: none; }
    .flag-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .flag-type { font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 6px; border-radius: 2px; }
    .type-decision    { background: #1a2a3a; color: #4a9eff; }
    .type-assumption  { background: #2a1a0f; color: #f08030; }
    .type-architecture{ background: #1a2a1a; color: #3dd68c; }
    .type-pattern     { background: #2a1a2a; color: #a070e8; }
    .type-dependency  { background: #0f1a2a; color: #40b0f0; }
    .type-tradeoff    { background: #2a2a0f; color: #f0c040; }
    .type-constraint  { background: #2a1010; color: #f05060; }
    .type-workaround  { background: #1a1a0f; color: #d0a030; }
    .type-risk        { background: #2a1010; color: #f06070; }
    .flag-confidence { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); }
    .flag-content { font-size: 13px; color: var(--text); margin-bottom: 10px; line-height: 1.5; }
    .flag-status-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .status-btn { padding: 4px 10px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; border-radius: 2px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--text-dim); transition: all 0.1s; }
    .status-btn:hover { background: var(--surface2); }
    .status-btn.active-accepted { border-color: var(--green); color: var(--green); }
    .status-btn.active-needs_change { border-color: var(--yellow); color: var(--yellow); }
    .status-btn.active-false_positive { border-color: var(--red); color: var(--red); }
    .flag-notes { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .flag-notes input { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; padding: 5px 8px; border-radius: 3px; flex: 1; min-width: 120px; outline: none; height: 30px; }
    .flag-notes input:focus { border-color: var(--accent); }
    .save-btn { padding: 5px 12px; background: var(--accent-dim); border: 1px solid var(--accent); color: var(--accent); font-family: 'IBM Plex Mono', monospace; font-size: 11px; border-radius: 3px; cursor: pointer; transition: background 0.1s; }
    .save-btn:hover { background: #1e4a7a; }
    .raw-toggle { font-size: 11px; color: var(--text-muted); cursor: pointer; font-family: 'IBM Plex Mono', monospace; background: none; border: none; padding: 4px 8px; border-radius: 2px; transition: background 0.1s; }
    .raw-toggle:hover { background: var(--surface2); color: var(--text); }
    .raw-response { margin: 8px 14px 14px; background: var(--surface2); border: 1px solid var(--border); border-radius: 3px; padding: 12px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-dim); white-space: pre-wrap; overflow-x: auto; max-height: 300px; overflow-y: auto; }
    .tab-btn { flex: 1; padding: 8px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font-family: 'IBM Plex Mono', monospace; font-size: 11px; cursor: pointer; transition: all 0.1s; }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .trends-panel { padding: 16px; overflow-y: auto; flex: 1; }
    .trends-section { margin-bottom: 20px; }
    .trends-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
    .trend-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .trend-type-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; width: 90px; flex-shrink: 0; }
    .trend-bar-wrap { flex: 1; background: var(--surface2); border-radius: 2px; height: 6px; overflow: hidden; }
    .trend-bar { height: 100%; border-radius: 2px; background: var(--accent); transition: width 0.3s; }
    .trend-count { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); width: 24px; text-align: right; }
    .trend-fp { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--red); width: 32px; text-align: right; }
    .trend-session-row { padding: 6px 0; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .trend-session-row:hover { color: var(--accent); }
    .trend-session-id { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
    .trend-session-count { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-state p { font-size: 13px; line-height: 1.6; }
    .loading { color: var(--text-muted); padding: 40px; text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  </style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">Agent Feed</div>
      <div class="sidebar-subtitle">coding agent decision log</div>
    </div>
    <div class="filter-bar">
      <select id="filter-agent">
        <option value="">All agents</option>
        <option value="claude-code">Claude Code</option>
        <option value="codex">Codex</option>
        <option value="gemini">Gemini</option>
      </select>
      <input type="date" id="filter-date">
    </div>
    <div style="display:flex;border-bottom:1px solid var(--border)">
      <button class="tab-btn active" id="tab-sessions" onclick="switchTab('sessions')">Sessions</button>
      <button class="tab-btn" id="tab-trends" onclick="switchTab('trends')">Trends</button>
    </div>
    <div id="session-list"><div class="loading">loading...</div></div>
    <div id="trends-panel" class="trends-panel" style="display:none"></div>
  </div>
  <div id="main">
    <div class="empty-state" id="empty-state">
      <div class="empty-state-icon">&#9672;</div>
      <p>Select a session to review decisions,<br>assumptions, and architectural choices.</p>
    </div>
    <div id="session-detail" style="display:none"></div>
  </div>
</div>
<script>
const $ = id => document.getElementById(id);
let allSessions = [];
let activeSessionId = null;

async function loadSessions() {
  const agent = $('filter-agent').value;
  const date = $('filter-date').value;
  let url = '/api/sessions?';
  if (agent) url += 'agent=' + encodeURIComponent(agent) + '&';
  if (date) url += 'date=' + encodeURIComponent(date) + '&';
  const res = await fetch(url);
  allSessions = await res.json();
  renderSessionList();
}

function renderSessionList() {
  const list = $('session-list');
  if (!allSessions.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px"><p>No sessions yet.</p></div>';
    return;
  }
  list.innerHTML = allSessions.map(s => {
    const unreviewed = s.unreviewed_flags ?? 0;
    const total = s.total_flags ?? 0;
    const badgeClass = unreviewed > 0 ? 'badge-unreviewed' : 'badge-ok';
    const badgeText = unreviewed > 0 ? unreviewed + ' unreviewed' : 'reviewed';
    const date = new Date(s.latest_timestamp).toLocaleDateString();
    const active = s.session_id === activeSessionId ? ' active' : '';
    return '<div class="session-item' + active + '" onclick="selectSession(' + JSON.stringify(s.session_id) + ')">' +
      '<div class="session-id">' + esc(s.session_id) + '</div>' +
      '<div class="session-meta"><span>' + esc(s.agent || '') + '</span><span>' + date + '</span>' + (s.repo ? '<span>' + esc(s.repo) + '</span>' : '') + '</div>' +
      '<div class="session-meta" style="margin-top:3px"><span class="session-badge ' + badgeClass + '">' + badgeText + '</span>' +
      '<span class="session-badge" style="background:#111;color:var(--text-muted)">' + s.turn_count + ' turn' + (s.turn_count !== 1 ? 's' : '') + '</span></div>' +
      '</div>';
  }).join('');
}

async function selectSession(sessionId) {
  activeSessionId = sessionId;
  renderSessionList();
  $('empty-state').style.display = 'none';
  $('session-detail').style.display = 'block';
  $('session-detail').innerHTML = '<div class="loading">loading session...</div>';
  const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId));
  if (!res.ok) { $('session-detail').innerHTML = '<div class="empty-state"><p>Session not found.</p></div>'; return; }
  const records = await res.json();
  renderSessionDetail(sessionId, records);
}

function renderSessionDetail(sessionId, records) {
  const allFlags = records.flatMap(r => r.flags || []);
  const unreviewed = allFlags.filter(f => f.review_status === 'unreviewed').length;
  const needsChange = allFlags.filter(f => f.review_status === 'needs_change').length;
  const falsePos = allFlags.filter(f => f.review_status === 'false_positive').length;
  const first = records[0] || {};
  let html = '<div class="page-header"><div class="page-title">Session Review</div>' +
    '<div class="page-meta">' + esc(sessionId) + ' &nbsp;&middot;&nbsp; ' + esc(first.agent || '') + ' &nbsp;&middot;&nbsp; ' + esc(first.model || '') +
    (first.repo ? ' &nbsp;&middot;&nbsp; ' + esc(first.repo) : '') + (first.git_branch ? ' (' + esc(first.git_branch) + ')' : '') + '</div></div>' +
    '<div class="progress-row">' +
    '<div class="progress-pill">' + allFlags.length + ' total flags</div>' +
    '<div class="progress-pill ' + (unreviewed > 0 ? 'highlight' : '') + '">' + unreviewed + ' unreviewed</div>' +
    (needsChange > 0 ? '<div class="progress-pill" style="border-color:var(--yellow);color:var(--yellow)">' + needsChange + ' needs change</div>' : '') +
    (falsePos > 0 ? '<div class="progress-pill" style="border-color:var(--text-muted)">' + falsePos + ' false positive</div>' : '') +
    '</div>';
  html += records.map(r => renderTurn(r)).join('');
  $('session-detail').innerHTML = html;
}

function renderTurn(record) {
  const flags = record.flags || [];
  const ts = new Date(record.timestamp).toLocaleTimeString();
  const flagsHtml = flags.length
    ? flags.map(f => renderFlag(f)).join('')
    : '<div style="padding:10px 14px;font-size:12px;color:var(--text-muted)">No flags extracted</div>';
  return '<div class="turn-block" id="turn-' + esc(record.id) + '">' +
    '<div class="turn-header"><span class="turn-label">Turn ' + record.turn_index + ' &nbsp;&middot;&nbsp; ' + ts + '</span>' +
    '<button class="raw-toggle" onclick="toggleRaw(' + JSON.stringify(record.id) + ', ' + JSON.stringify(activeSessionId) + ')">[ raw ]</button></div>' +
    '<div class="turn-summary">' + esc(record.response_summary) + '</div>' +
    flagsHtml +
    '<div id="raw-' + esc(record.id) + '" style="display:none"></div>' +
    '</div>';
}

function renderFlag(flag) {
  const btns = ['accepted','needs_change','false_positive'].map(s => {
    const label = {accepted:'accept',needs_change:'needs change',false_positive:'false positive'}[s];
    const cls = flag.review_status === s ? ' active-' + s : '';
    return '<button class="status-btn' + cls + '" onclick="setStatus(' + JSON.stringify(flag.id) + ',' + JSON.stringify(s) + ')">' + label + '</button>';
  }).join('');
  return '<div class="flag-card" id="flag-' + esc(flag.id) + '">' +
    '<div class="flag-header"><span class="flag-type type-' + esc(flag.type) + '">' + esc(flag.type) + '</span>' +
    '<span class="flag-confidence">' + Math.round(flag.confidence * 100) + '% confidence</span></div>' +
    '<div class="flag-content">' + esc(flag.content) + '</div>' +
    '<div class="flag-status-row">' + btns + '</div>' +
    '<div class="flag-notes">' +
    '<input type="text" id="note-' + esc(flag.id) + '" placeholder="Reviewer note..." value="' + esc(flag.reviewer_note || '') + '">' +
    '<input type="text" id="outcome-' + esc(flag.id) + '" placeholder="Outcome..." value="' + esc(flag.outcome || '') + '">' +
    '<button class="save-btn" onclick="saveNotes(' + JSON.stringify(flag.id) + ')">save</button>' +
    '</div></div>';
}

async function setStatus(flagId, status) {
  await fetch('/api/flags/' + encodeURIComponent(flagId), {
    method: 'PATCH', headers: {'content-type':'application/json'},
    body: JSON.stringify({ review_status: status })
  });
  const res = await fetch('/api/sessions/' + encodeURIComponent(activeSessionId));
  renderSessionDetail(activeSessionId, await res.json());
  loadSessions();
}

async function saveNotes(flagId) {
  const note = document.getElementById('note-' + flagId)?.value || '';
  const outcome = document.getElementById('outcome-' + flagId)?.value || '';
  await fetch('/api/flags/' + encodeURIComponent(flagId), {
    method: 'PATCH', headers: {'content-type':'application/json'},
    body: JSON.stringify({ reviewer_note: note, outcome })
  });
}

async function toggleRaw(recordId, sessionId) {
  const el = document.getElementById('raw-' + recordId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  if (!el.dataset.loaded) {
    const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/records/' + encodeURIComponent(recordId) + '/raw');
    const data = await res.json();
    let pretty = data.raw_response;
    try { pretty = JSON.stringify(JSON.parse(data.raw_response), null, 2); } catch {}
    el.innerHTML = '<div class="raw-response">' + esc(pretty) + '</div>';
    el.dataset.loaded = '1';
  }
  el.style.display = 'block';
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

$('filter-agent').addEventListener('change', loadSessions);
$('filter-date').addEventListener('change', loadSessions);
loadSessions();

// ── Tabs ──────────────────────────────────────────────────────────────────
function switchTab(tab) {
  const isSessions = tab === 'sessions';
  $('tab-sessions').classList.toggle('active', isSessions);
  $('tab-trends').classList.toggle('active', !isSessions);
  $('session-list').style.display = isSessions ? '' : 'none';
  $('trends-panel').style.display = isSessions ? 'none' : '';
  if (!isSessions) loadTrends();
}

async function loadTrends() {
  const agent = $('filter-agent').value;
  const date  = $('filter-date').value;
  let url = '/api/trends?';
  if (agent) url += 'agent=' + encodeURIComponent(agent) + '&';
  if (date)  url += 'dateFrom=' + encodeURIComponent(date) + '&dateTo=' + encodeURIComponent(date) + '&';
  const res = await fetch(url);
  const data = await res.json();
  renderTrends(data);
}

function renderTrends(data) {
  const panel = $('trends-panel');
  const maxCount = Math.max(...(data.by_type.map(t => t.count)), 1);

  const typeColors = {
    decision:'#4a9eff', assumption:'#f08030', architecture:'#3dd68c',
    pattern:'#a070e8', dependency:'#40b0f0', tradeoff:'#f0c040',
    constraint:'#f05060', workaround:'#d0a030', risk:'#f06070',
  };

  const byTypeHtml = data.by_type.length ? data.by_type.map(t => {
    const pct = Math.round((t.count / maxCount) * 100);
    const fpPct = Math.round(t.false_positive_rate * 100);
    const color = typeColors[t.type] || 'var(--accent)';
    return '<div class="trend-row">' +
      '<span class="trend-type-label" style="color:' + color + '">' + esc(t.type) + '</span>' +
      '<div class="trend-bar-wrap"><div class="trend-bar" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '<span class="trend-count">' + t.count + '</span>' +
      (fpPct > 0 ? '<span class="trend-fp">' + fpPct + '%fp</span>' : '<span class="trend-fp"></span>') +
      '</div>';
  }).join('') : '<div style="font-size:12px;color:var(--text-muted)">No flags yet</div>';

  const bySessionHtml = data.by_session.length ? data.by_session.map(s =>
    '<div class="trend-session-row" onclick="switchTab(&apos;sessions&apos;);selectSession(' + JSON.stringify(s.session_id) + ')">' +
    '<span class="trend-session-id">' + esc(s.session_id) + '</span>' +
    '<span class="trend-session-count">' + (s.flag_count || 0) + ' flags</span>' +
    '</div>'
  ).join('') : '<div style="font-size:12px;color:var(--text-muted)">No sessions yet</div>';

  panel.innerHTML =
    '<div class="trends-section">' +
      '<div class="trends-label">Total Flags: ' + data.total_flags + '</div>' +
    '</div>' +
    '<div class="trends-section">' +
      '<div class="trends-label">By Type</div>' +
      byTypeHtml +
    '</div>' +
    '<div class="trends-section">' +
      '<div class="trends-label">By Session</div>' +
      bySessionHtml +
    '</div>';
}

</script>
</body>
</html>`;
}

export function createUIServer({ db }) {
  let server = null;
  let _port = null;

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/trends') {
      const agent    = url.searchParams.get('agent')    || undefined;
      const repo     = url.searchParams.get('repo')     || undefined;
      const branch   = url.searchParams.get('branch')   || undefined;
      const dateFrom = url.searchParams.get('dateFrom') || undefined;
      const dateTo   = url.searchParams.get('dateTo')   || undefined;
      const trends = await db.getTrends({ agent, repo, branch, dateFrom, dateTo });
      return json(res, 200, trends);
    }

    if (method === 'GET' && pathname === '/api/sessions') {
      const agentFilter = url.searchParams.get('agent');
      const dateFilter = url.searchParams.get('date');
      let sessions = await db.listSessions();
      if (agentFilter) sessions = sessions.filter(s => s.agent === agentFilter);
      if (dateFilter) sessions = sessions.filter(s => s.latest_timestamp?.startsWith(dateFilter));
      const flagCounts = await db.getSessionFlagCounts();
      const countsMap = new Map(flagCounts.map(c => [c.session_id, c]));
      for (const s of sessions) {
        const counts = countsMap.get(s.session_id);
        s.total_flags = counts?.total_flags ?? 0;
        s.unreviewed_flags = counts?.unreviewed_flags ?? 0;
      }
      return json(res, 200, sessions);
    }

    const rawMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/records\/([^/]+)\/raw$/);
    if (method === 'GET' && rawMatch) {
      const sessionId = decodeURIComponent(rawMatch[1]);
      const recordId = decodeURIComponent(rawMatch[2]);
      const records = await db.getSession(sessionId);
      const record = records.find(r => r.id === recordId);
      if (!record) return json(res, 404, { error: 'Record not found' });
      return json(res, 200, { raw_response: record.raw_response, raw_request: record.raw_request });
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === 'GET' && sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const records = await db.getRecordsWithFlags(sessionId);
      if (!records.length) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, records);
    }

    const flagMatch = pathname.match(/^\/api\/flags\/([^/]+)$/);
    if (method === 'PATCH' && flagMatch) {
      const flagId = decodeURIComponent(flagMatch[1]);
      const body = await readBody(req);
      const { review_status, reviewer_note, outcome } = body;
      if (review_status && !VALID_REVIEW_STATUSES.includes(review_status)) {
        return json(res, 400, { error: `Invalid review_status: ${review_status}` });
      }
      try {
        await db.updateFlagReview(flagId, { review_status, reviewer_note, outcome });
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return html(res, buildHTML());
    }

    json(res, 404, { error: 'Not found' });
  }

  const instance = {
    get port() { return _port; },

    async listen(configPort = 3000) {
      server = http.createServer((req, res) => {
        handleRequest(req, res).catch(err => json(res, 500, { error: err.message }));
      });
      await new Promise((resolve, reject) => {
        server.listen(configPort, 'localhost', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      _port = server.address().port;
    },

    async close() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };

  return instance;
}
