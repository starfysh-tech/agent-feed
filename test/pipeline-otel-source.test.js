import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline.js';
import { Database } from '../src/storage/database.js';

function claudeCapture({ id = 'msg_test', text = 'hello', requestId = null } = {}) {
  return {
    timestamp: new Date().toISOString(),
    host: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    requestHeaders: {},
    rawRequest: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    rawResponse: JSON.stringify({
      id, model: 'claude-opus-4-7',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    statusCode: 200,
    requestId,
  };
}

describe('Pipeline source param + classifier gate', () => {
  it('defaults source to proxy and runs classifier', async () => {
    const db = new Database(':memory:');
    await db.init();
    let classifierCalls = 0;
    const classifier = async () => { classifierCalls++; return { response_summary: 's', flags: [] }; };
    const pipeline = new Pipeline({ db, classifierFn: classifier });

    await pipeline.process(claudeCapture());
    const records = await db.getSession('msg_test');
    assert.equal(records.length, 1);
    assert.equal(records[0].source, 'proxy');
    assert.equal(classifierCalls, 1);
    await db.close();
  });

  it('skips classifier when source=otel', async () => {
    const db = new Database(':memory:');
    await db.init();
    let classifierCalls = 0;
    const classifier = async () => { classifierCalls++; return { response_summary: 's', flags: [] }; };
    const pipeline = new Pipeline({ db, classifierFn: classifier });

    await pipeline.process(claudeCapture({ id: 'msg_otel' }), 'otel');
    const records = await db.getSession('msg_otel');
    assert.equal(records.length, 1);
    assert.equal(records[0].source, 'otel');
    assert.equal(classifierCalls, 0, 'classifier must not run for otel rows');
    await db.close();
  });

  it('persists request_id when capture supplies it', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });
    await pipeline.process(claudeCapture({ id: 'msg_rid', requestId: 'req_abc' }));
    const records = await db.getSession('msg_rid');
    assert.equal(records[0].request_id, 'req_abc');
    await db.close();
  });

  it('per-source turn_index is independent (proxy and otel each start at 1)', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });

    await pipeline.process(claudeCapture({ id: 'msg_dual' }), 'proxy');
    await pipeline.process(claudeCapture({ id: 'msg_dual' }), 'proxy');
    await pipeline.process(claudeCapture({ id: 'msg_dual' }), 'otel');

    const records = await db.getSession('msg_dual');
    const proxy = records.filter(r => r.source === 'proxy').sort((a, b) => a.turn_index - b.turn_index);
    const otel  = records.filter(r => r.source === 'otel');
    assert.deepEqual(proxy.map(r => r.turn_index), [1, 2]);
    assert.deepEqual(otel.map(r => r.turn_index),  [1]);
    await db.close();
  });

});
