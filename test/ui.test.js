import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Database } from '../src/storage/database.js';
import { createUIServer } from '../src/ui/server.js';

function request(port, pathname, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: pathname,
      method,
      headers: { 'content-type': 'application/json' },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('UI Server API', () => {
  let tmpDir;
  let db;
  let uiServer;
  let port;
  let sessionId;
  let recordId;
  let flagId;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-ui-'));
    db = new Database(path.join(tmpDir, 'ui-test.db'));
    await db.init();

    // Seed data
    sessionId = 'sess-ui-test-001';
    recordId = await db.insertRecord({
      timestamp: new Date().toISOString(),
      agent: 'claude-code',
      session_id: sessionId,
      turn_index: 1,
      working_directory: '/tmp/project',
      repo: 'my-repo',
      git_branch: 'main',
      git_commit: 'abc123',
      response_summary: 'Decided to use JWT for auth',
      raw_response: JSON.stringify({ content: 'full response here' }),
      model: 'claude-sonnet-4-6',
      token_count: 150,
    });

    flagId = await db.insertFlag({
      record_id: recordId,
      type: 'decision',
      content: 'Use JWT over session cookies',
      confidence: 0.95,
    });

    uiServer = createUIServer({ db });
    await uiServer.listen(0);
    port = uiServer.port;
  });

  after(async () => {
    await uiServer.close();
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('GET /api/sessions', () => {
    it('returns list of sessions', async () => {
      const res = await request(port, '/api/sessions');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 1);
      const session = res.body.find(s => s.session_id === sessionId);
      assert.ok(session, 'seeded session should appear');
      assert.ok(session.latest_timestamp);
      assert.ok(session.turn_count >= 1);
    });

    it('supports agent filter', async () => {
      const res = await request(port, '/api/sessions?agent=claude-code');
      assert.equal(res.status, 200);
      assert.ok(res.body.every(s => s.agent === 'claude-code'));
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns records for a session with flags', async () => {
      const res = await request(port, `/api/sessions/${sessionId}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 1);
      const record = res.body[0];
      assert.equal(record.session_id, sessionId);
      assert.ok(Array.isArray(record.flags));
      assert.equal(record.flags.length, 1);
      assert.equal(record.flags[0].type, 'decision');
    });

    it('returns 404 for unknown session', async () => {
      const res = await request(port, '/api/sessions/nonexistent-session');
      assert.equal(res.status, 404);
    });
  });

  describe('PATCH /api/flags/:id', () => {
    it('updates flag review status', async () => {
      const res = await request(port, `/api/flags/${flagId}`, 'PATCH', {
        review_status: 'accepted',
        reviewer_note: 'correct decision',
        outcome: 'no change needed',
      });
      assert.equal(res.status, 200);

      // Verify persisted
      const session = await request(port, `/api/sessions/${sessionId}`);
      const flag = session.body[0].flags.find(f => f.id === flagId);
      assert.equal(flag.review_status, 'accepted');
      assert.equal(flag.reviewer_note, 'correct decision');
    });

    it('returns 400 for invalid review_status', async () => {
      const res = await request(port, `/api/flags/${flagId}`, 'PATCH', {
        review_status: 'invalid_status',
      });
      assert.equal(res.status, 400);
    });
  });

  describe('GET /api/sessions/:id/records/:recordId/raw', () => {
    it('returns raw response for a record', async () => {
      const res = await request(port, `/api/sessions/${sessionId}/records/${recordId}/raw`);
      assert.equal(res.status, 200);
      assert.ok(res.body.raw_response);
    });
  });

  describe('GET /', () => {
    it('serves HTML for the root route', async () => {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port, path: '/' }, res => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/html'));
      assert.ok(res.body.includes('<!DOCTYPE html>'));
    });
  });
});
