import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/storage/database.js';

describe('Database batch methods', () => {
  let tmpDir, db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-batch-'));
    db = new Database(path.join(tmpDir, 'batch.db'));
    await db.init();

    const r1 = await db.insertRecord({
      timestamp: '2026-03-29T10:00:00Z', agent: 'claude-code',
      session_id: 'sess-a', turn_index: 1, working_directory: '/tmp',
      response_summary: 'turn 1', raw_response: '{}', model: 'claude-sonnet-4-6',
    });
    await db.insertFlag({ record_id: r1, type: 'decision', content: 'use jwt', confidence: 0.9 });
    await db.insertFlag({ record_id: r1, type: 'assumption', content: 'docker ok', confidence: 0.8 });

    const r2 = await db.insertRecord({
      timestamp: '2026-03-29T10:01:00Z', agent: 'claude-code',
      session_id: 'sess-a', turn_index: 2, working_directory: '/tmp',
      response_summary: 'turn 2', raw_response: '{}', model: 'claude-sonnet-4-6',
    });
    const flagId = await db.insertFlag({ record_id: r2, type: 'risk', content: 'no tests', confidence: 0.7 });
    await db.updateFlagReview(flagId, { review_status: 'accepted' });

    const r3 = await db.insertRecord({
      timestamp: '2026-03-29T10:02:00Z', agent: 'codex',
      session_id: 'sess-b', turn_index: 1, working_directory: '/tmp',
      response_summary: 'turn 1', raw_response: '{}', model: 'gpt-4',
    });
    await db.insertFlag({ record_id: r3, type: 'decision', content: 'use mongo', confidence: 0.85 });
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('getSessionFlagCounts returns total and unreviewed per session', async () => {
    const counts = await db.getSessionFlagCounts();
    const sessA = counts.find(c => c.session_id === 'sess-a');
    const sessB = counts.find(c => c.session_id === 'sess-b');
    assert.ok(sessA, 'sess-a should be present');
    assert.equal(sessA.total_flags, 3);
    assert.equal(sessA.unreviewed_flags, 2);
    assert.ok(sessB, 'sess-b should be present');
    assert.equal(sessB.total_flags, 1);
    assert.equal(sessB.unreviewed_flags, 1);
  });

  describe('getRecordsWithFlags', () => {
    it('returns records with flags array attached', async () => {
      const records = await db.getRecordsWithFlags('sess-a');
      assert.equal(records.length, 2);
      const turn1 = records.find(r => r.turn_index === 1);
      assert.ok(Array.isArray(turn1.flags));
      assert.equal(turn1.flags.length, 2);
      assert.equal(turn1.flags[0].type, 'decision');
      const turn2 = records.find(r => r.turn_index === 2);
      assert.equal(turn2.flags.length, 1);
      assert.equal(turn2.flags[0].type, 'risk');
    });
  });
});
