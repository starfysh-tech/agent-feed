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
      /* backgrounds */
      --bg-base: #0d0f11; --bg-surface: #141618; --bg-raised: #1c1f22; --bg-overlay: #242830;
      /* borders */
      --border-subtle: rgba(255,255,255,0.06); --border-default: #262a2e; --border-strong: #3a3f45;
      /* text */
      --text-primary: #e1e4e8; --text-secondary: #8a929c; --text-tertiary: #5a6370;
      /* accent */
      --accent: #4a9eff; --accent-dim: #1a3a5e; --accent-subtle: rgba(74,158,255,0.12);
      /* semantic colors */
      --green: #3dd68c; --green-subtle: rgba(61,214,140,0.12);
      --yellow: #f0c040; --yellow-subtle: rgba(240,192,64,0.12);
      --red: #f05060; --red-subtle: rgba(240,80,96,0.12);
      --orange: #f08030; --orange-subtle: rgba(240,128,48,0.12);
      --purple: #a070e8; --purple-subtle: rgba(160,112,232,0.12);
      --cyan: #40b0f0; --cyan-subtle: rgba(64,176,240,0.12);
      /* flag type colors (single source of truth for CSS + JS) */
      --color-decision: #4a9eff; --color-decision-bg: #1a2a3a;
      --color-assumption: #f08030; --color-assumption-bg: #2a1a0f;
      --color-architecture: #3dd68c; --color-architecture-bg: #1a2a1a;
      --color-pattern: #a070e8; --color-pattern-bg: #2a1a2a;
      --color-dependency: #40b0f0; --color-dependency-bg: #0f1a2a;
      --color-tradeoff: #f0c040; --color-tradeoff-bg: #2a2a0f;
      --color-constraint: #f05060; --color-constraint-bg: #2a1010;
      --color-workaround: #d0a030; --color-workaround-bg: #1a1a0f;
      --color-risk: #f06070; --color-risk-bg: #2a1010;
      /* spacing */
      --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
      --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px;
      /* radius */
      --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
      /* shadows */
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.15);
      --shadow-md: 0 2px 8px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.15);
      --shadow-lg: 0 8px 24px rgba(0,0,0,0.4), 0 16px 32px rgba(0,0,0,0.2);
      /* transitions */
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
      --duration-fast: 120ms; --duration-normal: 200ms; --duration-slow: 350ms;
      /* layout */
      --sidebar-width: 320px;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    body { background: var(--bg-base); color: var(--text-primary); font-family: 'IBM Plex Sans', sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    ::selection { background: var(--accent); color: #fff; }
    button { cursor: pointer; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    #app { display: flex; height: 100vh; overflow: hidden; }
    #sidebar { width: var(--sidebar-width); min-width: var(--sidebar-width); background: var(--bg-surface); border-right: 1px solid var(--border-default); display: flex; flex-direction: column; overflow: hidden; }
    #main { flex: 1; overflow-y: auto; padding: var(--space-6); scroll-behavior: smooth; }
    .sidebar-header { padding: var(--space-5) var(--space-4) var(--space-3); border-bottom: 1px solid var(--border-default); }
    .sidebar-title { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; }
    .sidebar-subtitle { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
    .filter-bar { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-default); display: flex; flex-direction: column; gap: var(--space-2); }
    .filter-bar select, .filter-bar input[type="date"] { background: var(--bg-raised); border: 1px solid var(--border-default); color: var(--text-primary); font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; padding: 6px var(--space-2); border-radius: var(--radius-sm); width: 100%; outline: none; transition: border-color var(--duration-fast); }
    .filter-bar select:focus, .filter-bar input[type="date"]:focus { border-color: var(--accent); }
    #session-list { flex: 1; overflow-y: auto; padding: var(--space-2) 0; }
    .session-item { padding: var(--space-3) var(--space-4); cursor: pointer; border-left: 2px solid transparent; transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast); }
    .session-item:hover { background: var(--bg-raised); }
    .session-item.active { border-left-color: var(--accent); background: var(--bg-raised); }
    .session-id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .session-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .session-badge { display: inline-block; padding: 1px 5px; border-radius: 2px; font-size: 10px; font-family: 'IBM Plex Mono', monospace; }
    .badge-unreviewed { background: var(--accent-subtle); color: var(--accent); }
    .badge-ok { background: var(--green-subtle); color: var(--green); }
    .page-header { margin-bottom: var(--space-5); padding-bottom: var(--space-4); border-bottom: 1px solid var(--border-default); }
    .page-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .page-meta { font-size: 12px; color: var(--text-tertiary); margin-top: var(--space-1); font-family: 'IBM Plex Mono', monospace; }
    .turn-block { margin-bottom: var(--space-4); border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden; transition: box-shadow var(--duration-normal) var(--ease-out), border-color var(--duration-normal); }
    .turn-block:hover { box-shadow: var(--shadow-sm); border-color: var(--border-strong); }
    .turn-header { padding: var(--space-2) 14px; background: var(--bg-raised); border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center; }
    .turn-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-tertiary); }
    .turn-summary { padding: 10px 14px; font-size: 13px; color: var(--text-secondary); border-bottom: 1px solid var(--border-default); }
    .flag-card { padding: var(--space-3) 14px; border-bottom: 1px solid var(--border-subtle); border-left: 4px solid transparent; transition: background var(--duration-fast); }
    .flag-card:hover { background: rgba(255,255,255,0.02); }
    .flag-card:last-child { border-bottom: none; }
    .flag-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
    .flag-type { font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 6px; border-radius: 2px; }
    .type-decision    { background: var(--color-decision-bg); color: var(--color-decision); }
    .type-assumption  { background: var(--color-assumption-bg); color: var(--color-assumption); }
    .type-architecture{ background: var(--color-architecture-bg); color: var(--color-architecture); }
    .type-pattern     { background: var(--color-pattern-bg); color: var(--color-pattern); }
    .type-dependency  { background: var(--color-dependency-bg); color: var(--color-dependency); }
    .type-tradeoff    { background: var(--color-tradeoff-bg); color: var(--color-tradeoff); }
    .type-constraint  { background: var(--color-constraint-bg); color: var(--color-constraint); }
    .type-workaround  { background: var(--color-workaround-bg); color: var(--color-workaround); }
    .type-risk        { background: var(--color-risk-bg); color: var(--color-risk); }
    .flag-confidence { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-tertiary); }
    .flag-content { font-size: 13px; color: var(--text-primary); margin-bottom: 10px; line-height: 1.5; }
    .flag-status-row { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
    .status-btn { padding: var(--space-1) 10px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; border-radius: var(--radius-sm); cursor: pointer; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); transition: all var(--duration-fast); }
    .status-btn:hover { background: var(--bg-raised); }
    .status-btn:active { transform: scale(0.97); }
    .status-btn.active-accepted { border-color: var(--green); color: var(--green); background: var(--green-subtle); }
    .status-btn.active-needs_change { border-color: var(--yellow); color: var(--yellow); background: var(--yellow-subtle); }
    .status-btn.active-false_positive { border-color: var(--red); color: var(--red); background: var(--red-subtle); }
    .flag-notes { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }
    .flag-notes input { background: var(--bg-raised); border: 1px solid var(--border-default); color: var(--text-primary); font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; padding: 5px var(--space-2); border-radius: var(--radius-sm); flex: 1; min-width: 120px; outline: none; height: 30px; transition: border-color var(--duration-fast); }
    .flag-notes input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
    .save-btn { padding: 5px var(--space-3); background: var(--accent); border: none; color: #fff; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 500; border-radius: var(--radius-sm); cursor: pointer; transition: background var(--duration-fast), transform var(--duration-fast); }
    .save-btn:hover { background: #5aabff; }
    .save-btn:active { transform: scale(0.97); }
    .raw-toggle { font-size: 11px; color: var(--text-tertiary); cursor: pointer; font-family: 'IBM Plex Mono', monospace; background: none; border: none; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); transition: background var(--duration-fast); }
    .raw-toggle:hover { background: var(--bg-raised); color: var(--text-primary); }
    .raw-response { margin: var(--space-2) 14px 14px; background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm); padding: var(--space-3); font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-secondary); white-space: pre-wrap; overflow-x: auto; max-height: 300px; overflow-y: auto; }
    .tab-btn { flex: 1; padding: var(--space-2); background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-tertiary); font-family: 'IBM Plex Mono', monospace; font-size: 11px; cursor: pointer; transition: all var(--duration-fast); }
    .tab-btn:hover { color: var(--text-primary); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .trends-section { margin-bottom: var(--space-5); }
    .trends-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: var(--space-2); }
    .trend-row { display: flex; align-items: center; gap: var(--space-2); margin-bottom: 5px; }
    .trend-type-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; width: 100px; flex-shrink: 0; }
    .trend-bar-wrap { flex: 1; background: var(--bg-raised); border-radius: var(--radius-sm); height: 8px; overflow: hidden; }
    .trend-bar { height: 100%; border-radius: var(--radius-sm); background: var(--accent); transition: width var(--duration-slow) var(--ease-out); }
    .trend-count { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-tertiary); width: 28px; text-align: right; }
    .trend-fp { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--red); width: 36px; text-align: right; }
    .trend-session-row { padding: var(--space-2) 0; border-bottom: 1px solid var(--border-subtle); cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: color var(--duration-fast); }
    .trend-session-row:hover { color: var(--accent); }
    .trend-session-id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
    .trend-session-count { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-tertiary); }
    .empty-state { text-align: center; padding: var(--space-12) var(--space-5); color: var(--text-tertiary); }
    .empty-state p { font-size: 13px; line-height: 1.6; }
    .loading { color: var(--text-tertiary); padding: var(--space-10); text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
    /* stat cards */
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--space-3); margin-bottom: var(--space-5); }
    .stat-card { background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); transition: box-shadow var(--duration-normal) var(--ease-out); }
    .stat-card:hover { box-shadow: var(--shadow-sm); }
    .stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 500; color: var(--text-primary); line-height: 1.2; }
    .stat-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
    /* bulk actions */
    .bulk-bar { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
    .bulk-btn { padding: var(--space-1) var(--space-3); font-size: 11px; font-family: 'IBM Plex Mono', monospace; border-radius: var(--radius-sm); cursor: pointer; border: 1px solid; transition: all var(--duration-fast); }
    .bulk-btn:active { transform: scale(0.97); }
    .bulk-btn-accept { border-color: var(--green); color: var(--green); background: var(--green-subtle); }
    .bulk-btn-accept:hover { background: rgba(61,214,140,0.2); }
    .bulk-btn-fp { border-color: var(--red); color: var(--red); background: transparent; }
    .bulk-btn-fp:hover { background: var(--red-subtle); }
    .bulk-label { font-size: 12px; color: var(--text-secondary); }
    /* search */
    .search-bar { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-default); }
    .search-bar input { background: var(--bg-raised); border: 1px solid var(--border-default); color: var(--text-primary); font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; padding: 6px var(--space-2); border-radius: var(--radius-sm); width: 100%; outline: none; transition: border-color var(--duration-fast); }
    .search-bar input:focus { border-color: var(--accent); }
    .search-bar input::placeholder { color: var(--text-tertiary); }
    .filter-row { display: flex; gap: var(--space-2); }
    /* mobile header */
    .mobile-header { display: none; position: sticky; top: 0; z-index: 10; background: var(--bg-surface); border-bottom: 1px solid var(--border-default); padding: var(--space-3) var(--space-4); align-items: center; gap: var(--space-3); }
    .mobile-header-title { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; }
    .hamburger { background: none; border: none; color: var(--text-primary); padding: var(--space-1); cursor: pointer; display: flex; align-items: center; }
    .sidebar-close { display: none; background: none; border: none; color: var(--text-tertiary); font-size: 18px; cursor: pointer; padding: var(--space-1); margin-left: auto; }
    /* sidebar backdrop */
    .sidebar-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 19; }
    /* toast */
    .toast-container { position: fixed; bottom: var(--space-4); right: var(--space-4); z-index: 100; display: flex; flex-direction: column; gap: var(--space-2); pointer-events: none; }
    .toast { padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; pointer-events: auto; animation: toast-in var(--duration-normal) var(--ease-out); box-shadow: var(--shadow-md); max-width: 360px; }
    .toast-info { background: var(--bg-overlay); color: var(--text-primary); border: 1px solid var(--border-default); }
    .toast-success { background: #0d2818; color: var(--green); border: 1px solid rgba(61,214,140,0.3); }
    .toast-error { background: #2a0f0f; color: var(--red); border: 1px solid rgba(240,80,96,0.3); }
    .toast-exit { animation: toast-out var(--duration-fast) var(--ease-out) forwards; }
    @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(20px); } }
    /* skeleton */
    .skeleton { background: linear-gradient(90deg, var(--bg-raised) 25%, var(--bg-overlay) 50%, var(--bg-raised) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: var(--radius-sm); }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: 16px; height: 16px; border: 2px solid var(--border-default); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; vertical-align: middle; margin-right: var(--space-2); }
    /* command palette */
    .cmd-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding-top: 15vh; animation: toast-in var(--duration-fast) var(--ease-out); }
    .cmd-modal { background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-xl); width: 90%; max-width: 520px; box-shadow: var(--shadow-lg); overflow: hidden; }
    .cmd-input { width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--border-default); color: var(--text-primary); font-family: 'IBM Plex Sans', sans-serif; font-size: 15px; padding: var(--space-4); outline: none; }
    .cmd-input::placeholder { color: var(--text-tertiary); }
    .cmd-results { max-height: 320px; overflow-y: auto; }
    .cmd-item { padding: var(--space-3) var(--space-4); cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background var(--duration-fast); border-left: 3px solid transparent; }
    .cmd-item:hover, .cmd-item.active { background: var(--bg-raised); border-left-color: var(--accent); }
    .cmd-item-title { font-size: 13px; color: var(--text-primary); }
    .cmd-item-meta { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-tertiary); }
    .cmd-empty { padding: var(--space-6); text-align: center; color: var(--text-tertiary); font-size: 13px; }
    /* responsive */
    @media (max-width: 1023px) {
      #sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 20; transform: translateX(-100%); transition: transform var(--duration-normal) var(--ease-out); }
      .sidebar-open #sidebar { transform: translateX(0); }
      .sidebar-open .sidebar-backdrop { display: block; }
      .mobile-header { display: flex; }
      .sidebar-close { display: block; }
      #main { padding: 0 var(--space-4) var(--space-4); }
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
  </style>
</head>
<body>
<div id="app">
  <div class="sidebar-backdrop" onclick="toggleSidebar()"></div>
  <div id="sidebar">
    <div class="sidebar-header">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="sidebar-title">Agent Feed</div>
          <div class="sidebar-subtitle">coding agent decision log</div>
        </div>
        <button class="sidebar-close" onclick="toggleSidebar()" aria-label="Close sidebar">&times;</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="Search sessions..." aria-label="Search sessions">
    </div>
    <div class="filter-bar">
      <div class="filter-row">
        <select id="filter-agent">
          <option value="">All agents</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="gemini">Gemini</option>
        </select>
        <input type="date" id="filter-date">
      </div>
    </div>
    <div style="display:flex;border-bottom:1px solid var(--border-default)">
      <button class="tab-btn active" id="tab-sessions" onclick="switchTab('sessions')">Sessions</button>
      <button class="tab-btn" id="tab-trends" onclick="switchTab('trends')">Trends</button>
    </div>
    <div id="session-list"><div class="loading">loading...</div></div>
  </div>
  <div id="main">
    <div class="mobile-header">
      <button class="hamburger" onclick="toggleSidebar()" aria-label="Open sidebar">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></svg>
      </button>
      <span class="mobile-header-title">Agent Feed</span>
    </div>
    <div style="padding:var(--space-6)">
      <div class="empty-state" id="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;margin-bottom:16px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="13" y2="13"/></svg>
        <p style="font-size:15px;color:var(--text-primary);margin-bottom:8px">No session selected</p>
        <p>Select a session from the sidebar to review<br>decisions, assumptions, and architectural choices.</p>
        <div style="margin-top:24px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
          <span style="font-family:IBM Plex Mono,monospace;font-size:11px;color:var(--text-secondary)"><kbd style="padding:2px 6px;border:1px solid var(--border-default);border-radius:3px;background:var(--bg-raised);color:var(--text-primary)">&#8984;K</kbd> search</span>
          <span style="font-family:IBM Plex Mono,monospace;font-size:11px;color:var(--text-secondary)"><kbd style="padding:2px 6px;border:1px solid var(--border-default);border-radius:3px;background:var(--bg-raised);color:var(--text-primary)">j</kbd><kbd style="padding:2px 6px;border:1px solid var(--border-default);border-radius:3px;background:var(--bg-raised);color:var(--text-primary);margin-left:2px">k</kbd> navigate</span>
        </div>
      </div>
      <div id="session-detail" style="display:none"></div>
      <div id="trends-view" style="display:none"></div>
    </div>
  </div>
</div>
<div class="toast-container" id="toast-container"></div>
<script>
const $ = id => document.getElementById(id);
let allSessions = [];
let activeSessionId = null;
let selectAbort = null;
let currentView = 'sessions'; // 'sessions' or 'trends'

// ── Toast system ─────────────────────────────────────────────────────────
const toastState = { active: [], lastMessages: new Map() };
function showToast(message, type = 'info', duration = 3000) {
  const now = Date.now();
  const lastTime = toastState.lastMessages.get(message);
  if (lastTime && now - lastTime < 2000) return;
  toastState.lastMessages.set(message, now);
  if (toastState.active.length >= 3) {
    const oldest = toastState.active.shift();
    oldest.remove();
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  $('toast-container').appendChild(el);
  toastState.active.push(el);
  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => { el.remove(); toastState.active = toastState.active.filter(t => t !== el); }, 150);
  }, duration);
}

// ── Sidebar toggle ───────────────────────────────────────────────────────
function toggleSidebar() { $('app').classList.toggle('sidebar-open'); }
window.matchMedia('(min-width: 1024px)').addEventListener('change', e => {
  if (e.matches) $('app').classList.remove('sidebar-open');
});

// ── Sessions ─────────────────────────────────────────────────────────────
async function loadSessions() {
  const agent = $('filter-agent').value;
  const date = $('filter-date').value;
  let url = '/api/sessions?';
  if (agent) url += 'agent=' + encodeURIComponent(agent) + '&';
  if (date) url += 'date=' + encodeURIComponent(date) + '&';
  try {
    const res = await fetch(url);
    allSessions = await res.json();
    renderSessionList();
  } catch (e) {
    showToast('Failed to load sessions: ' + e.message, 'error');
  }
}

function renderSessionList() {
  const list = $('session-list');
  const query = ($('search-input')?.value || '').toLowerCase();
  const filtered = getFilteredSessions();
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px"><p>' + (query ? 'No matching sessions.' : 'No sessions yet.') + '</p></div>';
    return;
  }
  list.innerHTML = filtered.map(s => {
    const unreviewed = s.unreviewed_flags ?? 0;
    const total = s.total_flags ?? 0;
    const badgeClass = unreviewed > 0 ? 'badge-unreviewed' : 'badge-ok';
    const badgeText = unreviewed > 0 ? unreviewed + ' unreviewed' : 'reviewed';
    const date = formatDate(s.latest_timestamp);
    const active = s.session_id === activeSessionId ? ' active' : '';
    return '<div class="session-item' + active + '" tabindex="0" onclick="selectSession(' + escAttr(s.session_id) + ')" onkeydown="if(event.key===&apos;Enter&apos;)selectSession(' + escAttr(s.session_id) + ')">' +
      '<div class="session-id">' + esc(s.repo || s.session_id) + '</div>' +
      '<div class="session-meta"><span>' + esc(s.agent || '') + '</span><span>' + date + '</span>' + (s.repo ? '<span style="color:var(--text-tertiary);font-family:IBM Plex Mono,monospace;font-size:10px">' + esc(s.session_id).slice(0, 12) + '&hellip;</span>' : '') + '</div>' +
      '<div class="session-meta" style="margin-top:3px"><span class="session-badge ' + badgeClass + '">' + badgeText + '</span>' +
      '<span class="session-badge" style="background:var(--bg-raised);color:var(--text-secondary)">' + s.turn_count + ' turn' + (s.turn_count !== 1 ? 's' : '') + '</span></div>' +
      '</div>';
  }).join('');
}

async function selectSession(sessionId) {
  if (selectAbort) selectAbort.abort();
  selectAbort = new AbortController();
  activeSessionId = sessionId;
  renderSessionList();
  if (currentView === 'trends') switchTab('sessions');
  $('empty-state').style.display = 'none';
  $('trends-view').style.display = 'none';
  $('session-detail').style.display = 'block';
  $('session-detail').innerHTML = '<div class="loading"><span class="spinner"></span> loading session...</div>';
  // Close sidebar on mobile after selection
  $('app').classList.remove('sidebar-open');
  try {
    const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId), { signal: selectAbort.signal });
    if (!res.ok) { $('session-detail').innerHTML = '<div class="empty-state"><p>Session not found.</p></div>'; return; }
    const records = await res.json();
    renderSessionDetail(sessionId, records);
  } catch (e) {
    if (e.name === 'AbortError') return;
    showToast('Failed to load session: ' + e.message, 'error');
    $('session-detail').innerHTML = '<div class="empty-state"><p>Failed to load session.</p></div>';
  }
}

function renderSessionDetail(sessionId, records) {
  const allFlags = records.flatMap(r => r.flags || []);
  const unreviewed = allFlags.filter(f => f.review_status === 'unreviewed').length;
  const accepted = allFlags.filter(f => f.review_status === 'accepted').length;
  const needsChange = allFlags.filter(f => f.review_status === 'needs_change').length;
  const falsePos = allFlags.filter(f => f.review_status === 'false_positive').length;
  const first = records[0] || {};
  const title = first.repo || sessionId;
  const date = formatDate(first.timestamp);

  let html = '<div class="page-header"><div class="page-title">' + esc(title) + '</div>' +
    '<div class="page-meta">' + esc(first.agent || '') + ' &nbsp;&middot;&nbsp; ' + esc(first.model || '') + ' &nbsp;&middot;&nbsp; ' + date +
    (first.git_branch ? ' &nbsp;&middot;&nbsp; ' + esc(first.git_branch) : '') + '</div></div>';

  // stat cards
  html += '<div class="stat-grid">' +
    '<div class="stat-card"><div class="stat-value">' + allFlags.length + '</div><div class="stat-label">total flags</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:' + (unreviewed > 0 ? 'var(--yellow)' : 'var(--text-primary)') + '">' + unreviewed + '</div><div class="stat-label">unreviewed</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:var(--green)">' + accepted + '</div><div class="stat-label">accepted</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:var(--yellow)">' + needsChange + '</div><div class="stat-label">needs change</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:var(--red)">' + falsePos + '</div><div class="stat-label">false positive</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + records.length + '</div><div class="stat-label">turns</div></div>' +
    '</div>';

  // bulk actions
  if (unreviewed > 0) {
    window._pendingBulkIds = allFlags.filter(f => f.review_status === 'unreviewed').map(f => f.id);
    html += '<div class="bulk-bar">' +
      '<span class="bulk-label">' + unreviewed + ' unreviewed flags</span>' +
      '<button class="bulk-btn bulk-btn-accept" onclick="bulkAction(&apos;accepted&apos;)">accept all</button>' +
      '<button class="bulk-btn bulk-btn-fp" onclick="bulkAction(&apos;false_positive&apos;)">mark all FP</button>' +
      '</div>';
  }

  html += records.map(r => renderTurn(r)).join('');
  $('session-detail').innerHTML = html;
}

async function bulkAction(status) {
  const flagIds = window._pendingBulkIds || [];
  if (!flagIds.length) return;
  if (!confirm('Update ' + flagIds.length + ' flags to "' + status.replace('_', ' ') + '"?')) return;
  try {
    const res = await fetch('/api/flags/bulk', {
      method: 'PATCH', headers: {'content-type':'application/json'},
      body: JSON.stringify({ flag_ids: flagIds, review_status: status })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Bulk update failed'); }
    showToast(flagIds.length + ' flags updated', 'success');
    await refreshSessionDetail();
  } catch (e) {
    showToast('Bulk action failed: ' + e.message, 'error');
  }
}

function renderTurn(record) {
  const flags = record.flags || [];
  const ts = new Date(record.timestamp).toLocaleTimeString();
  const flagsHtml = flags.length
    ? flags.map(f => renderFlag(f)).join('')
    : '<div style="padding:10px 14px;font-size:12px;color:var(--text-tertiary)">No flags extracted</div>';
  return '<div class="turn-block" id="turn-' + esc(record.id) + '">' +
    '<div class="turn-header"><span class="turn-label">Turn ' + record.turn_index + ' &nbsp;&middot;&nbsp; ' + ts + '</span>' +
    '<button class="raw-toggle" onclick="toggleRaw(' + escAttr(record.id) + ', ' + escAttr(activeSessionId) + ')">[ raw ]</button></div>' +
    '<div class="turn-summary">' + esc(record.response_summary) + '</div>' +
    flagsHtml +
    '<div id="raw-' + esc(record.id) + '" style="display:none"></div>' +
    '</div>';
}

function renderFlag(flag) {
  const btns = ['accepted','needs_change','false_positive'].map(s => {
    const label = {accepted:'accept',needs_change:'needs change',false_positive:'false positive'}[s];
    const cls = flag.review_status === s ? ' active-' + s : '';
    return '<button class="status-btn' + cls + '" onclick="setStatus(' + escAttr(flag.id) + ',' + escAttr(s) + ')">' + label + '</button>';
  }).join('');
  const borderColor = 'var(--color-' + esc(flag.type) + ', var(--accent))';
  return '<div class="flag-card" id="flag-' + esc(flag.id) + '" style="border-left-color:' + borderColor + '">' +
    '<div class="flag-header"><span class="flag-type type-' + esc(flag.type) + '">' + esc(flag.type) + '</span>' +
    '<span class="flag-confidence">' + Math.round(flag.confidence * 100) + '% confidence</span></div>' +
    '<div class="flag-content">' + esc(flag.content) + '</div>' +
    '<div class="flag-status-row">' + btns + '</div>' +
    '<div class="flag-notes">' +
    '<input type="text" id="note-' + esc(flag.id) + '" placeholder="Reviewer note..." value="' + esc(flag.reviewer_note || '') + '">' +
    '<input type="text" id="outcome-' + esc(flag.id) + '" placeholder="Outcome..." value="' + esc(flag.outcome || '') + '">' +
    '<button class="save-btn" onclick="saveNotes(' + escAttr(flag.id) + ')">save</button>' +
    '</div></div>';
}

async function refreshSessionDetail() {
  const res = await fetch('/api/sessions/' + encodeURIComponent(activeSessionId));
  if (res.ok) renderSessionDetail(activeSessionId, await res.json());
  loadSessions();
}

async function setStatus(flagId, status) {
  try {
    await fetch('/api/flags/' + encodeURIComponent(flagId), {
      method: 'PATCH', headers: {'content-type':'application/json'},
      body: JSON.stringify({ review_status: status })
    });
    showToast('Flag updated', 'success', 2000);
    await refreshSessionDetail();
  } catch (e) {
    showToast('Failed to update flag: ' + e.message, 'error');
  }
}

async function saveNotes(flagId) {
  try {
    const note = document.getElementById('note-' + flagId)?.value || '';
    const outcome = document.getElementById('outcome-' + flagId)?.value || '';
    await fetch('/api/flags/' + encodeURIComponent(flagId), {
      method: 'PATCH', headers: {'content-type':'application/json'},
      body: JSON.stringify({ reviewer_note: note, outcome })
    });
    showToast('Notes saved', 'success', 2000);
  } catch (e) {
    showToast('Failed to save notes: ' + e.message, 'error');
  }
}

async function toggleRaw(recordId, sessionId) {
  const el = document.getElementById('raw-' + recordId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  if (!el.dataset.loaded) {
    try {
      el.innerHTML = '<div class="loading" style="padding:var(--space-3)"><span class="spinner"></span> loading...</div>';
      el.style.display = 'block';
      const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/records/' + encodeURIComponent(recordId) + '/raw');
      const data = await res.json();
      let pretty = data.raw_response;
      try { pretty = JSON.stringify(JSON.parse(data.raw_response), null, 2); } catch { /* raw_response not valid JSON, use as-is */ }
      el.innerHTML = '<div class="raw-response">' + esc(pretty) + '</div>';
      el.dataset.loaded = '1';
      return;
    } catch (e) {
      showToast('Failed to load raw response: ' + e.message, 'error');
      el.style.display = 'none';
      return;
    }
  }
  el.style.display = 'block';
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return JSON.stringify(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

$('filter-agent').addEventListener('change', loadSessions);
$('filter-date').addEventListener('change', loadSessions);
$('search-input').addEventListener('input', renderSessionList);
loadSessions();

// ── Tabs (trends now renders in main panel) ──────────────────────────────
function switchTab(tab) {
  currentView = tab;
  const isSessions = tab === 'sessions';
  $('tab-sessions').classList.toggle('active', isSessions);
  $('tab-trends').classList.toggle('active', !isSessions);
  $('session-list').style.display = isSessions ? '' : 'none';
  if (isSessions) {
    $('trends-view').style.display = 'none';
    if (activeSessionId) { $('session-detail').style.display = 'block'; $('empty-state').style.display = 'none'; }
    else { $('session-detail').style.display = 'none'; $('empty-state').style.display = ''; }
  } else {
    $('session-detail').style.display = 'none';
    $('empty-state').style.display = 'none';
    $('trends-view').style.display = 'block';
    loadTrends();
  }
}

async function loadTrends() {
  const agent = $('filter-agent').value;
  const date  = $('filter-date').value;
  let url = '/api/trends?';
  if (agent) url += 'agent=' + encodeURIComponent(agent) + '&';
  if (date)  url += 'dateFrom=' + encodeURIComponent(date) + '&dateTo=' + encodeURIComponent(date) + '&';
  try {
    $('trends-view').innerHTML = '<div class="loading"><span class="spinner"></span> loading trends...</div>';
    const res = await fetch(url);
    const data = await res.json();
    renderTrends(data);
  } catch (e) {
    showToast('Failed to load trends: ' + e.message, 'error');
    $('trends-view').innerHTML = '<div class="empty-state"><p>Failed to load trends.</p></div>';
  }
}

function renderTrends(data) {
  const panel = $('trends-view');
  const maxCount = Math.max(...(data.by_type.map(t => t.count)), 1);

  const cs = getComputedStyle(document.documentElement);
  const typeColor = t => cs.getPropertyValue('--color-' + t).trim() || 'var(--accent)';

  const byTypeHtml = data.by_type.length ? data.by_type.map(t => {
    const pct = Math.round((t.count / maxCount) * 100);
    const fpPct = Math.round(t.false_positive_rate * 100);
    const color = typeColor(t.type);
    return '<div class="trend-row">' +
      '<span class="trend-type-label" style="color:' + color + '">' + esc(t.type) + '</span>' +
      '<div class="trend-bar-wrap"><div class="trend-bar" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '<span class="trend-count">' + t.count + '</span>' +
      (fpPct > 0 ? '<span class="trend-fp">' + fpPct + '%fp</span>' : '<span class="trend-fp"></span>') +
      '</div>';
  }).join('') : '<div style="font-size:12px;color:var(--text-tertiary)">No flags yet</div>';

  const bySessionHtml = data.by_session.length ? data.by_session.map(s =>
    '<div class="trend-session-row" onclick="switchTab(&apos;sessions&apos;);selectSession(' + escAttr(s.session_id) + ')">' +
    '<span class="trend-session-id">' + esc(s.repo || s.session_id) + '</span>' +
    '<span class="trend-session-count">' + (s.flag_count || 0) + ' flags</span>' +
    '</div>'
  ).join('') : '<div style="font-size:12px;color:var(--text-tertiary)">No sessions yet</div>';

  panel.innerHTML =
    '<div class="page-header"><div class="page-title">Trends</div>' +
      '<div class="page-meta">' + data.total_flags + ' total flags across ' + data.by_session.length + ' sessions</div></div>' +
    '<div class="trends-section">' +
      '<div class="trends-label">By Type</div>' +
      byTypeHtml +
    '</div>' +
    '<div class="trends-section">' +
      '<div class="trends-label">By Session</div>' +
      bySessionHtml +
    '</div>';
}

// ── Keyboard navigation ──────────────────────────────────────────────────
function getSessionIndex() {
  if (!activeSessionId || !allSessions.length) return -1;
  return allSessions.findIndex(s => s.session_id === activeSessionId);
}

function getFilteredSessions(q) {
  const query = q !== undefined ? q : ($('search-input')?.value || '').toLowerCase();
  if (!query) return allSessions;
  return allSessions.filter(s =>
    (s.repo || '').toLowerCase().includes(query) ||
    (s.session_id || '').toLowerCase().includes(query) ||
    (s.agent || '').toLowerCase().includes(query)
  );
}

function navigateSession(delta) {
  if (currentView !== 'sessions') return;
  const filtered = getFilteredSessions();
  if (!filtered.length) return;
  const idx = filtered.findIndex(s => s.session_id === activeSessionId);
  const next = Math.max(0, Math.min(filtered.length - 1, (idx < 0 ? 0 : idx) + delta));
  selectSession(filtered[next].session_id);
  setTimeout(() => {
    const items = $('session-list').querySelectorAll('.session-item');
    if (items[next]) items[next].scrollIntoView({ block: 'nearest' });
  }, 50);
}

document.addEventListener('keydown', e => {
  // Skip when focus is in input/textarea/select
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  // Cmd+K / Ctrl+K — command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
    return;
  }
  // Escape — close sidebar on mobile
  if (e.key === 'Escape') {
    $('app').classList.remove('sidebar-open');
    return;
  }
  // j/ArrowDown — next session
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); navigateSession(1); return; }
  // k/ArrowUp — previous session
  if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); navigateSession(-1); return; }
});

// ── Command palette (Cmd+K) ─────────────────────────────────────────────
function openCommandPalette() {
  if (document.getElementById('cmd-palette')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'cmd-backdrop';
  backdrop.id = 'cmd-palette';
  const modal = document.createElement('div');
  modal.className = 'cmd-modal';
  const input = document.createElement('input');
  input.className = 'cmd-input';
  input.placeholder = 'Search sessions...';
  const results = document.createElement('div');
  results.className = 'cmd-results';
  modal.appendChild(input);
  modal.appendChild(results);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  input.focus();

  let activeIdx = 0;
  function render() {
    const filtered = getFilteredSessions(input.value.toLowerCase()).slice(0, 15);
    if (!filtered.length) {
      results.innerHTML = '<div class="cmd-empty">No sessions found</div>';
      return;
    }
    activeIdx = Math.min(activeIdx, filtered.length - 1);
    results.innerHTML = filtered.map((s, i) => {
      const title = esc(s.repo || s.session_id);
      const meta = esc(s.agent || '') + ' &middot; ' + (s.unreviewed_flags ?? 0) + ' unreviewed';
      return '<div class="cmd-item' + (i === activeIdx ? ' active' : '') + '" data-sid="' + esc(s.session_id) + '">' +
        '<span class="cmd-item-title">' + title + '</span>' +
        '<span class="cmd-item-meta">' + meta + '</span></div>';
    }).join('');
  }
  render();

  function close() { backdrop.remove(); }
  function selectActive() {
    const items = results.querySelectorAll('.cmd-item');
    if (items[activeIdx]) {
      selectSession(items[activeIdx].dataset.sid);
      close();
    }
  }

  input.addEventListener('input', () => { activeIdx = 0; render(); });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  results.addEventListener('click', e => {
    const item = e.target.closest('.cmd-item');
    if (item) { selectSession(item.dataset.sid); close(); }
  });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, results.querySelectorAll('.cmd-item').length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); selectActive(); }
  });
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

    if (method === 'PATCH' && pathname === '/api/flags/bulk') {
      const body = await readBody(req);
      const { flag_ids, review_status } = body;
      if (!Array.isArray(flag_ids) || !flag_ids.length || !flag_ids.every(id => typeof id === 'string' && id.length > 0)) {
        return json(res, 400, { error: 'flag_ids must be a non-empty array of strings' });
      }
      if (!review_status || !VALID_REVIEW_STATUSES.includes(review_status)) {
        return json(res, 400, { error: `Invalid review_status: ${review_status}` });
      }
      try {
        await db.bulkUpdateFlagReview(flag_ids, review_status);
        return json(res, 200, { ok: true, updated: flag_ids.length });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
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
