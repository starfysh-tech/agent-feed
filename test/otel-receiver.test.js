import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { OtelReceiver } from '../src/otel/receiver.js';
import { Database } from '../src/storage/database.js';
import { Pipeline } from '../src/pipeline.js';
import { OtelSink } from '../src/otel/sink.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

async function buildReceiver({ maxBody } = {}) {
  const db = new Database(':memory:');
  await db.init();
  const sink = new OtelSink({ db });
  const receiver = new OtelReceiver({
    sink,
    port: 0, // ephemeral port
    host: '127.0.0.1',
    maxBodyBytes: maxBody ?? 1_000_000,
    logger: silentLogger,
  });
  await receiver.start();
  const { port } = receiver.server.address();
  return { db, sink, receiver, port };
}

async function postJson(port, route, payload, { encoding = 'identity', contentType = 'application/json' } = {}) {
  let body = Buffer.from(JSON.stringify(payload));
  const headers = { 'content-type': contentType };
  if (encoding === 'gzip') {
    body = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
  }
  return await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers,
    body,
  });
}

describe('OTel receiver — protocol', () => {
  it('returns 200 + partialSuccess on valid logs envelope', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const envelope = {
        resourceLogs: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
          scopeLogs: [{
            logRecords: [{
              timeUnixNano: Date.now() * 1e6 + '',
              body: { stringValue: 'claude_code.user_prompt' },
              attributes: [
                { key: 'event.name',  value: { stringValue: 'user_prompt' } },
                { key: 'session.id',  value: { stringValue: 'sess-1' } },
                { key: 'prompt.id',   value: { stringValue: 'p1' } },
                { key: 'event.sequence', value: { intValue: 1 } },
                { key: 'prompt',      value: { stringValue: 'hello' } },
              ],
            }],
          }],
        }],
      };
      const res = await postJson(port, '/v1/logs', envelope);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.deepEqual(json, { partialSuccess: {} });
      // Confirm event landed
      const events = await db.getEventsForSession('sess-1');
      assert.equal(events.length, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 200 + discards traces (Gemini emits by default)', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const res = await postJson(port, '/v1/traces', { resourceSpans: [] });
      assert.equal(res.status, 200);
      assert.equal(receiver.getMetrics().otel_traces_discarded_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('accepts gzip-encoded body', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const envelope = {
        resourceLogs: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
          scopeLogs: [{ logRecords: [{
            body: { stringValue: 'claude_code.user_prompt' },
            attributes: [
              { key: 'event.name', value: { stringValue: 'user_prompt' } },
              { key: 'session.id', value: { stringValue: 'sess-gz' } },
            ],
          }] }],
        }],
      };
      const res = await postJson(port, '/v1/logs', envelope, { encoding: 'gzip' });
      assert.equal(res.status, 200);
      const events = await db.getEventsForSession('sess-gz');
      assert.equal(events.length, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 200 (NOT 5xx) on malformed JSON', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      // Critical: must NOT be 5xx (would trigger exporter retry storm)
      assert.equal(res.status, 200);
      assert.equal(receiver.getMetrics().otel_parse_failures_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 413 on oversized body (exporter will not retry)', async () => {
    const { receiver, port, db } = await buildReceiver({ maxBody: 1024 });
    try {
      const huge = { padding: 'x'.repeat(2048) };
      const res = await postJson(port, '/v1/logs', huge);
      assert.equal(res.status, 413);
      assert.equal(receiver.getMetrics().otel_oversize_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 400 on unsupported encoding', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
        body: 'whatever',
      });
      assert.equal(res.status, 400);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 404 on unknown path', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const res = await postJson(port, '/v1/foobar', {});
      assert.equal(res.status, 404);
      assert.equal(receiver.getMetrics().otel_unknown_path_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 415 on protobuf content-type (so exporter can downgrade)', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-protobuf' },
        body: Buffer.from([0x08, 0x01]),
      });
      assert.equal(res.status, 415);
      assert.equal(receiver.getMetrics().otel_parse_failures_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('returns 405 on non-POST', async () => {
    const { receiver, port, db } = await buildReceiver();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/logs`);
      assert.equal(res.status, 405);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });

  it('200 (NOT 5xx) when sink throws', async () => {
    const db = new Database(':memory:');
    await db.init();
    const failingSink = { ingestLogs: async () => { throw new Error('boom'); } };
    const receiver = new OtelReceiver({
      sink: failingSink, port: 0, host: '127.0.0.1', logger: silentLogger,
    });
    await receiver.start();
    try {
      const { port } = receiver.server.address();
      const res = await postJson(port, '/v1/logs', { resourceLogs: [] });
      assert.equal(res.status, 200);
      assert.equal(receiver.getMetrics().otel_parse_failures_total, 1);
    } finally {
      await receiver.stop();
      await db.close();
    }
  });
});
