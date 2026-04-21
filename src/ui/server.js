import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'frontend', 'dist');

const VALID_REVIEW_STATUSES = ['unreviewed', 'accepted', 'needs_change', 'false_positive'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'content-type': mime });
    res.end(content);
  } catch {
    return false;
  }
  return true;
}

export function createUIServer({ db }) {
  let server = null;
  let _port = null;

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;
    const method = req.method;

    // ── API routes ──────────────────────────────────────────────────────

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
      if (dateFilter) sessions = sessions.filter(s => s.latest_timestamp >= dateFilter);
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

    // ── Static file serving ─────────────────────────────────────────────

    if (method === 'GET') {
      // Try exact file path first
      const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(DIST_DIR, safePath);
      if (filePath.startsWith(DIST_DIR) && serveStatic(res, filePath)) return;

      // SPA fallback: serve index.html for non-API, non-file routes
      const indexPath = path.join(DIST_DIR, 'index.html');
      if (serveStatic(res, indexPath)) return;

      // No dist/ built yet
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Frontend not built. Run: cd src/ui/frontend && npm run build');
      return;
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
