import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline.js';
import { Database } from '../src/storage/database.js';

describe('Pipeline', () => {
  it('processes a claude capture and writes a record to db', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });

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

    await db.close();
  });

  it('increments turn_index for subsequent turns in same session', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });

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

    await db.close();
  });

  it('skips non-200 responses', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });

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

    await db.close();
  });

  it('skips unknown agents', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db, classifierFn: null });

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

    await db.close();
  });

  it('calls classifierFn with response content when provided', async () => {
    const db = new Database(':memory:');
    await db.init();

    const classified = [];
    const mockClassifier = async (content) => {
      classified.push(content);
      return { response_summary: 'mock summary', flags: [] };
    };

    const pipeline = new Pipeline({ db, classifierFn: mockClassifier });

    await pipeline.process({
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

    await db.close();
  });

  it('stores classifier flags in db', async () => {
    const db = new Database(':memory:');
    await db.init();

    const mockClassifier = async () => ({
      response_summary: 'agent made a decision',
      flags: [
        { type: 'decision', content: 'Use postgres over sqlite', confidence: 0.95 },
        { type: 'assumption', content: 'Docker is available', confidence: 0.80 },
      ],
    });

    const pipeline = new Pipeline({ db, classifierFn: mockClassifier });

    await pipeline.process({
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

    await db.close();
  });

  it('checks support only for assumptions and stores the result', async () => {
    const db = new Database(':memory:');
    await db.init();

    const calls = [];
    const pipeline = new Pipeline({
      db,
      classifierFn: async () => ({
        response_summary: 'agent made a decision and an assumption',
        flags: [
          { type: 'decision', content: 'Use a worker pool', confidence: 0.9 },
          { type: 'assumption', content: 'Workers have isolated tokens', confidence: 0.85 },
        ],
      }),
      assumptionSupportFn: async (claim, capturedContext) => {
        calls.push({ claim, capturedContext });
        return {
          support_status: 'supported',
          evidence: 'The isolation test passed for three workers.',
        };
      },
    });

    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({
        id: 'msg_assumption_support_test',
        model: 'claude-sonnet-4-6',
        content: [{
          type: 'text',
          text: 'The isolation test passed for three workers. We can reuse one token per worker.',
        }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      statusCode: 200,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].claim, 'Workers have isolated tokens');
    assert.ok(calls[0].capturedContext.includes('isolation test passed'));

    const records = await db.getSession('msg_assumption_support_test');
    const flags = await db.getFlagsForRecord(records[0].id);
    const decision = flags.find(flag => flag.type === 'decision');
    const assumption = flags.find(flag => flag.type === 'assumption');
    assert.equal(decision.support_status, null);
    assert.equal(decision.evidence, null);
    assert.equal(assumption.support_status, 'supported');
    assert.equal(assumption.evidence, 'The isolation test passed for three workers.');

    await db.close();
  });

  it('stores unsupported and failed checks, with support calls kept sequential', async () => {
    const db = new Database(':memory:');
    await db.init();

    let activeChecks = 0;
    let maxActiveChecks = 0;
    const pipeline = new Pipeline({
      db,
      classifierFn: async () => ({
        response_summary: 'two assumptions',
        flags: [
          { type: 'assumption', content: 'Docker is available', confidence: 0.9 },
          { type: 'assumption', content: 'The network is available', confidence: 0.8 },
        ],
      }),
      assumptionSupportFn: async (claim) => {
        activeChecks += 1;
        maxActiveChecks = Math.max(maxActiveChecks, activeChecks);
        await new Promise(resolve => setImmediate(resolve));
        activeChecks -= 1;
        if (claim === 'Docker is available') {
          return { support_status: 'unsupported', evidence: null };
        }
        throw new Error('support service unavailable');
      },
    });

    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({
        id: 'msg_assumption_other_states',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Assume Docker and network access are available.' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      statusCode: 200,
    });

    assert.equal(maxActiveChecks, 1);
    const records = await db.getSession('msg_assumption_other_states');
    const flags = await db.getFlagsForRecord(records[0].id);
    const unsupported = flags.find(flag => flag.content === 'Docker is available');
    const unchecked = flags.find(flag => flag.content === 'The network is available');
    assert.equal(unsupported.support_status, 'unsupported');
    assert.equal(unsupported.evidence, null);
    assert.equal(unchecked.support_status, null);
    assert.equal(unchecked.evidence, null);

    await db.close();
  });

  it('stores the capture when classifier flags are malformed or carry stray support fields', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({
      db,
      classifierFn: async () => ({
        response_summary: 'malformed classifier output',
        flags: [
          null,
          {
            type: 'decision',
            content: 'Use a worker pool',
            confidence: 0.9,
            support_status: 'supported',
            evidence: 'Stray model output',
          },
        ],
      }),
      assumptionSupportFn: async () => ({ support_status: 'unsupported', evidence: null }),
    });

    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: '{}',
      rawResponse: JSON.stringify({
        id: 'msg_malformed_flags',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Use a worker pool.' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      statusCode: 200,
    });

    const records = await db.getSession('msg_malformed_flags');
    assert.equal(records.length, 1);
    const flags = await db.getFlagsForRecord(records[0].id);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].type, 'decision');
    assert.equal(flags[0].support_status, null);
    assert.equal(flags[0].evidence, null);

    await db.close();
  });

  it('groups claude turns by request metadata session_id', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db });

    const metadataSessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const makeCapture = (msgId, text) => ({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: JSON.stringify({
        messages: [{ role: 'user', content: text }],
        metadata: {
          user_id: JSON.stringify({ session_id: metadataSessionId }),
        },
      }),
      rawResponse: JSON.stringify({
        id: msgId,
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      statusCode: 200,
    });

    await pipeline.process(makeCapture('msg_turn1', 'first'));
    await pipeline.process(makeCapture('msg_turn2', 'second'));

    const records = await db.getSession(metadataSessionId);
    assert.equal(records.length, 2);
    assert.equal(records[0].turn_index, 1);
    assert.equal(records[1].turn_index, 2);

    await db.close();
  });

  it('trims stored raw_request to last 2 messages when conversation has history', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db });

    const sessionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8096,
        system: 'You are a helpful assistant.',
        tools: [{ name: 'bash', description: 'Run shell commands' }],
        messages: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
          { role: 'user', content: 'second question' },
          { role: 'assistant', content: 'second answer' },
          { role: 'user', content: 'third question' },
        ],
        metadata: {
          user_id: JSON.stringify({ session_id: sessionId }),
        },
      }),
      rawResponse: JSON.stringify({
        id: 'msg_trim_test',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'third answer' }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      statusCode: 200,
    });

    const records = await db.getSession(sessionId);
    assert.equal(records.length, 1);
    const stored = JSON.parse(records[0].raw_request);
    // Only last 2 messages kept
    assert.equal(stored.messages.length, 2);
    assert.equal(stored.messages[0].content, 'second answer');
    assert.equal(stored.messages[1].content, 'third question');
    // Metadata preserved
    assert.ok(stored.metadata);
    // Redundant fields dropped
    assert.equal(stored.model, undefined);
    assert.equal(stored.tools, undefined);
    assert.equal(stored.system, undefined);

    await db.close();
  });

  it('preserves raw_request unchanged when messages array has 2 or fewer entries', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db });

    const sessionId = 'cccccccc-dddd-eeee-ffff-111111111111';
    const rawRequest = JSON.stringify({
      model: 'claude-sonnet-4-6',
      tools: [{ name: 'bash' }],
      messages: [{ role: 'user', content: 'hello' }],
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    });

    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest,
      rawResponse: JSON.stringify({
        id: 'msg_short_test',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
      statusCode: 200,
    });

    const records = await db.getSession(sessionId);
    // When <= 2 messages, raw_request stored unchanged (with tools, system, etc.)
    assert.equal(records[0].raw_request, rawRequest);

    await db.close();
  });

  it('preserves raw_request unchanged when no messages array present', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db });

    // Claude request without a messages array (unusual but possible)
    const sessionId = 'dddddddd-eeee-ffff-0000-222222222222';
    const rawRequest = JSON.stringify({
      prompt: 'raw prompt without messages',
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    });

    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest,
      rawResponse: JSON.stringify({
        id: 'msg_no_messages',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
      statusCode: 200,
    });

    const records = await db.getSession(sessionId);
    assert.equal(records.length, 1);
    assert.equal(records[0].raw_request, rawRequest);

    await db.close();
  });

  it('extracts working directory from request system prompt for repo tagging', async () => {
    const db = new Database(':memory:');
    await db.init();
    const pipeline = new Pipeline({ db });

    const sessionId = 'eeeeeeee-ffff-0000-1111-333333333333';
    await pipeline.process({
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      requestHeaders: {},
      rawRequest: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
        system: [{ type: 'text', text: 'You are Claude Code.\n\nPrimary working directory: /Users/dev/Code/mqol-db\n  - Is a git repository: true' }],
        metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
      }),
      rawResponse: JSON.stringify({
        id: 'msg_cwd_test',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
      statusCode: 200,
    });

    const records = await db.getSession(sessionId);
    assert.equal(records.length, 1);
    assert.equal(records[0].working_directory, '/Users/dev/Code/mqol-db');

    await db.close();
  });
});
