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

const VALID_SOURCES = ['proxy', 'otel'];

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
    response_text TEXT,
    raw_request TEXT,
    raw_response TEXT NOT NULL,
    token_count INTEGER,
    model TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'proxy',
    request_id TEXT
  );

  CREATE TABLE IF NOT EXISTS flags (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'unreviewed',
    context TEXT,
    reviewer_note TEXT,
    outcome TEXT,
    FOREIGN KEY (record_id) REFERENCES records(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    agent TEXT NOT NULL,
    session_id TEXT NOT NULL,
    prompt_id TEXT,
    request_id TEXT,
    event_kind TEXT NOT NULL,
    event_name TEXT NOT NULL,
    sequence INTEGER,
    attributes TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id);
  CREATE INDEX IF NOT EXISTS idx_flags_record ON flags(record_id);
  CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_events_session_kind ON events(session_id, event_kind);
  CREATE INDEX IF NOT EXISTS idx_events_prompt ON events(prompt_id);
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
    // Pragmas must be set OUTSIDE the migration transaction — journal_mode=WAL
    // can't reliably be changed inside a transaction in SQLite.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    // All schema/migration work runs as one transaction. SQLite DDL is
    // transactional in better-sqlite3; if any step throws, the entire schema
    // change rolls back, leaving the DB exactly as it was on entry. Prevents
    // the partial-migration class that crashed agent-feed restart historically.
    const migrate = this.db.transaction(() => {
      this.db.exec(SCHEMA);
      // Backfill columns onto pre-existing tables. Each ALTER is guarded by a
      // pragma table_info check so re-runs are no-ops.
      const flagCols = this.db.pragma('table_info(flags)').map(c => c.name);
      if (!flagCols.includes('context')) {
        this.db.exec('ALTER TABLE flags ADD COLUMN context TEXT');
      }
      const recordCols = this.db.pragma('table_info(records)').map(c => c.name);
      if (!recordCols.includes('response_text')) {
        this.db.exec('ALTER TABLE records ADD COLUMN response_text TEXT');
      }
      if (!recordCols.includes('source')) {
        this.db.exec("ALTER TABLE records ADD COLUMN source TEXT NOT NULL DEFAULT 'proxy'");
      }
      if (!recordCols.includes('request_id')) {
        this.db.exec('ALTER TABLE records ADD COLUMN request_id TEXT');
      }
      // Index must be created AFTER request_id exists; kept out of SCHEMA so
      // it never runs against a pre-OTel records table.
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_records_session_request ON records(session_id, request_id)');
    });
    migrate();
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    // Cached prepared statements are bound to the closed connection;
    // drop them so a subsequent init() doesn't reuse a stale handle.
    this._pingStmt = null;
  }

  // Cheap liveness check — used by /api/health to confirm the DB connection
  // is still serving queries. Throws on closed/uninitialized DB. The prepared
  // statement is lazily cached so probe-rate calls don't pay the
  // statement-compile cost on each invocation; if the cached statement was
  // bound to a connection that's since been closed/reopened (test harnesses
  // do this), re-prepare on the new connection rather than throwing.
  ping() {
    if (!this.db) throw new Error('Database not initialized');
    if (!this._pingStmt) this._pingStmt = this.db.prepare('SELECT 1 AS ok');
    try {
      return this._pingStmt.get();
    } catch {
      this._pingStmt = this.db.prepare('SELECT 1 AS ok');
      return this._pingStmt.get();
    }
  }

  async insertRecord(record) {
    const id = randomUUID();
    const source = record.source ?? 'proxy';
    if (!VALID_SOURCES.includes(source)) {
      throw new Error(`Invalid source: ${source}. Must be one of: ${VALID_SOURCES.join(', ')}`);
    }
    // turn_index: when caller doesn't supply one, derive `MAX(turn_index)+1`
    // atomically inside the INSERT itself. This avoids the check-then-write
    // race that two concurrent captures would otherwise hit.
    const useDerivedTurn = record.turn_index == null;
    const sql = useDerivedTurn
      ? `INSERT INTO records (
          id, timestamp, agent, agent_version, session_id, turn_index,
          repo, working_directory, git_branch, git_commit,
          request_summary, response_summary, response_text, raw_request, raw_response,
          token_count, model, source, request_id
        ) VALUES (
          ?, ?, ?, ?, ?,
          (SELECT COALESCE(MAX(turn_index), 0) + 1 FROM records WHERE session_id = ? AND source = ?),
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )`
      : `INSERT INTO records (
          id, timestamp, agent, agent_version, session_id, turn_index,
          repo, working_directory, git_branch, git_commit,
          request_summary, response_summary, response_text, raw_request, raw_response,
          token_count, model, source, request_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )`;
    const turnArgs = useDerivedTurn
      ? [record.session_id, source]
      : [record.turn_index];
    this.db.prepare(sql).run(
      id,
      record.timestamp,
      record.agent,
      record.agent_version ?? null,
      record.session_id,
      ...turnArgs,
      record.repo ?? null,
      record.working_directory,
      record.git_branch ?? null,
      record.git_commit ?? null,
      record.request_summary ?? null,
      record.response_summary,
      record.response_text ?? null,
      record.raw_request ?? null,
      record.raw_response,
      record.token_count ?? null,
      record.model,
      source,
      record.request_id ?? null,
    );
    return id;
  }

  // Idempotent: deterministic id supplied by caller, ON CONFLICT DO NOTHING.
  // Returns the row id (existing or new). attributes must be JSON-serializable.
  async insertEvent(event) {
    const id = event.id;
    if (!id) throw new Error('insertEvent requires deterministic id');
    const attrsJson = typeof event.attributes === 'string'
      ? event.attributes
      : JSON.stringify(event.attributes ?? {});
    this.db.prepare(
      `INSERT OR IGNORE INTO events (
        id, timestamp, agent, session_id, prompt_id, request_id,
        event_kind, event_name, sequence, attributes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      event.timestamp,
      event.agent,
      event.session_id,
      event.prompt_id ?? null,
      event.request_id ?? null,
      event.event_kind,
      event.event_name,
      event.sequence ?? null,
      attrsJson,
    );
    return id;
  }

  async getEventsForSession(sessionId, { kind = null, promptId = null } = {}) {
    const conditions = ['session_id = ?'];
    const params = [sessionId];
    if (kind)     { conditions.push('event_kind = ?'); params.push(kind); }
    if (promptId) { conditions.push('prompt_id = ?');  params.push(promptId); }
    return this.db.prepare(
      `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY sequence ASC`
    ).all(...params);
  }

  // Coalesce records for a session: when both proxy and otel rows share the same
  // (session_id, request_id), prefer one row. Strategy: prefer proxy for raw_response
  // and response_text (untruncated), prefer otel for token_count when proxy lacks it.
  // Rows without request_id (e.g. existing legacy proxy rows) pass through unchanged.
  async getRecordsCoalesced(sessionId) {
    const records = this.db.prepare(
      `SELECT * FROM records WHERE session_id = ? ORDER BY turn_index ASC, timestamp ASC`
    ).all(sessionId);
    if (records.length === 0) return [];

    // Group by request_id; null request_id rows pass through individually
    const byKey = new Map();
    const standalone = [];
    for (const r of records) {
      if (!r.request_id) { standalone.push(r); continue; }
      const key = r.request_id;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }

    const merged = [];
    for (const group of byKey.values()) {
      if (group.length === 1) { merged.push(group[0]); continue; }
      const proxy = group.find(r => r.source === 'proxy');
      const otel  = group.find(r => r.source === 'otel');
      if (!proxy)  { merged.push(otel);  continue; }
      if (!otel)   { merged.push(proxy); continue; }
      merged.push({
        ...proxy,
        token_count: proxy.token_count ?? otel.token_count,
        // Mark coalesced for UI consumers
        source: 'proxy+otel',
      });
    }

    return [...standalone, ...merged].sort((a, b) => {
      if (a.turn_index !== b.turn_index) return a.turn_index - b.turn_index;
      return (a.timestamp ?? '').localeCompare(b.timestamp ?? '');
    });
  }

  // Derive next turn_index for a (session, source) pair. DB-derived so it survives restarts.
  async nextTurnIndex(sessionId, source = 'proxy') {
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(turn_index), 0) + 1 AS next FROM records WHERE session_id = ? AND source = ?`
    ).get(sessionId, source);
    return row?.next ?? 1;
  }

  async insertFlag(flag) {
    if (!VALID_FLAG_TYPES.includes(flag.type)) {
      throw new Error(`Invalid flag type: ${flag.type}. Must be one of: ${VALID_FLAG_TYPES.join(', ')}`);
    }
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO flags (id, record_id, type, content, context, confidence, review_status)
       VALUES (?, ?, ?, ?, ?, ?, 'unreviewed')`
    ).run(id, flag.record_id, flag.type, flag.content, flag.context ?? null, flag.confidence);
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
    return this._attachFlags(records);
  }

  // Coalesced view: prefer one row per (session_id, request_id), merging
  // proxy + otel side-by-side records. Flags attached to the proxy row when
  // both exist (classifier only runs on proxy source).
  async getCoalescedRecordsWithFlags(sessionId) {
    const coalesced = await this.getRecordsCoalesced(sessionId);
    return this._attachFlags(coalesced);
  }

  _attachFlags(records) {
    if (!records.length) return [];
    const recordIds = records.map(r => r.id).filter(Boolean);
    if (!recordIds.length) {
      for (const r of records) r.flags = [];
      return records;
    }
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
