import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pipeline } from '../src/pipeline.js';
import { Database } from '../src/storage/database.js';

describe('Pipeline', () => {
  let tmpDir;
  let db;
  let pipeline;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-pipeline-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    await db.init();
    pipeline = new Pipeline({ db, classifierFn: null });
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('processes a claude capture and writes a record to db', async () => {
    const capture = {
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: { 'content-type': 'application/json' },
      rawRequest: JSON.stringify({ messages: [{ role: 'user', content: 'write a login function' }] }),
      rawResponse: JSON.stringify({
        id: 'msg_claude_001',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Here is a login function using JWT...' }],
        usage: { input_tokens: 50, output_tokens: 100 },
      }),
      statusCode: 200,
    };

    await pipeline.process(capture);

    const sessions = await db.listSessions();
    const session = sessions.find(s => s.session_id === 'msg_claude_001');
    assert.ok(session, 'session should exist');
    assert.equal(session.agent, 'claude-code');

    const records = await db.getSession('msg_claude_001');
    assert.equal(records.length, 1);
    assert.equal(records[0].model, 'claude-sonnet-4-6');
    assert.equal(records[0].token_count, 150);
    assert.equal(records[0].raw_response, capture.rawResponse);
  });

  it('increments turn_index for subsequent turns in same session', async () => {
    const sessionId = 'msg_multi_turn';
    const makeCapture = (text) => ({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({
        id: sessionId,
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      statusCode: 200,
    });

    await pipeline.process(makeCapture('first turn response'));
    await pipeline.process(makeCapture('second turn response'));
    await pipeline.process(makeCapture('third turn response'));

    const records = await db.getSession(sessionId);
    assert.equal(records.length, 3);
    assert.equal(records[0].turn_index, 1);
    assert.equal(records[1].turn_index, 2);
    assert.equal(records[2].turn_index, 3);
  });

  it('skips non-200 responses', async () => {
    const before = await db.listSessions();
    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({ error: 'rate limited' }),
      statusCode: 429,
    });
    const after = await db.listSessions();
    assert.equal(before.length, after.length);
  });

  it('skips unknown agents', async () => {
    const before = await db.listSessions();
    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'unknown.example.com',
      path: '/v1/chat',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: '{"result":"something"}',
      statusCode: 200,
    });
    const after = await db.listSessions();
    assert.equal(before.length, after.length);
  });

  it('calls classifierFn with response content when provided', async () => {
    const classified = [];
    const mockClassifier = async (content) => {
      classified.push(content);
      return { response_summary: 'mock summary', flags: [] };
    };

    const pipelineWithClassifier = new Pipeline({ db, classifierFn: mockClassifier });

    await pipelineWithClassifier.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({
        id: 'msg_classifier_test',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'I decided to use postgres' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      statusCode: 200,
    });

    assert.equal(classified.length, 1);
    assert.ok(classified[0].includes('postgres'));
  });

  it('stores classifier flags in db', async () => {
    const mockClassifier = async () => ({
      response_summary: 'agent made a decision',
      flags: [
        { type: 'decision', content: 'Use postgres over sqlite', confidence: 0.95 },
        { type: 'assumption', content: 'Docker is available', confidence: 0.80 },
      ],
    });

    const pipelineWithClassifier = new Pipeline({ db, classifierFn: mockClassifier });

    await pipelineWithClassifier.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({
        id: 'msg_flags_test',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'I will use postgres' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      statusCode: 200,
    });

    const records = await db.getSession('msg_flags_test');
    assert.equal(records.length, 1);
    const flags = await db.getFlagsForRecord(records[0].id);
    assert.equal(flags.length, 2);
    assert.equal(flags[0].type, 'decision');
    assert.equal(flags[1].type, 'assumption');
    assert.equal(flags[0].review_status, 'unreviewed');
  });
});
