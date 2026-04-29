import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '../src/storage/database.js';
import { Pipeline } from '../src/pipeline.js';
import { OtelSink } from '../src/otel/sink.js';
import { parseLogs } from '../src/otel/parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'otel');

function recordsFromFixture(file) {
  const out = [];
  const lines = fs.readFileSync(path.join(fixturesDir, file), 'utf8').trim().split('\n');
  for (const l of lines) {
    const env = JSON.parse(l);
    if (env.url === '/v1/logs' && env.bodyJson) out.push(...parseLogs(env.bodyJson));
  }
  return out;
}

describe('OTel sink — Claude fixture', () => {
  it('ingests fixture: writes events table and records for api_response_body', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });
    const sink = new OtelSink({ db });
    const records = recordsFromFixture('claude.ndjson');

    const counts = await sink.ingestLogs(records);
    assert.ok(counts.events > 0,  'at least one event row written');
    assert.ok(counts.records > 0, 'at least one records row written');

    // verify event_kinds present in DB
    const sessionIds = db.db.prepare('SELECT DISTINCT session_id FROM events').all().map(r => r.session_id);
    assert.ok(sessionIds.length > 0);

    const kinds = db.db.prepare(`SELECT DISTINCT event_kind FROM events WHERE session_id = ?`).all(sessionIds[0]).map(r => r.event_kind);
    for (const k of ['user_prompt', 'tool_decision', 'tool_result', 'mcp', 'hook', 'api_response_body']) {
      assert.ok(kinds.includes(k), `missing kind ${k} in DB; got ${kinds.join(',')}`);
    }
    await db.close();
  });

  it('records rows for api_response_body have request_id and source=otel', async () => {
    const db = new Database(':memory:');
    await db.init();
    const sink = new OtelSink({ db });
    await sink.ingestLogs(recordsFromFixture('claude.ndjson'));

    const rows = db.db.prepare(`SELECT source, request_id, model FROM records`).all();
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.source, 'otel');
      assert.ok(r.request_id, 'request_id required on otel records');
      assert.ok(r.model);
    }
    await db.close();
  });

  it('is idempotent on re-ingestion (deterministic event ids)', async () => {
    const db = new Database(':memory:');
    await db.init();
    const sink = new OtelSink({ db });
    const records = recordsFromFixture('claude.ndjson');
    await sink.ingestLogs(records);
    const before = db.db.prepare('SELECT COUNT(*) as n FROM events').get().n;
    await sink.ingestLogs(records);
    const after = db.db.prepare('SELECT COUNT(*) as n FROM events').get().n;
    assert.equal(after, before, 're-ingest must not duplicate events');
    await db.close();
  });

  it('strips PII from stored event attributes', async () => {
    const db = new Database(':memory:');
    await db.init();
    const sink = new OtelSink({ db });
    await sink.ingestLogs(recordsFromFixture('claude.ndjson'));

    const all = db.db.prepare('SELECT attributes FROM events').all();
    for (const r of all) {
      const attrs = JSON.parse(r.attributes);
      assert.equal(attrs['user.email'],         undefined);
      assert.equal(attrs['user.id'],            undefined);
      assert.equal(attrs['user.account_uuid'],  undefined);
      assert.equal(attrs['user.account_id'],    undefined);
      assert.equal(attrs['organization.id'],    undefined);
    }
    await db.close();
  });
});

describe('OTel sink — Gemini fixture', () => {
  it('ingests gemini events and registers session mapping', async () => {
    const db = new Database(':memory:');
    await db.init();
    const sink = new OtelSink({ db });
    const records = recordsFromFixture('gemini.ndjson');

    const counts = await sink.ingestLogs(records);
    assert.ok(counts.events > 0);

    const kinds = db.db.prepare(`SELECT DISTINCT event_kind FROM events WHERE agent = 'gemini'`).all().map(r => r.event_kind);
    assert.ok(kinds.includes('user_prompt'), `expected user_prompt in ${kinds.join(',')}`);
    await db.close();
  });
});

describe('OTel sink — error handling', () => {
  it('skips records without a session id', async () => {
    const db = new Database(':memory:');
    await db.init();
    const sink = new OtelSink({ db });

    const counts = await sink.ingestLogs([{
      name: 'claude_code.user_prompt',
      time: '2026-04-29T00:00:00.000Z',
      attrs: { /* no session.id */ },
      resource: {},
    }]);
    assert.equal(counts.skipped, 1);
    assert.ok(!counts.events, 'no events written when session.id missing');
    await db.close();
  });

  it('skips records with no matching adapter', async () => {
    const db = new Database(':memory:');
    await db.init();
    const sink = new OtelSink({ db });

    const counts = await sink.ingestLogs([{
      name: 'random.foreign.event',
      attrs: { 'session.id': 'abc' },
      resource: {},
    }]);
    assert.equal(counts.skipped, 1);
    await db.close();
  });
});
