import initSqlJs from 'sql.js';
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
    const SQL = await initSqlJs();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.dbPath)) {
      const data = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(data);
    } else {
      this.db = new SQL.Database();
    }
    this.db.run(SCHEMA);
    this._persist();
  }

  _persist() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  async close() {
    if (this.db) {
      this._persist();
      this.db.close();
      this.db = null;
    }
  }

  async insertRecord(record) {
    const id = randomUUID();
    this.db.run(
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
      )`,
      [
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
      ]
    );
    this._persist();
    return id;
  }

  async insertFlag(flag) {
    if (!VALID_FLAG_TYPES.includes(flag.type)) {
      throw new Error(`Invalid flag type: ${flag.type}. Must be one of: ${VALID_FLAG_TYPES.join(', ')}`);
    }
    const id = randomUUID();
    this.db.run(
      `INSERT INTO flags (id, record_id, type, content, confidence, review_status)
       VALUES (?, ?, ?, ?, ?, 'unreviewed')`,
      [id, flag.record_id, flag.type, flag.content, flag.confidence]
    );
    this._persist();
    return id;
  }

  async getSession(sessionId) {
    const result = this.db.exec(
      `SELECT * FROM records WHERE session_id = ? ORDER BY turn_index ASC`,
      [sessionId]
    );
    if (!result.length) return [];
    return this._rowsToObjects(result[0]);
  }

  async listSessions() {
    const result = this.db.exec(
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
    );
    if (!result.length) return [];
    return this._rowsToObjects(result[0]);
  }

  async getFlagsForRecord(recordId) {
    const result = this.db.exec(
      `SELECT * FROM flags WHERE record_id = ?`,
      [recordId]
    );
    if (!result.length) return [];
    return this._rowsToObjects(result[0]);
  }

  async updateFlagReview(flagId, { review_status, reviewer_note, outcome }) {
    if (review_status && !VALID_REVIEW_STATUSES.includes(review_status)) {
      throw new Error(`Invalid review_status: ${review_status}`);
    }
    this.db.run(
      `UPDATE flags SET
        review_status = COALESCE(?, review_status),
        reviewer_note = COALESCE(?, reviewer_note),
        outcome = COALESCE(?, outcome)
       WHERE id = ?`,
      [review_status ?? null, reviewer_note ?? null, outcome ?? null, flagId]
    );
    this._persist();
  }

  async getTrends({ agent, repo, branch, dateFrom, dateTo } = {}) {
    // Build WHERE clause for records
    const conditions = [];
    const params = [];
    if (agent)    { conditions.push('r.agent = ?');       params.push(agent); }
    if (repo)     { conditions.push('r.repo = ?');        params.push(repo); }
    if (branch)   { conditions.push('r.git_branch = ?');  params.push(branch); }
    if (dateFrom) { conditions.push('r.timestamp >= ?');  params.push(dateFrom); }
    if (dateTo)   { conditions.push('r.timestamp <= ?');  params.push(dateTo); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Total flags
    const totalResult = this.db.exec(
      `SELECT COUNT(f.id) as total FROM flags f JOIN records r ON f.record_id = r.id ${where}`,
      params
    );
    const total_flags = totalResult[0]?.values[0]?.[0] ?? 0;

    // By type with false_positive_rate
    const byTypeResult = this.db.exec(
      `SELECT
        f.type,
        COUNT(f.id) as count,
        SUM(CASE WHEN f.review_status = 'false_positive' THEN 1 ELSE 0 END) as fp_count
       FROM flags f JOIN records r ON f.record_id = r.id ${where}
       GROUP BY f.type
       ORDER BY count DESC`,
      params
    );

    const by_type = byTypeResult.length
      ? this._rowsToObjects(byTypeResult[0]).map(row => ({
          type: row.type,
          count: row.count,
          false_positive_rate: row.count > 0 ? row.fp_count / row.count : 0,
        }))
      : [];

    // By session
    const bySessionResult = this.db.exec(
      `SELECT
        r.session_id,
        r.agent,
        r.repo,
        r.git_branch,
        MAX(r.timestamp) as latest_timestamp,
        COUNT(f.id) as flag_count
       FROM records r LEFT JOIN flags f ON f.record_id = r.id ${where}
       GROUP BY r.session_id
       ORDER BY latest_timestamp DESC`,
      params
    );

    const by_session = bySessionResult.length
      ? this._rowsToObjects(bySessionResult[0])
      : [];

    return { total_flags, by_type, by_session };
  }

  async getDbSizeBytes() {
    if (!fs.existsSync(this.dbPath)) return 0;
    return fs.statSync(this.dbPath).size;
  }

  _rowsToObjects({ columns, values }) {
    return values.map(row =>
      Object.fromEntries(columns.map((col, i) => [col, row[i]]))
    );
  }
}
