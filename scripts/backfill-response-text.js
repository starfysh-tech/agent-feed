#!/usr/bin/env node

/**
 * One-time backfill: extract response_text from raw_response for existing records.
 * Safe to run multiple times — only updates records where response_text IS NULL.
 *
 * Usage: node scripts/backfill-response-text.js
 */

import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { getAdapter } from '../src/adapters/index.js';

// Map agent names to hostnames for adapter lookup
const AGENT_TO_HOST = {
  'claude-code': 'api.anthropic.com',
  'codex': 'api.openai.com',
  'gemini': 'generativelanguage.googleapis.com',
};

const dbPath = path.join(os.homedir(), '.agent-feed', 'feed.db');
const db = new BetterSqlite3(dbPath);
db.pragma('journal_mode = WAL');

const rows = db.prepare('SELECT id, agent, raw_response FROM records WHERE response_text IS NULL').all();
console.log(`Records to backfill: ${rows.length}`);

const update = db.prepare('UPDATE records SET response_text = ? WHERE id = ?');
let filled = 0;
let skipped = 0;

for (const row of rows) {
  const host = AGENT_TO_HOST[row.agent] ?? 'api.anthropic.com';
  const adapter = getAdapter(host);
  try {
    const text = adapter.extractContent(row.raw_response);
    if (text) {
      update.run(text, row.id);
      filled++;
    } else {
      skipped++;
    }
  } catch {
    skipped++;
  }
}

console.log(`Backfilled: ${filled}`);
console.log(`Skipped (no extractable text): ${skipped}`);
db.close();
