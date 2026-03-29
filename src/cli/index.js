#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { App } from '../app.js';
import { loadConfig } from '../config.js';

const AGENT_FEED_DIR = path.join(os.homedir(), '.agent-feed');
const PID_FILE = path.join(AGENT_FEED_DIR, 'agent-feed.pid');
const LOG_FILE = path.join(AGENT_FEED_DIR, 'agent-feed.log');
const CONFIG_FILE = path.join(AGENT_FEED_DIR, 'config.toml');

function ensureDir() {
  if (!fs.existsSync(AGENT_FEED_DIR)) {
    fs.mkdirSync(AGENT_FEED_DIR, { recursive: true });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function writePid(pid) {
  fs.writeFileSync(PID_FILE, String(pid));
}

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  return raw ? parseInt(raw, 10) : null;
}

function clearPid() {
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

async function cmdStart({ verbose = false } = {}) {
  ensureDir();

  const existingPid = readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.error(`Agent Feed is already running (PID ${existingPid})`);
    process.exit(1);
  }

  const config = loadConfig(CONFIG_FILE);
  console.log('Starting Agent Feed...');

  const app = new App({ config });

  // Validate classifier before starting anything else
  // (App.start() will throw if classifier is unreachable)
  try {
    await app.start();
  } catch (err) {
    const reason = err.message ?? String(err);
    console.error(`  ✗ ${reason}`);
    console.error('\nAgent Feed failed to start. Resolve the above and try again.');
    log(`startup failed: ${reason}`);
    process.exit(1);
  }

  const status = app.getStatus();
  const dbSize = formatBytes(status.dbSizeBytes);
  const classifierLabel = status.classifierLabel ?? config.classifier.provider;

  console.log(`  ✓ Proxy listening on :${status.proxyPort}`);
  console.log(`  ✓ Classifier ready (${classifierLabel})`);
  console.log(`  ✓ Web UI available at http://localhost:${status.uiPort}`);
  console.log(`  ✓ SQLite initialized at ${config.storage.path} (${dbSize})`);
  console.log('Agent Feed ready.');

  log(`started -- proxy :${status.proxyPort}, ui :${status.uiPort}`);

  if (!verbose) {
    // Run in background -- write PID and detach stdio
    writePid(process.pid);

    // Handle graceful shutdown
    const shutdown = async () => {
      log('shutting down');
      await app.stop();
      clearPid();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Keep process alive
    process.stdin.resume();
  } else {
    writePid(process.pid);
    console.log('\n[verbose] Logging to', LOG_FILE);
    console.log('[verbose] Press Ctrl+C to stop\n');

    const shutdown = async () => {
      console.log('\nStopping Agent Feed...');
      log('shutting down (verbose)');
      await app.stop();
      clearPid();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.stdin.resume();
  }
}

async function cmdStop() {
  const pid = readPid();
  if (!pid) {
    console.error('Agent Feed is not running (no PID file found)');
    process.exit(1);
  }
  if (!isProcessRunning(pid)) {
    console.error(`Agent Feed process (PID ${pid}) is not running -- cleaning up`);
    clearPid();
    process.exit(0);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Agent Feed stopped (PID ${pid})`);
    clearPid();
  } catch (err) {
    console.error(`Failed to stop Agent Feed: ${err.message}`);
    process.exit(1);
  }
}

async function cmdEval(subcommand) {
  const validSubcommands = ['classifier', 'show'];
  if (!validSubcommands.includes(subcommand)) {
    console.error(`Unknown eval target: ${subcommand}`);
    console.error('Usage:');
    console.error('  agent-feed eval classifier   Precision/recall report');
    console.error('  agent-feed eval show         Show missed flags and false positives');
    process.exit(1);
  }

  ensureDir();
  const config = loadConfig(CONFIG_FILE);
  const dbPath = config.storage.path.startsWith('~')
    ? path.join(os.homedir(), config.storage.path.slice(1))
    : config.storage.path;

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}. Run agent-feed start first.`);
    process.exit(1);
  }

  const { Database } = await import('../storage/database.js');
  const { buildClassifier, validateClassifier } = await import('../classifier/index.js');
  const { runClassifierEval, getEvalExamples, formatEvalReport, formatEvalExamples } = await import('../eval.js');

  const db = new Database(dbPath);
  await db.init();

  const validation = await validateClassifier(config.classifier);
  if (!validation.ok) {
    console.error(`Classifier unreachable: ${validation.reason}`);
    process.exit(1);
  }

  const classifierFn = buildClassifier(config.classifier);

  if (subcommand === 'classifier') {
    console.log('Running classifier eval...');
    const report = await runClassifierEval({ db, classifierFn });
    await db.close();
    console.log('');
    console.log(formatEvalReport(report));
  } else if (subcommand === 'show') {
    console.log('Loading eval examples...');
    const examples = await getEvalExamples({ db, classifierFn });
    await db.close();
    console.log('');
    console.log(formatEvalExamples(examples));
  }
}

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0];
const verbose = args.includes('--verbose');

switch (command) {
  case 'start':
    await cmdStart({ verbose });
    break;
  case 'stop':
    await cmdStop();
    break;
  case 'eval':
    await cmdEval(args[1]);
    break;
  default:
    console.log('Usage:');
    console.log('  agent-feed start               Start proxy, classifier, and UI in background');
    console.log('  agent-feed start --verbose      Start in foreground with diagnostic logging');
    console.log('  agent-feed stop                 Stop all services');
    console.log('  agent-feed eval classifier      Run classifier precision/recall eval');
    console.log('  agent-feed eval show            Show missed flags and false positives');
    process.exit(command ? 1 : 0);
}
