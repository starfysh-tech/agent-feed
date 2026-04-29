// OTel sink: takes parsed OTLP log records (and metric points), normalizes
// via the per-vendor adapters, and routes to the right storage table.
//
// Routing rules:
//   - api_response_body events become `records` rows via Pipeline.process(_, 'otel')
//   - all other events go straight into the `events` table
//   - api_request_body events are stored in `events` (paired with the corresponding
//     api_response_body via shared request_id; not used for records insertion
//     since request_id is reliably on api_response_body but not api_request_body)

import { createHash } from 'node:crypto';
import { getAdapter } from './adapters/index.js';
import { getAdapter as getProxyAdapter } from '../adapters/index.js';
import { scrubAttrs } from './scrub.js';

// Reuse the proxy adapters for response-text extraction. Their plain-JSON
// branches handle exactly the body shape that OTel api_response_body delivers.
const PROXY_ADAPTER_BY_VENDOR = {
  claude: getProxyAdapter('api.anthropic.com'),
  gemini: getProxyAdapter('generativelanguage.googleapis.com'),
};

// Event kinds that should also produce a `records` row.
const RECORDS_KINDS = new Set(['api_response_body']);

export class OtelSink {
  constructor({ db, logger = console }) {
    this.db = db;
    this.logger = logger;
  }

  // Process an array of parsed log records (output of parseLogs).
  // Returns counts: { events: n, records: n, skipped: n }.
  // All inserts are wrapped in a single better-sqlite3 transaction — collapses
  // fsync cost and serializes cleanly under WAL contention.
  async ingestLogs(records) {
    const counts = { events: 0, records: 0, skipped: 0 };
    const work = this.db.db.transaction(() => {
      for (const record of records) {
        try {
          const result = this._ingestOneSync(record);
          counts[result] = (counts[result] ?? 0) + 1;
        } catch (err) {
          counts.skipped++;
          this.logger.error?.('[otel-sink] error ingesting record:', err.message ?? err);
        }
      }
    });
    work();
    return counts;
  }

  // Synchronous version of _ingestOne — required because better-sqlite3's
  // transaction wrapper rejects async callbacks. All DB calls in db.js are
  // sync-under-the-hood despite the async signature; we call them directly.
  _ingestOneSync(record) {
    const adapter = getAdapter(record);
    if (!adapter) return 'skipped';

    const event = adapter.extract(record);
    if (!event.sessionId) return 'skipped';

    const scrubbedAttrs = scrubAttrs(event.attrs);
    const eventId = deterministicId(event);

    // Inline insertEvent (sync via better-sqlite3 prepared statement)
    this.db.db.prepare(
      `INSERT OR IGNORE INTO events (
        id, timestamp, agent, session_id, prompt_id, request_id,
        event_kind, event_name, sequence, attributes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      event.time ?? new Date().toISOString(),
      event.vendor,
      event.sessionId,
      event.promptId ?? null,
      event.requestId ?? null,
      event.kind,
      event.name,
      event.sequence ?? null,
      JSON.stringify(scrubbedAttrs ?? {}),
    );

    if (RECORDS_KINDS.has(event.kind)) {
      this._writeRecordSync(event, scrubbedAttrs, eventId);
      return 'records';
    }
    return 'events';
  }

  // eventId is the same deterministic id used for events: pairs an OTel
  // exporter retry's events row with its records row, so INSERT OR IGNORE
  // dedupes both tables in lockstep.
  _writeRecordSync(event, attrs, eventId) {
    const body = attrs?.body ?? null;
    const responseText = extractResponseText(body, event.vendor);
    const tokenCount = extractTokenCount(attrs, event.vendor);

    // turn_index derived atomically inside the INSERT — avoids the
    // check-then-write race that two concurrent batches for the same
    // (session, source) would otherwise hit. INSERT OR IGNORE on the
    // deterministic eventId means a retried OTel batch is a no-op.
    this.db.db.prepare(
      `INSERT OR IGNORE INTO records (
        id, timestamp, agent, agent_version, session_id, turn_index,
        repo, working_directory, git_branch, git_commit,
        request_summary, response_summary, response_text, raw_request, raw_response,
        token_count, model, source, request_id
      ) VALUES (
        ?, ?, ?, ?, ?,
        (SELECT COALESCE(MAX(turn_index), 0) + 1 FROM records WHERE session_id = ? AND source = 'otel'),
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`
    ).run(
      eventId,
      event.time ?? new Date().toISOString(),
      event.vendor,
      null,
      event.sessionId,
      event.sessionId,                                    // session_id for the SELECT subquery
      null,
      event.resource?.['process.cwd'] ?? '<unknown>',
      null,
      null,
      null,
      (responseText ?? '').slice(0, 200),
      responseText,
      null,
      typeof body === 'string' ? body : '',
      tokenCount,
      attrs?.model ?? attrs?.['gen_ai.response.model'] ?? 'unknown',
      'otel',
      event.requestId ?? null,
    );
  }

}

// Deterministic id: stable across OTel exporter retries.
// Inputs that must coincide: vendor, sessionId, eventName, sequence (when present, else time).
function deterministicId(event) {
  const key = [
    event.vendor,
    event.sessionId,
    event.name,
    event.sequence ?? event.time ?? '',
    event.requestId ?? '',
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function extractResponseText(body, vendor) {
  if (typeof body !== 'string' || body.length === 0) return null;
  const adapter = PROXY_ADAPTER_BY_VENDOR[vendor];
  if (!adapter?.extractContent) return null;
  try { return adapter.extractContent(body); } catch { return null; }
}

function extractTokenCount(attrs, vendor) {
  if (!attrs) return null;
  if (vendor === 'claude') {
    const input = num(attrs.input_tokens);
    const output = num(attrs.output_tokens);
    if (input != null && output != null) return input + output;
  }
  if (vendor === 'gemini') {
    const input = num(attrs.input_token_count ?? attrs['gen_ai.usage.input_tokens']);
    const output = num(attrs.output_token_count ?? attrs['gen_ai.usage.output_tokens']);
    if (input != null && output != null) return input + output;
  }
  return null;
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
