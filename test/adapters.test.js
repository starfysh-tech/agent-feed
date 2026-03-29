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
