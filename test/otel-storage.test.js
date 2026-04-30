import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Database } from '../src/storage/database.js';

describe('Database OTel additions', () => {
  let tmpDir;
  let db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-otel-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    await db.init();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  function baseRecord(overrides = {}) {
    return {
      timestamp: new Date().toISOString(),
      agent: 'claude',
      session_id: 'sess-otel-1',
      turn_index: 1,
      working_directory: '/tmp',
      response_summary: 's',
      raw_response: '{}',
      model: 'claude-opus-4-7',
      ...overrides,
    };
  }

  describe('insertRecord with source / request_id', () => {
    it('defaults source to proxy when omitted', async () => {
      const id = await db.insertRecord(baseRecord({ session_id: 's-default' }));
      const row = db.db.prepare('SELECT source, request_id FROM records WHERE id = ?').get(id);
      assert.equal(row.source, 'proxy');
      assert.equal(row.request_id, null);
    });

    it('persists otel source and request_id', async () => {
      const id = await db.insertRecord(baseRecord({
        session_id: 's-otel',
        source: 'otel',
        request_id: 'req_abc',
      }));
      const row = db.db.prepare('SELECT source, request_id FROM records WHERE id = ?').get(id);
      assert.equal(row.source, 'otel');
      assert.equal(row.request_id, 'req_abc');
    });

    it('rejects invalid source', async () => {
      await assert.rejects(
        () => db.insertRecord(baseRecord({ source: 'bogus' })),
        /Invalid source/,
      );
    });
  });

  describe('insertEvent', () => {
    it('inserts a deterministic event row', async () => {
      const id = await db.insertEvent({
        id: 'evt-1',
        timestamp: '2026-04-29T00:00:00Z',
        agent: 'claude',
        session_id: 'sess-events',
        prompt_id: 'p1',
        request_id: 'req_1',
        event_kind: 'tool_decision',
        event_name: 'claude_code.tool_decision',
        sequence: 5,
        attributes: { tool_name: 'Bash', decision: 'accept' },
      });
      assert.equal(id, 'evt-1');
      const row = db.db.prepare('SELECT * FROM events WHERE id = ?').get('evt-1');
      assert.equal(row.event_kind, 'tool_decision');
      assert.equal(row.sequence, 5);
      assert.deepEqual(JSON.parse(row.attributes), { tool_name: 'Bash', decision: 'accept' });
    });

    it('is idempotent on duplicate id (INSERT OR IGNORE)', async () => {
      await db.insertEvent({
        id: 'evt-dup', timestamp: 'x', agent: 'claude',
        session_id: 's', event_kind: 'hook', event_name: 'claude_code.hook_execution_start',
        attributes: {},
      });
      // Insert again with different attributes — first wins
      await db.insertEvent({
        id: 'evt-dup', timestamp: 'y', agent: 'claude',
        session_id: 's', event_kind: 'hook', event_name: 'claude_code.hook_execution_start',
        attributes: { changed: true },
      });
      const rows = db.db.prepare('SELECT * FROM events WHERE id = ?').all('evt-dup');
      assert.equal(rows.length, 1);
      assert.deepEqual(JSON.parse(rows[0].attributes), {});
    });

    it('throws when id is missing', async () => {
      await assert.rejects(
        () => db.insertEvent({ timestamp: 'x', agent: 'claude', session_id: 's', event_kind: 'k', event_name: 'n', attributes: {} }),
        /requires deterministic id/,
      );
    });
  });

  describe('getEventsForSession', () => {
    before(async () => {
      const seed = [
        { id: 'e1', sequence: 1, event_kind: 'user_prompt', prompt_id: 'P1' },
        { id: 'e2', sequence: 2, event_kind: 'tool_decision', prompt_id: 'P1' },
        { id: 'e3', sequence: 3, event_kind: 'tool_decision', prompt_id: 'P1' },
        { id: 'e4', sequence: 4, event_kind: 'hook', prompt_id: 'P1' },
      ];
      for (const s of seed) {
        await db.insertEvent({
          id: s.id, timestamp: 't', agent: 'claude', session_id: 'sess-q',
          prompt_id: s.prompt_id, event_kind: s.event_kind,
          event_name: `claude_code.${s.event_kind}`, sequence: s.sequence,
          attributes: {},
        });
      }
    });

    it('returns all events ordered by sequence', async () => {
      const rows = await db.getEventsForSession('sess-q');
      assert.equal(rows.length, 4);
      assert.deepEqual(rows.map(r => r.sequence), [1, 2, 3, 4]);
    });

    it('filters by kind', async () => {
      const rows = await db.getEventsForSession('sess-q', { kind: 'tool_decision' });
      assert.equal(rows.length, 2);
      for (const r of rows) assert.equal(r.event_kind, 'tool_decision');
    });

    it('filters by promptId', async () => {
      const rows = await db.getEventsForSession('sess-q', { promptId: 'P1' });
      assert.equal(rows.length, 4);
    });
  });

  describe('getRecordsCoalesced', () => {
    it('merges proxy and otel rows that share request_id', async () => {
      await db.insertRecord(baseRecord({
        session_id: 'co-1', turn_index: 1,
        source: 'proxy', request_id: 'r1',
        raw_response: 'PROXY-BODY', token_count: null,
      }));
      await db.insertRecord(baseRecord({
        session_id: 'co-1', turn_index: 1,
        source: 'otel', request_id: 'r1',
        raw_response: 'OTEL-BODY', token_count: 42,
      }));
      const rows = await db.getRecordsCoalesced('co-1');
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.source, 'proxy+otel');
      assert.equal(row.raw_response, 'PROXY-BODY'); // proxy preferred (untruncated)
      assert.equal(row.token_count, 42);            // otel filled in
    });

    it('keeps standalone rows (no request_id) intact', async () => {
      await db.insertRecord(baseRecord({
        session_id: 'co-2', turn_index: 1,
        raw_response: 'LEGACY',
      }));
      const rows = await db.getRecordsCoalesced('co-2');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source, 'proxy');
      assert.equal(rows[0].raw_response, 'LEGACY');
    });

    it('keeps single-source rows when only one source captured', async () => {
      await db.insertRecord(baseRecord({
        session_id: 'co-3', source: 'otel', request_id: 'r3',
      }));
      const rows = await db.getRecordsCoalesced('co-3');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source, 'otel');
    });

    it('orders by turn_index then timestamp', async () => {
      await db.insertRecord(baseRecord({
        session_id: 'co-4', turn_index: 2, timestamp: '2026-04-29T00:00:02Z',
        source: 'proxy', request_id: 'r4b',
      }));
      await db.insertRecord(baseRecord({
        session_id: 'co-4', turn_index: 1, timestamp: '2026-04-29T00:00:01Z',
        source: 'proxy', request_id: 'r4a',
      }));
      const rows = await db.getRecordsCoalesced('co-4');
      assert.deepEqual(rows.map(r => r.turn_index), [1, 2]);
    });
  });

  describe('nextTurnIndex', () => {
    it('returns 1 for empty session', async () => {
      assert.equal(await db.nextTurnIndex('empty-session'), 1);
    });

    it('increments by source so proxy and otel paths do not interfere', async () => {
      await db.insertRecord(baseRecord({ session_id: 'turn-1', source: 'proxy', turn_index: 1 }));
      await db.insertRecord(baseRecord({ session_id: 'turn-1', source: 'proxy', turn_index: 2 }));
      assert.equal(await db.nextTurnIndex('turn-1', 'proxy'), 3);
      assert.equal(await db.nextTurnIndex('turn-1', 'otel'), 1);
    });
  });

  describe('migration safety', () => {
    it('idempotently re-runs init against existing DB', async () => {
      // Run init twice; second call must not throw on duplicate columns/indexes
      await db.init();
      await db.init();
      const cols = db.db.pragma('table_info(records)').map(c => c.name);
      assert.ok(cols.includes('source'));
      assert.ok(cols.includes('request_id'));
    });

    it('migrates legacy records before creating request_id index', async () => {
      const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-legacy-db-'));
      const legacyPath = path.join(legacyDir, 'legacy.db');
      const legacyDb = new Database(legacyPath);

      try {
        const oldDb = new BetterSqlite3(legacyPath);
        oldDb.exec(`
          CREATE TABLE records (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            agent TEXT NOT NULL,
            agent_version TEXT,
            session_id TEXT NOT NULL,
            turn_index INTEGER NOT NULL DEFAULT 1,
            repo TEXT,
            working_directory TEXT NOT NULL,
            git_branch TEXT,
            git_commit TEXT,
            request_summary TEXT,
            response_summary TEXT NOT NULL,
            raw_request TEXT,
            raw_response TEXT NOT NULL,
            token_count INTEGER,
            model TEXT NOT NULL
          );
          CREATE TABLE flags (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            confidence REAL NOT NULL,
            review_status TEXT NOT NULL DEFAULT 'unreviewed',
            reviewer_note TEXT,
            outcome TEXT
          );
          INSERT INTO records (
            id, timestamp, agent, session_id, turn_index, working_directory,
            response_summary, raw_response, model
          ) VALUES (
            'legacy-record', '2026-04-29T00:00:00Z', 'codex', 'legacy-session',
            1, '/tmp', 'summary', '{}', 'legacy-model'
          );
        `);
        oldDb.close();

        await legacyDb.init();
        const cols = legacyDb.db.pragma('table_info(records)').map(c => c.name);
        assert.ok(cols.includes('response_text'));
        assert.ok(cols.includes('source'));
        assert.ok(cols.includes('request_id'));

        const indexes = legacyDb.db.pragma('index_list(records)').map(i => i.name);
        assert.ok(indexes.includes('idx_records_session_request'));

        const row = legacyDb.db.prepare('SELECT id, source, request_id FROM records WHERE id = ?').get('legacy-record');
        assert.deepEqual(row, {
          id: 'legacy-record',
          source: 'proxy',
          request_id: null,
        });
      } finally {
        await legacyDb.close();
        fs.rmSync(legacyDir, { recursive: true, force: true });
      }
    });
  });
});
