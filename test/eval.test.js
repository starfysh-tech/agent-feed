import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/storage/database.js';
import { runClassifierEval } from '../src/eval.js';

describe('runClassifierEval', () => {
  let tmpDir, db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-eval-'));
    db = new Database(path.join(tmpDir, 'eval.db'));
    await db.init();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns zero counts when no labeled flags exist', async () => {
    const mockClassifier = async () => ({ response_summary: '', flags: [] });
    const report = await runClassifierEval({ db, classifierFn: mockClassifier });
    assert.equal(report.labeled_samples, 0);
    assert.ok(Array.isArray(report.by_type));
  });

  it('reports precision, recall, F1 across labeled samples', async () => {
    // Seed records with labeled flags
    const pairs = [
      { type: 'decision',   status: 'accepted',       raw: 'I decided to use JWT for auth' },
      { type: 'assumption', status: 'accepted',       raw: 'Assuming docker is available' },
      { type: 'decision',   status: 'false_positive', raw: 'Here is the list of files' },
      { type: 'risk',       status: 'needs_change',   raw: 'This could break in production' },
    ];

    for (const p of pairs) {
      const recordId = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: 'eval-sess-' + Math.random(),
        turn_index: 1,
        working_directory: '/tmp',
        response_summary: 'test',
        raw_response: p.raw,
        model: 'claude-sonnet-4-6',
      });
      const flagId = await db.insertFlag({
        record_id: recordId,
        type: p.type,
        content: p.raw,
        confidence: 0.9,
      });
      await db.updateFlagReview(flagId, { review_status: p.status });
    }

    // Mock classifier that re-extracts the same flags for accepted/needs_change
    // and misses the false_positive
    const mockClassifier = async (content) => {
      if (content.includes('files')) {
        return { response_summary: 'listed files', flags: [] };
      }
      if (content.includes('JWT')) {
        return { response_summary: 'jwt decision', flags: [{ type: 'decision', content, confidence: 0.9 }] };
      }
      if (content.includes('docker')) {
        return { response_summary: 'docker assumption', flags: [{ type: 'assumption', content, confidence: 0.85 }] };
      }
      if (content.includes('production')) {
        return { response_summary: 'risk', flags: [{ type: 'risk', content, confidence: 0.8 }] };
      }
      return { response_summary: '', flags: [] };
    };

    const report = await runClassifierEval({ db, classifierFn: mockClassifier });

    assert.equal(report.labeled_samples, 4);
    assert.ok(typeof report.overall.precision === 'number');
    assert.ok(typeof report.overall.recall === 'number');
    assert.ok(typeof report.overall.f1 === 'number');
    assert.ok(Array.isArray(report.by_type));
    assert.ok(report.by_type.length > 0);
  });

  it('notes types below minimum sample threshold', async () => {
    const mockClassifier = async () => ({ response_summary: '', flags: [] });
    const report = await runClassifierEval({ db, classifierFn: mockClassifier, minSamples: 10 });
    assert.ok(Array.isArray(report.below_threshold));
  });
});
