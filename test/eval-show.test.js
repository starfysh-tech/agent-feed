import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/storage/database.js';
import { runClassifierEval, getEvalExamples, formatEvalReport, formatEvalExamples } from '../src/eval.js';

describe('getEvalExamples', () => {
  let tmpDir, db, mockClassifier;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-eval-show-'));
    db = new Database(path.join(tmpDir, 'eval-show.db'));
    await db.init();

    // Seed labeled flags with varied outcomes
    const cases = [
      // true positive: classifier finds it, reviewer accepted it
      { type: 'decision',   status: 'accepted',       raw: 'I decided to use JWT for stateless auth', predictedType: 'decision' },
      // false negative: classifier misses it, reviewer accepted it
      { type: 'assumption', status: 'accepted',       raw: 'Assuming postgres is available on port 5432', predictedType: null },
      // false positive: classifier flags it, reviewer marked false_positive
      { type: 'risk',       status: 'false_positive', raw: 'Here is the list of files in the directory', predictedType: 'risk' },
      // true negative: classifier correctly does not flag it
      { type: 'workaround', status: 'false_positive', raw: 'The cat sat on the mat', predictedType: null },
    ];

    for (const c of cases) {
      const recordId = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: 'show-sess-' + Math.random(),
        turn_index: 1,
        working_directory: '/tmp',
        response_summary: 'test',
        raw_response: c.raw,
        model: 'claude-sonnet-4-6',
      });
      const flagId = await db.insertFlag({
        record_id: recordId,
        type: c.type,
        content: c.raw,
        confidence: 0.9,
      });
      await db.updateFlagReview(flagId, { review_status: c.status });
    }

    // Mock classifier that only finds decisions, misses assumptions, incorrectly flags risk
    mockClassifier = async (content) => {
      if (content.includes('JWT')) {
        return { response_summary: '', flags: [{ type: 'decision', content, confidence: 0.95 }] };
      }
      if (content.includes('files in the directory')) {
        return { response_summary: '', flags: [{ type: 'risk', content, confidence: 0.75 }] };
      }
      return { response_summary: '', flags: [] };
    };
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns missed flags (false negatives)', async () => {
    const examples = await getEvalExamples({ db, classifierFn: mockClassifier });
    assert.ok(Array.isArray(examples.missed));
    const missed = examples.missed;
    // assumption flag was accepted but classifier missed it
    assert.ok(missed.some(m => m.type === 'assumption'));
    // each missed entry has content and raw_response snippet
    assert.ok(missed[0].content);
    assert.ok(missed[0].raw_snippet);
    assert.ok(missed[0].type);
  });

  it('returns false positives', async () => {
    const examples = await getEvalExamples({ db, classifierFn: mockClassifier });
    assert.ok(Array.isArray(examples.false_positives));
    const fp = examples.false_positives;
    // risk flag on benign content was a false positive
    assert.ok(fp.some(f => f.type === 'risk'));
    assert.ok(fp[0].content);
    assert.ok(fp[0].raw_snippet);
  });

  it('returns counts summary', async () => {
    const examples = await getEvalExamples({ db, classifierFn: mockClassifier });
    assert.ok(typeof examples.total_labeled === 'number');
    assert.ok(typeof examples.true_positive_count === 'number');
    assert.ok(typeof examples.false_negative_count === 'number');
    assert.ok(typeof examples.false_positive_count === 'number');
  });
});

describe('formatEvalExamples', () => {
  it('returns a non-empty string with missed and false positive sections', () => {
    const examples = {
      total_labeled: 10,
      true_positive_count: 6,
      false_negative_count: 2,
      false_positive_count: 2,
      missed: [
        { type: 'assumption', content: 'Assuming docker is available', raw_snippet: 'Assuming docker is available on port 5432' },
      ],
      false_positives: [
        { type: 'risk', content: 'listed files', raw_snippet: 'Here is the list of files' },
      ],
    };
    const output = formatEvalExamples(examples);
    assert.ok(typeof output === 'string');
    assert.ok(output.includes('Missed'));
    assert.ok(output.includes('False Positive'));
    assert.ok(output.includes('assumption'));
    assert.ok(output.includes('risk'));
  });

  it('handles empty missed and false_positives gracefully', () => {
    const examples = {
      total_labeled: 5,
      true_positive_count: 5,
      false_negative_count: 0,
      false_positive_count: 0,
      missed: [],
      false_positives: [],
    };
    const output = formatEvalExamples(examples);
    assert.ok(typeof output === 'string');
    assert.ok(output.length > 0);
  });
});
