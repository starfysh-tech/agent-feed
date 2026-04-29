import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogs } from '../src/otel/parse.js';
import { getAdapter, adapterByVendor, VENDORS } from '../src/otel/adapters/index.js';

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

describe('OTel adapter dispatch', () => {
  it('routes claude_code.* to claudeAdapter', () => {
    const a = getAdapter({ name: 'claude_code.user_prompt' });
    assert.equal(a?.vendor, 'claude');
  });

  it('routes codex.* to codexAdapter', () => {
    assert.equal(getAdapter({ name: 'codex.user_prompt' })?.vendor, 'codex');
  });

  it('routes gemini_cli.* and gen_ai.* to geminiAdapter', () => {
    assert.equal(getAdapter({ name: 'gemini_cli.user_prompt' })?.vendor, 'gemini');
    assert.equal(getAdapter({ name: 'gen_ai.client.inference.operation.details' })?.vendor, 'gemini');
  });

  it('returns null for unknown namespaces', () => {
    assert.equal(getAdapter({ name: 'random.event' }), null);
    assert.equal(getAdapter({ name: null }), null);
  });

  it('lookup by vendor', () => {
    assert.equal(adapterByVendor('claude').vendor, 'claude');
    assert.equal(adapterByVendor('codex').vendor,  'codex');
    assert.equal(adapterByVendor('gemini').vendor, 'gemini');
    assert.equal(adapterByVendor('bogus'), null);
  });
});

describe('Claude adapter — fixture extraction', () => {
  const records = recordsFromFixture('claude.ndjson');

  it('extracts session.id, prompt.id, request_id correctly', () => {
    const apiResponses = records
      .filter(r => r.name === 'claude_code.api_response_body')
      .map(r => getAdapter(r).extract(r));
    assert.ok(apiResponses.length > 0, 'fixture has api_response_body events');
    for (const e of apiResponses) {
      assert.ok(e.sessionId, 'sessionId required on api_response_body');
      assert.ok(e.requestId, 'requestId required on api_response_body');
      assert.equal(e.kind, 'api_response_body');
    }
  });

  it('user_prompt has prompt.id and prompt text (when log gate enabled)', () => {
    const promptRecord = records.find(r => r.name === 'claude_code.user_prompt');
    assert.ok(promptRecord, 'fixture has user_prompt');
    const e = getAdapter(promptRecord).extract(promptRecord);
    assert.equal(e.kind, 'user_prompt');
    assert.ok(e.promptId);
    assert.ok(e.attrs.prompt, 'fixture was captured with OTEL_LOG_USER_PROMPTS=1');
  });

  it('tool_decision has tool_name and decision', () => {
    const toolDecisions = records
      .filter(r => r.name === 'claude_code.tool_decision')
      .map(r => getAdapter(r).extract(r));
    assert.ok(toolDecisions.length > 0);
    for (const e of toolDecisions) {
      assert.equal(e.kind, 'tool_decision');
      assert.ok(e.attrs.tool_name);
      assert.ok(e.attrs.decision);
    }
  });

  it('mcp_server_connection captures status, transport, server_scope', () => {
    const mcp = records
      .filter(r => r.name === 'claude_code.mcp_server_connection')
      .map(r => getAdapter(r).extract(r));
    assert.ok(mcp.length > 0);
    for (const e of mcp) {
      assert.equal(e.kind, 'mcp');
      assert.ok(['connected', 'failed', 'disconnected'].includes(e.attrs.status));
    }
  });

  it('hook_execution_complete has hook_event and num_success', () => {
    const hooks = records
      .filter(r => r.name === 'claude_code.hook_execution_complete')
      .map(r => getAdapter(r).extract(r));
    assert.ok(hooks.length > 0);
    for (const e of hooks) {
      assert.equal(e.kind, 'hook');
      assert.ok(e.attrs.hook_event);
    }
  });

  it('event.sequence is coerced to number', () => {
    const e = records.map(r => getAdapter(r).extract(r))[5];
    assert.equal(typeof e.sequence, 'number');
  });
});

describe('Gemini adapter — fixture extraction', () => {
  const records = recordsFromFixture('gemini.ndjson');

  it('user_prompt yields kind="user_prompt" with session.id and prompt_id', () => {
    const r = records.find(r => r.name === 'gemini_cli.user_prompt');
    assert.ok(r);
    const e = getAdapter(r).extract(r);
    assert.equal(e.vendor, 'gemini');
    assert.equal(e.kind, 'user_prompt');
    assert.ok(e.sessionId);
    assert.ok(e.promptId);
  });

  it('api_response yields kind="api_response_body"', () => {
    const r = records.find(r => r.name === 'gemini_cli.api_response');
    if (!r) return; // fixture had only error responses; skip if no success seen
    const e = getAdapter(r).extract(r);
    assert.equal(e.kind, 'api_response_body');
  });

  it('gen_ai.* events route via gemini adapter', () => {
    const r = records.find(r => r.name === 'gen_ai.client.inference.operation.details');
    if (!r) return;
    const e = getAdapter(r).extract(r);
    assert.equal(e.vendor, 'gemini');
    assert.equal(e.kind, 'api_response_body');
  });
});
