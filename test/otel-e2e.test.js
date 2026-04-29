// End-to-end: replays the validated Claude OTel fixture against a live
// receiver wired through the full pipeline (sink -> pipeline -> database)
// and asserts that records, events, coalesce queries, and PII scrubbing all
// behave correctly together.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '../src/storage/database.js';
import { Pipeline } from '../src/pipeline.js';
import { OtelSink } from '../src/otel/sink.js';
import { OtelReceiver } from '../src/otel/receiver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures', 'otel');

const silent = { info() {}, warn() {}, error() {} };

async function buildStack() {
  const db = new Database(':memory:');
  await db.init();
  const pipeline = new Pipeline({ db, classifierFn: null });
  const sink = new OtelSink({ db });
  const receiver = new OtelReceiver({ sink, port: 0, host: '127.0.0.1', logger: silent });
  await receiver.start();
  return { db, pipeline, sink, receiver, port: receiver.server.address().port };
}

async function replayFixture(port, file) {
  const lines = fs.readFileSync(path.join(fixtures, file), 'utf8').trim().split('\n');
  for (const line of lines) {
    const env = JSON.parse(line);
    if (!env.bodyJson) continue;
    if (!['/v1/logs', '/v1/metrics', '/v1/traces'].includes(env.url)) continue;
    const res = await fetch(`http://127.0.0.1:${port}${env.url}`, {
      method: 'POST',
      headers: { 'content-type': env.contentType ?? 'application/json' },
      body: JSON.stringify(env.bodyJson),
    });
    // Critical: receiver must always 200 on ingest paths
    assert.equal(res.status, 200, `${env.url} returned ${res.status}`);
  }
}

describe('OTel end-to-end', () => {
  it('replays Claude fixture: records, events, PII scrub, coalesce all behave', async () => {
    const { db, receiver, port } = await buildStack();
    try {
      await replayFixture(port, 'claude.ndjson');

      // Records inserted from api_response_body events
      const recordCount = db.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE source = 'otel'`).get().n;
      assert.ok(recordCount > 0, 'should write at least one OTel record');

      // Events inserted for all kinds
      const kinds = db.db.prepare('SELECT DISTINCT event_kind FROM events').all().map(r => r.event_kind);
      for (const k of ['user_prompt', 'tool_decision', 'tool_result', 'mcp', 'hook', 'api_response_body']) {
        assert.ok(kinds.includes(k), `expected kind ${k}; got ${kinds.join(',')}`);
      }

      // PII scrub: no email-shaped strings, no banned attribute keys
      const allAttrs = db.db.prepare('SELECT attributes FROM events').all();
      const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      for (const r of allAttrs) {
        const text = r.attributes;
        assert.equal(EMAIL_RE.test(text), false, 'no email-shaped strings in stored attrs');
        for (const banned of ['user.email', 'user.id', 'user.account_uuid', 'organization.id']) {
          assert.equal(text.includes(`"${banned}"`), false, `${banned} must be scrubbed`);
        }
      }

      // Coalesce: take any session and verify getCoalescedRecordsWithFlags is non-empty
      const sessionId = db.db.prepare('SELECT session_id FROM records LIMIT 1').get().session_id;
      const coalesced = await db.getCoalescedRecordsWithFlags(sessionId);
      assert.ok(coalesced.length > 0);

      // Idempotent re-ingest: counts unchanged
      const eventsBefore = db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
      await replayFixture(port, 'claude.ndjson');
      const eventsAfter = db.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
      assert.equal(eventsAfter, eventsBefore, 're-ingest must not duplicate events');
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('replays Gemini fixture: events stored with gemini agent tag', async () => {
    const { db, receiver, port } = await buildStack();
    try {
      await replayFixture(port, 'gemini.ndjson');
      const geminiEvents = db.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE agent = 'gemini'`).get().n;
      assert.ok(geminiEvents > 0, 'should ingest gemini events');
      const userPrompts = db.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE agent = 'gemini' AND event_kind = 'user_prompt'`).get().n;
      assert.ok(userPrompts > 0);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('receiver returns 200 even on garbage payload (no retry storm)', async () => {
    const { db, receiver, port } = await buildStack();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      });
      assert.equal(res.status, 200);
      assert.equal(receiver.getMetrics().otel_parse_failures_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });
});
