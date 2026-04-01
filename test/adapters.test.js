import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, AGENTS } from '../src/adapters/index.js';

describe('getAdapter', () => {
  it('detects claude from host', () => {
    const adapter = getAdapter('api.anthropic.com');
    assert.equal(adapter.name, AGENTS.CLAUDE);
  });

  it('detects codex/openai from host', () => {
    const adapter = getAdapter('api.openai.com');
    assert.equal(adapter.name, AGENTS.CODEX);
  });

  it('detects gemini from host', () => {
    const adapter = getAdapter('generativelanguage.googleapis.com');
    assert.equal(adapter.name, AGENTS.GEMINI);
  });

  it('returns unknown adapter for unrecognized host', () => {
    const adapter = getAdapter('unknown.example.com');
    assert.equal(adapter.name, AGENTS.UNKNOWN);
  });
});

describe('Claude adapter', () => {
  let adapter;

  before(() => {
    adapter = getAdapter('api.anthropic.com');
  });

  it('extracts session id from response body', () => {
    const body = JSON.stringify({
      id: 'msg_abc123',
      type: 'message',
      content: [{ type: 'text', text: 'hello' }],
    });
    assert.equal(adapter.extractSessionId(body, {}), 'msg_abc123');
  });

  it('extracts content from response body', () => {
    const body = JSON.stringify({
      id: 'msg_abc123',
      content: [{ type: 'text', text: 'here is my answer' }],
    });
    assert.equal(adapter.extractContent(body), 'here is my answer');
  });

  it('returns null session id when id missing', () => {
    const body = JSON.stringify({ content: [] });
    assert.equal(adapter.extractSessionId(body, {}), null);
  });

  it('extracts session_id from request metadata.user_id', () => {
    const rawRequest = JSON.stringify({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      metadata: {
        user_id: JSON.stringify({
          device_id: 'dev_123',
          account_uuid: 'acct_456',
          session_id: 'df565c04-0888-4ccd-8567-be9826a9b4ed',
        }),
      },
    });
    const body = JSON.stringify({ id: 'msg_abc123', content: [] });
    assert.equal(
      adapter.extractSessionId(body, { rawRequest }),
      'df565c04-0888-4ccd-8567-be9826a9b4ed'
    );
  });

  it('falls back to response id when request metadata missing', () => {
    const rawRequest = JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] });
    const body = JSON.stringify({ id: 'msg_fallback_001', content: [] });
    assert.equal(adapter.extractSessionId(body, { rawRequest }), 'msg_fallback_001');
  });

  it('falls back to response id when rawRequest is null', () => {
    const body = JSON.stringify({ id: 'msg_null_req', content: [] });
    assert.equal(adapter.extractSessionId(body, {}), 'msg_null_req');
    assert.equal(adapter.extractSessionId(body), 'msg_null_req');
  });
});

describe('Claude adapter (SSE streaming)', () => {
  let adapter;

  before(() => {
    adapter = getAdapter('api.anthropic.com');
  });

  const sseBody = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_sse_001","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","usage":{"input_tokens":50,"output_tokens":0}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');

  it('extracts session id from SSE stream', () => {
    assert.equal(adapter.extractSessionId(sseBody, {}), 'msg_sse_001');
  });

  it('extracts content from SSE content_block_delta events', () => {
    assert.equal(adapter.extractContent(sseBody), 'Hello world');
  });

  it('extracts model from SSE message_start event', () => {
    assert.equal(adapter.extractModel(sseBody), 'claude-sonnet-4-6');
  });

  it('extracts token count from SSE message_start + message_delta', () => {
    assert.equal(adapter.extractTokenCount(sseBody), 62); // 50 input + 12 output
  });
});

describe('Codex adapter', () => {
  let adapter;

  before(() => {
    adapter = getAdapter('api.openai.com');
  });

  it('extracts thread_id from JSONL stream', () => {
    const body = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thr_xyz789' }),
      JSON.stringify({ type: 'turn.completed' }),
    ].join('\n');
    assert.equal(adapter.extractSessionId(body, {}), 'thr_xyz789');
  });

  it('extracts content from agent_message item', () => {
    const body = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thr_xyz789' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'I wrote the function' } }),
      JSON.stringify({ type: 'turn.completed' }),
    ].join('\n');
    assert.equal(adapter.extractContent(body), 'I wrote the function');
  });

  it('falls back to request-derived session id when no thread.started', () => {
    const body = JSON.stringify({ type: 'turn.completed' });
    const sessionId = adapter.extractSessionId(body, { requestHash: 'hash_fallback' });
    assert.equal(sessionId, 'hash_fallback');
  });
});

describe('Gemini adapter', () => {
  let adapter;

  before(() => {
    adapter = getAdapter('generativelanguage.googleapis.com');
  });

  it('uses proxy-provided session id from context', () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'response text' }] } }],
    });
    const sessionId = adapter.extractSessionId(body, { proxySessionId: 'proxy_sess_001' });
    assert.equal(sessionId, 'proxy_sess_001');
  });

  it('extracts content from candidates', () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'the answer is 42' }] } }],
    });
    assert.equal(adapter.extractContent(body), 'the answer is 42');
  });
});
