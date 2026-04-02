import Database from 'better-sqlite3';
import { statSync } from 'node:fs';

const dbPath = process.env.HOME + '/.agent-feed/feed.db';
const d = new Database(dbPath, { readonly: true });

const dbSize = statSync(dbPath).size;
console.log(`DB: ${(dbSize / 1024 / 1024).toFixed(1)} MB\n`);

// Recent records
const recent = d.prepare(`
  SELECT timestamp, agent, model, turn_index, token_count,
    length(raw_request) as req_bytes, length(raw_response) as resp_bytes,
    json_array_length(json_extract(raw_request, '$.messages')) as msg_count,
    substr(session_id, 1, 12) as session
  FROM records ORDER BY timestamp DESC LIMIT 15
`).all();

console.log('Last 15 records:');
console.log('Time     | Agent      | Model                     | Turn | Tokens | Req KB | Resp KB | Msgs | Session');
console.log('---------|------------|---------------------------|------|--------|--------|---------|------|--------');
for (const r of recent) {
  const ts = r.timestamp?.slice(11, 19) || 'n/a';
  console.log(
    `${ts} | ${(r.agent || '').padEnd(10)} | ${(r.model || 'unknown').padEnd(25)} | ${String(r.turn_index).padStart(4)} | ${String(r.token_count || 0).padStart(6)} | ${String(Math.round(r.req_bytes / 1024)).padStart(6)} | ${String(Math.round(r.resp_bytes / 1024)).padStart(7)} | ${String(r.msg_count ?? '-').padStart(4)} | ${r.session}...`
  );
}

// Agent distribution
console.log('\n--- Agents (last hour) ---');
const agents = d.prepare(`
  SELECT agent, count(*) as cnt, count(distinct session_id) as sessions
  FROM records WHERE timestamp >= datetime('now', '-1 hour')
  GROUP BY agent
`).all();
for (const r of agents) console.log(`${r.agent}: ${r.cnt} records, ${r.sessions} sessions`);

// Trimming check
console.log('\n--- Trimming (last 15) ---');
const trim = d.prepare(`
  SELECT
    sum(CASE WHEN json_extract(raw_request, '$.tools') IS NOT NULL THEN 1 ELSE 0 END) as untrimmed,
    sum(CASE WHEN json_extract(raw_request, '$.tools') IS NULL THEN 1 ELSE 0 END) as trimmed,
    round(avg(length(raw_request)) / 1024.0, 1) as avg_kb
  FROM (SELECT raw_request FROM records WHERE raw_request IS NOT NULL ORDER BY timestamp DESC LIMIT 15)
`).get();
console.log(`Trimmed: ${trim.trimmed}, Untrimmed: ${trim.untrimmed}, Avg: ${trim.avg_kb} KB`);

// Flags
console.log('\n--- Flags (last hour) ---');
const flags = d.prepare(`
  SELECT count(*) as cnt FROM flags f
  JOIN records r ON f.record_id = r.id
  WHERE r.timestamp >= datetime('now', '-1 hour')
`).get();
console.log(`${flags.cnt} flags`);

d.close();
