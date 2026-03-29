import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Database } from '../src/storage/database.js';
import { createUIServer } from '../src/ui/server.js';

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path: pathname }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Trends API', () => {
  let tmpDir, db, uiServer, port;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-trends-'));
    db = new Database(path.join(tmpDir, 'trends.db'));
    await db.init();

    // Seed three sessions with varied flag types
    const sessions = [
      { id: 'sess-trends-a', agent: 'claude-code', model: 'claude-sonnet-4-6', repo: 'repo-a', branch: 'main' },
      { id: 'sess-trends-b', agent: 'claude-code', model: 'claude-sonnet-4-6', repo: 'repo-a', branch: 'feature' },
      { id: 'sess-trends-c', agent: 'codex',       model: 'gpt-5',             repo: 'repo-b', branch: 'main' },
    ];

    for (const s of sessions) {
      const recordId = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: s.agent,
        session_id: s.id,
        turn_index: 1,
        working_directory: '/tmp',
        repo: s.repo,
        git_branch: s.branch,
        response_summary: 'did some work',
        raw_response: '{}',
        model: s.model,
      });
      await db.insertFlag({ record_id: recordId, type: 'decision',    content: 'use postgres',  confidence: 0.9 });
      await db.insertFlag({ record_id: recordId, type: 'assumption',  content: 'docker available', confidence: 0.8 });
      if (s.id === 'sess-trends-a') {
        await db.insertFlag({ record_id: recordId, type: 'risk', content: 'no error handling', confidence: 0.75 });
      }
    }

    uiServer = createUIServer({ db });
    await uiServer.listen(0);
    port = uiServer.port;
  });

  after(async () => {
    await uiServer.close();
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('GET /api/trends', () => {
    it('returns total flag count', async () => {
      const res = await request(port, '/api/trends');
      assert.equal(res.status, 200);
      assert.ok(typeof res.body.total_flags === 'number');
      assert.equal(res.body.total_flags, 7); // 2+2+3
    });

    it('returns flag breakdown by type', async () => {
      const res = await request(port, '/api/trends');
      assert.ok(Array.isArray(res.body.by_type));
      const decision = res.body.by_type.find(t => t.type === 'decision');
      assert.ok(decision);
      assert.equal(decision.count, 3);
      const risk = res.body.by_type.find(t => t.type === 'risk');
      assert.equal(risk.count, 1);
    });

    it('returns flag volume by session', async () => {
      const res = await request(port, '/api/trends');
      assert.ok(Array.isArray(res.body.by_session));
      assert.equal(res.body.by_session.length, 3);
    });

    it('supports agent filter', async () => {
      const res = await request(port, '/api/trends?agent=codex');
      assert.equal(res.status, 200);
      assert.equal(res.body.total_flags, 2);
    });

    it('supports repo filter', async () => {
      const res = await request(port, '/api/trends?repo=repo-a');
      assert.equal(res.status, 200);
      assert.equal(res.body.total_flags, 5); // sessions a and b
    });

    it('returns false_positive_rate per type', async () => {
      // Mark one decision flag as false positive
      const records = await db.getSession('sess-trends-a');
      const flags = await db.getFlagsForRecord(records[0].id);
      const decisionFlag = flags.find(f => f.type === 'decision');
      await db.updateFlagReview(decisionFlag.id, { review_status: 'false_positive' });

      const res = await request(port, '/api/trends');
      assert.ok(Array.isArray(res.body.by_type));
      const decision = res.body.by_type.find(t => t.type === 'decision');
      assert.ok(typeof decision.false_positive_rate === 'number');
      assert.ok(decision.false_positive_rate > 0);
    });
  });
});
