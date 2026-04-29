import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/storage/database.js';
import { createUIServer } from '../src/ui/server.js';

async function buildServer() {
  const db = new Database(':memory:');
  await db.init();
  const server = createUIServer({ db });
  await server.listen(0);
  return { db, server, port: server.port };
}

async function seedEvents(db, sessionId) {
  const seed = [
    { id: 'e1', sequence: 1, kind: 'user_prompt' },
    { id: 'e2', sequence: 2, kind: 'tool_decision', attrs: { tool_name: 'Bash', decision: 'accept' } },
    { id: 'e3', sequence: 3, kind: 'tool_result',   attrs: { tool_name: 'Bash', success: 'true' } },
    { id: 'e4', sequence: 4, kind: 'hook',          attrs: { hook_event: 'PreToolUse', num_blocking: '0' } },
    { id: 'e5', sequence: 5, kind: 'mcp',           attrs: { status: 'connected', transport_type: 'stdio' } },
  ];
  for (const s of seed) {
    await db.insertEvent({
      id: s.id, timestamp: 't', agent: 'claude', session_id: sessionId,
      prompt_id: 'P1', event_kind: s.kind, event_name: `claude_code.${s.kind}`,
      sequence: s.sequence, attributes: s.attrs ?? {},
    });
  }
}

describe('UI routes — OTel events', () => {
  it('GET /api/sessions/:id/events returns parsed attributes', async () => {
    const { db, server, port } = await buildServer();
    try {
      await seedEvents(db, 'sess-events-1');
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-events-1/events`);
      assert.equal(res.status, 200);
      const events = await res.json();
      assert.equal(events.length, 5);
      const toolDec = events.find(e => e.event_kind === 'tool_decision');
      assert.deepEqual(toolDec.attributes, { tool_name: 'Bash', decision: 'accept' });
    } finally { await server.close(); await db.close(); }
  });

  it('GET /api/sessions/:id/events?kind=tool_decision filters', async () => {
    const { db, server, port } = await buildServer();
    try {
      await seedEvents(db, 'sess-events-2');
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-events-2/events?kind=tool_decision`);
      const events = await res.json();
      assert.equal(events.length, 1);
      assert.equal(events[0].event_kind, 'tool_decision');
    } finally { await server.close(); await db.close(); }
  });

  it('GET /api/sessions/:id/tool-decisions returns decisions + results', async () => {
    const { db, server, port } = await buildServer();
    try {
      await seedEvents(db, 'sess-td');
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-td/tool-decisions`);
      const body = await res.json();
      assert.equal(body.decisions.length, 1);
      assert.equal(body.results.length, 1);
    } finally { await server.close(); await db.close(); }
  });

  it('GET /api/sessions/:id/hooks returns hook events', async () => {
    const { db, server, port } = await buildServer();
    try {
      await seedEvents(db, 'sess-hooks');
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-hooks/hooks`);
      const body = await res.json();
      assert.equal(body.length, 1);
      assert.equal(body[0].attributes.hook_event, 'PreToolUse');
    } finally { await server.close(); await db.close(); }
  });

  it('GET /api/sessions/:id/mcp returns mcp lifecycle', async () => {
    const { db, server, port } = await buildServer();
    try {
      await seedEvents(db, 'sess-mcp');
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-mcp/mcp`);
      const body = await res.json();
      assert.equal(body.length, 1);
      assert.equal(body[0].attributes.status, 'connected');
    } finally { await server.close(); await db.close(); }
  });
});

describe('UI routes — coalesced session detail', () => {
  function baseRecord(overrides = {}) {
    return {
      timestamp: new Date().toISOString(),
      agent: 'claude', session_id: 'sess-co', turn_index: 1,
      working_directory: '/tmp', response_summary: 's', raw_response: 'x',
      model: 'claude-opus-4-7', ...overrides,
    };
  }

  it('default GET coalesces by request_id (one row per turn)', async () => {
    const { db, server, port } = await buildServer();
    try {
      await db.insertRecord(baseRecord({ source: 'proxy', request_id: 'r1', raw_response: 'PROXY' }));
      await db.insertRecord(baseRecord({ source: 'otel',  request_id: 'r1', raw_response: 'OTEL', token_count: 99 }));
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-co`);
      const rows = await res.json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source, 'proxy+otel');
      assert.equal(rows[0].raw_response, 'PROXY');
      assert.equal(rows[0].token_count, 99);
    } finally { await server.close(); await db.close(); }
  });

  it('?raw=1 returns un-coalesced rows', async () => {
    const { db, server, port } = await buildServer();
    try {
      await db.insertRecord(baseRecord({ source: 'proxy', request_id: 'r1' }));
      await db.insertRecord(baseRecord({ source: 'otel',  request_id: 'r1' }));
      const res = await fetch(`http://localhost:${port}/api/sessions/sess-co?raw=1`);
      const rows = await res.json();
      assert.equal(rows.length, 2);
    } finally { await server.close(); await db.close(); }
  });
});
