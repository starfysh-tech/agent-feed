import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const VALID_FLAG_TYPES = [
  'decision',
  'assumption',
  'architecture',
  'pattern',
  'dependency',
  'tradeoff',
  'constraint',
  'workaround',
  'risk',
];

const VALID_REVIEW_STATUSES = [
  'unreviewed',
  'accepted',
  'needs_change',
  'false_positive',
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS records (
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

  CREATE TABLE IF NOT EXISTS flags (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'unreviewed',
    reviewer_note TEXT,
    outcome TEXT,
    FOREIGN KEY (record_id) REFERENCES records(id)
  );

  CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id);
  CREATE INDEX IF NOT EXISTS idx_flags_record ON flags(record_id);
`;

export class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async insertRecord(record) {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO records (
        id, timestamp, agent, agent_version, session_id, turn_index,
        repo, working_directory, git_branch, git_commit,
        request_summary, response_summary, raw_request, raw_response,
        token_count, model
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )`
    ).run(
      id,
      record.timestamp,
      record.agent,
      record.agent_version ?? null,
      record.session_id,
      record.turn_index ?? 1,
      record.repo ?? null,
      record.working_directory,
      record.git_branch ?? null,
      record.git_commit ?? null,
      record.request_summary ?? null,
      record.response_summary,
      record.raw_request ?? null,
      record.raw_response,
      record.token_count ?? null,
      record.model,
    );
    return id;
  }

  async insertFlag(flag) {
    if (!VALID_FLAG_TYPES.includes(flag.type)) {
      throw new Error(`Invalid flag type: ${flag.type}. Must be one of: ${VALID_FLAG_TYPES.join(', ')}`);
    }
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO flags (id, record_id, type, content, confidence, review_status)
       VALUES (?, ?, ?, ?, ?, 'unreviewed')`
    ).run(id, flag.record_id, flag.type, flag.content, flag.confidence);
    return id;
  }

  async getSession(sessionId) {
    return this.db.prepare(
      `SELECT * FROM records WHERE session_id = ? ORDER BY turn_index ASC`
    ).all(sessionId);
  }

  async listSessions() {
    return this.db.prepare(
      `SELECT
        session_id,
        agent,
        model,
        repo,
        git_branch,
        MAX(timestamp) as latest_timestamp,
        COUNT(*) as turn_count
       FROM records
       GROUP BY session_id
       ORDER BY latest_timestamp DESC`
    ).all();
  }

  async getFlagsForRecord(recordId) {
    return this.db.prepare(
      `SELECT * FROM flags WHERE record_id = ?`
    ).all(recordId);
  }

  async updateFlagReview(flagId, { review_status, reviewer_note, outcome }) {
    if (review_status && !VALID_REVIEW_STATUSES.includes(review_status)) {
      throw new Error(`Invalid review_status: ${review_status}`);
    }
    this.db.prepare(
      `UPDATE flags SET
        review_status = COALESCE(?, review_status),
        reviewer_note = COALESCE(?, reviewer_note),
        outcome = COALESCE(?, outcome)
       WHERE id = ?`
    ).run(review_status ?? null, reviewer_note ?? null, outcome ?? null, flagId);
  }

  async bulkUpdateFlagReview(flagIds, reviewStatus) {
    if (!VALID_REVIEW_STATUSES.includes(reviewStatus)) {
      throw new Error(`Invalid review_status: ${reviewStatus}`);
    }
    if (!flagIds.length) return 0;
    const placeholders = flagIds.map(() => '?').join(',');
    const result = this.db.prepare(
      `UPDATE flags SET review_status = ? WHERE id IN (${placeholders})`
    ).run(reviewStatus, ...flagIds);
    return result.changes;
  }

  async getTrends({ agent, repo, branch, dateFrom, dateTo } = {}) {
    // Build WHERE clause for records
    const conditions = [];
    const params = [];
    if (agent)    { conditions.push('r.agent = ?');       params.push(agent); }
    if (repo)     { conditions.push('r.repo = ?');        params.push(repo); }
    if (branch)   { conditions.push('r.git_branch = ?');  params.push(branch); }
    if (dateFrom) { conditions.push('r.timestamp >= ?');  params.push(dateFrom); }
    if (dateTo)   { conditions.push('r.timestamp <= ?');  params.push(dateTo.includes('T') ? dateTo : dateTo + 'T23:59:59.999Z'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Total flags
    const totalRow = this.db.prepare(
      `SELECT COUNT(f.id) as total FROM flags f JOIN records r ON f.record_id = r.id ${where}`
    ).get(...params);
    const total_flags = totalRow?.total ?? 0;

    // By type with false_positive_rate
    const by_type = this.db.prepare(
      `SELECT
        f.type,
        COUNT(f.id) as count,
        CAST(SUM(CASE WHEN f.review_status = 'false_positive' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(f.id), 0) as false_positive_rate
       FROM flags f JOIN records r ON f.record_id = r.id ${where}
       GROUP BY f.type
       ORDER BY count DESC`
    ).all(...params);

    // By session
    const by_session = this.db.prepare(
      `SELECT
        r.session_id,
        r.agent,
        r.repo,
        r.git_branch,
        MAX(r.timestamp) as latest_timestamp,
        COUNT(f.id) as flag_count
       FROM records r LEFT JOIN flags f ON f.record_id = r.id ${where}
       GROUP BY r.session_id
       ORDER BY latest_timestamp DESC`
    ).all(...params);

    return { total_flags, by_type, by_session };
  }

  async getSessionFlagCounts() {
    return this.db.prepare(
      `SELECT
        r.session_id,
        COUNT(f.id) as total_flags,
        SUM(CASE WHEN f.review_status = 'unreviewed' THEN 1 ELSE 0 END) as unreviewed_flags
       FROM records r
       LEFT JOIN flags f ON f.record_id = r.id
       GROUP BY r.session_id`
    ).all();
  }

  async getRecordsWithFlags(sessionId) {
    const records = await this.getSession(sessionId);
    if (!records.length) return [];
    const recordIds = records.map(r => r.id);
    const placeholders = recordIds.map(() => '?').join(',');
    const allFlags = this.db.prepare(
      `SELECT * FROM flags WHERE record_id IN (${placeholders})`
    ).all(...recordIds);
    const flagsByRecord = new Map();
    for (const flag of allFlags) {
      if (!flagsByRecord.has(flag.record_id)) flagsByRecord.set(flag.record_id, []);
      flagsByRecord.get(flag.record_id).push(flag);
    }
    for (const record of records) {
      record.flags = flagsByRecord.get(record.id) || [];
    }
    return records;
  }

  async getDbSizeBytes() {
    try { return fs.statSync(this.dbPath).size; }
    catch { return 0; }
  }
}
