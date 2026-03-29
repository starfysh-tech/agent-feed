import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/storage/database.js';

describe('Database', () => {
  let tmpDir;
  let db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-db-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    await db.init();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('insertRecord', () => {
    it('inserts a record and returns an id', async () => {
      const id = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        agent_version: null,
        session_id: 'sess-001',
        turn_index: 1,
        repo: 'my-repo',
        working_directory: '/home/user/project',
        git_branch: 'main',
        git_commit: 'abc123',
        request_summary: 'write a function',
        response_summary: 'wrote a function',
        raw_request: '{"prompt":"write a function"}',
        raw_response: '{"content":"here is a function"}',
        token_count: 120,
        model: 'claude-sonnet-4-6',
      });
      assert.ok(id);
      assert.equal(typeof id, 'string');
    });

    it('inserts a record without optional fields', async () => {
      const id = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: 'sess-002',
        turn_index: 1,
        working_directory: '/home/user/project',
        response_summary: 'did something',
        raw_response: '{"content":"something"}',
        model: 'claude-sonnet-4-6',
      });
      assert.ok(id);
    });
  });

  describe('insertFlag', () => {
    it('inserts a flag linked to a record', async () => {
      const recordId = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: 'sess-003',
        turn_index: 1,
        working_directory: '/tmp',
        response_summary: 'made a decision',
        raw_response: '{"content":"I decided to use JWT"}',
        model: 'claude-sonnet-4-6',
      });

      const flagId = await db.insertFlag({
        record_id: recordId,
        type: 'decision',
        content: 'Chose JWT over session cookies',
        confidence: 0.92,
      });
      assert.ok(flagId);
    });

    it('rejects unknown flag types', async () => {
      await assert.rejects(async () => {
        await db.insertFlag({
          record_id: 'fake-id',
          type: 'unknown_type',
          content: 'something',
          confidence: 0.9,
        });
      });
    });
  });

  describe('getSession', () => {
    it('returns all records for a session in turn order', async () => {
      const sessionId = 'sess-order-test';
      await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: sessionId,
        turn_index: 2,
        working_directory: '/tmp',
        response_summary: 'second turn',
        raw_response: '{}',
        model: 'claude-sonnet-4-6',
      });
      await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: sessionId,
        turn_index: 1,
        working_directory: '/tmp',
        response_summary: 'first turn',
        raw_response: '{}',
        model: 'claude-sonnet-4-6',
      });

      const records = await db.getSession(sessionId);
      assert.equal(records.length, 2);
      assert.equal(records[0].turn_index, 1);
      assert.equal(records[1].turn_index, 2);
    });
  });

  describe('listSessions', () => {
    it('returns unique sessions sorted by most recent first', async () => {
      const sessions = await db.listSessions();
      assert.ok(Array.isArray(sessions));
      assert.ok(sessions.length > 0);
      // each entry has session_id and latest_timestamp
      assert.ok(sessions[0].session_id);
      assert.ok(sessions[0].latest_timestamp);
    });
  });

  describe('updateFlagReview', () => {
    it('updates review status and note on a flag', async () => {
      const recordId = await db.insertRecord({
        timestamp: new Date().toISOString(),
        agent: 'claude-code',
        session_id: 'sess-review',
        turn_index: 1,
        working_directory: '/tmp',
        response_summary: 'a response',
        raw_response: '{}',
        model: 'claude-sonnet-4-6',
      });
      const flagId = await db.insertFlag({
        record_id: recordId,
        type: 'assumption',
        content: 'Assumed postgres is available',
        confidence: 0.85,
      });

      await db.updateFlagReview(flagId, {
        review_status: 'accepted',
        reviewer_note: 'correct assumption',
        outcome: 'no change needed',
      });

      const flags = await db.getFlagsForRecord(recordId);
      const flag = flags.find(f => f.id === flagId);
      assert.equal(flag.review_status, 'accepted');
      assert.equal(flag.reviewer_note, 'correct assumption');
      assert.equal(flag.outcome, 'no change needed');
    });
  });
});
