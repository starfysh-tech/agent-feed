// Tests for atomic migrations (transaction wrap added to Database.init).
// Specifically verifies: (a) fresh DB initializes correctly, (b) re-running
// init() is idempotent, (c) a thrown error inside the transaction rolls back
// the entire migration, leaving the DB exactly as it was on entry.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Database } from '../src/storage/database.js';

describe('Database migration safety', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-migr-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fresh DB has all expected tables and columns after init', async () => {
    const db = new Database(path.join(tmpDir, 'fresh.db'));
    await db.init();
    try {
      const tables = db.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
      assert.ok(tables.includes('records'));
      assert.ok(tables.includes('flags'));
      assert.ok(tables.includes('events'));

      const recordCols = db.db.pragma('table_info(records)').map(c => c.name);
      for (const expected of ['source', 'request_id', 'response_text', 'turn_index']) {
        assert.ok(recordCols.includes(expected), `records missing ${expected}`);
      }

      const indexes = db.db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='records'`).all().map(r => r.name);
      assert.ok(indexes.includes('idx_records_session_request'));
    } finally {
      await db.close();
    }
  });

  it('re-running init() on an already-migrated DB is idempotent', async () => {
    const dbPath = path.join(tmpDir, 'idempotent.db');
    const db1 = new Database(dbPath);
    await db1.init();
    const beforeCols = db1.db.pragma('table_info(records)').map(c => c.name).sort();
    await db1.close();

    const db2 = new Database(dbPath);
    await db2.init();   // must not throw on duplicate columns/indexes
    const afterCols = db2.db.pragma('table_info(records)').map(c => c.name).sort();
    await db2.close();

    assert.deepEqual(afterCols, beforeCols);
  });

  it('SQLite + better-sqlite3 transaction wrap rolls back DDL on throw', async () => {
    // This is the core safety property the new init() relies on: when a
    // statement inside a db.transaction() throws, all prior DDL in that
    // transaction is rolled back. If this test ever fails, the migration
    // wrap in src/storage/database.js is no longer atomic and the historical
    // "no such column" incident class can recur.
    const dbPath = path.join(tmpDir, 'tx-rollback.db');
    const conn = new BetterSqlite3(dbPath);
    conn.pragma('journal_mode = WAL');
    conn.exec(`
      CREATE TABLE records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      );
    `);
    const beforeCols = conn.pragma('table_info(records)').map(c => c.name).sort();
    assert.deepEqual(beforeCols, ['id', 'session_id']);

    const tx = conn.transaction(() => {
      conn.exec('ALTER TABLE records ADD COLUMN response_text TEXT');
      conn.exec("ALTER TABLE records ADD COLUMN source TEXT NOT NULL DEFAULT 'proxy'");
      throw new Error('simulated mid-migration crash');
    });

    assert.throws(() => tx(), /simulated mid-migration crash/);

    const afterCols = conn.pragma('table_info(records)').map(c => c.name).sort();
    assert.deepEqual(afterCols, beforeCols, 'schema must match pre-transaction state after rollback');
    conn.close();
  });

  it('Database.init() against a legacy DB shape produces the full schema', async () => {
    // Sanity check that the actual init() code path also leaves the DB in
    // the expected final shape when starting from a pre-migration table.
    const dbPath = path.join(tmpDir, 'legacy-init.db');
    const oldDb = new BetterSqlite3(dbPath);
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
        review_status TEXT NOT NULL DEFAULT 'unreviewed'
      );
    `);
    oldDb.close();

    const db = new Database(dbPath);
    await db.init();
    try {
      const cols = db.db.pragma('table_info(records)').map(c => c.name);
      for (const expected of ['source', 'request_id', 'response_text']) {
        assert.ok(cols.includes(expected), `legacy DB should be migrated to include ${expected}`);
      }
      const indexes = db.db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='records'`).all().map(r => r.name);
      assert.ok(indexes.includes('idx_records_session_request'), 'index should be created post-migration');

      // Verify the flags->records FK still works on the migrated DB by
      // round-tripping through the public insertRecord/insertFlag API.
      const recordId = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude',
        session_id: 'fk-check',
        working_directory: '/tmp',
        response_summary: 's',
        raw_response: '{}',
        model: 'claude-opus-4-7',
      });
      const flagId = await db.insertFlag({
        record_id: recordId, type: 'decision', content: 'check FK', confidence: 0.9,
      });
      const flags = await db.getFlagsForRecord(recordId);
      assert.equal(flags.length, 1);
      assert.equal(flags[0].id, flagId);
    } finally {
      await db.close();
    }
  });
});
