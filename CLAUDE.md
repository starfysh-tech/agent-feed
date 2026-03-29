# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Agent Feed is a transparent HTTP proxy that captures coding agent (Claude Code, Codex, Gemini) API responses, classifies them with a secondary LLM call to extract decisions/assumptions/flags, and stores everything in SQLite for post-session review via a web UI.

## Commands

```bash
npm test                    # run all tests (node --test)
npm run test:watch          # run tests in watch mode
node --test test/foo.test.js  # run a single test file

node src/cli/index.js start           # start proxy + classifier + UI
node src/cli/index.js start --verbose # foreground with logging
node src/cli/index.js stop            # stop all services
node src/cli/index.js eval classifier # precision/recall report
node src/cli/index.js eval show       # show missed flags and FPs
```

## Architecture

The system is a pipeline: **Proxy → Adapter → Classifier → Database → UI**.

### Request flow

1. **Proxy** (`src/proxy/index.js`) — HTTP server that forwards requests to upstream APIs unchanged. On response completion, fires `onCapture` callback asynchronously via `setImmediate`. Scrubs auth headers and API key fields before persisting request data.

2. **Pipeline** (`src/pipeline.js`) — Orchestrates the capture-to-storage flow. Selects the correct adapter by hostname, extracts session ID and content, runs the classifier, collects git context, then writes the record and flags to the database. Tracks per-session turn counts in memory.

3. **Adapters** (`src/adapters/index.js`) — Per-agent extractors dispatched by `HOST_MAP` (hostname → adapter). Each adapter implements `extractSessionId`, `extractContent`, `extractModel`, `extractTokenCount`. Adding a new agent = adding a new adapter object and HOST_MAP entry.

4. **Classifier** (`src/classifier/index.js`) — Sends response text to a classification LLM. Supports Anthropic API and OpenAI-compatible APIs (Ollama, LM Studio). The classification prompt (`CLASSIFICATION_PROMPT`) is the primary tuning surface. `validateClassifierWithFallback` tries configured provider → Ollama → LM Studio → Anthropic API key in sequence.

5. **Database** (`src/storage/database.js`) — sql.js (in-process SQLite). Two tables: `records` (captured responses with git context) and `flags` (extracted items with review state). Persists to disk after every write via `_persist()`.

6. **UI** (`src/ui/server.js`) — Single-file HTTP server serving a self-contained HTML/CSS/JS page plus REST API endpoints. No build step, no bundler, no framework. The entire UI is returned from `buildHTML()`.

7. **Eval** (`src/eval.js`) — Re-runs the classifier against labeled flags to compute precision/recall/F1. Two modes: `runClassifierEval` (aggregate metrics) and `getEvalExamples` (specific missed/FP examples).

### Key design decisions

- **ESM-only** — `"type": "module"` in package.json, all imports use `.js` extensions
- **No build step** — plain Node.js, no transpilation, no bundler
- **sql.js not better-sqlite3** — despite both being in package.json, the codebase uses `sql.js` (pure JS SQLite). `better-sqlite3` is listed but unused.
- **Classifier is fire-and-forget** — classifier failures don't block storage (`pipeline.js:47-53`)
- **All state in `~/.agent-feed/`** — database, config, PID file, logs
- **Config is TOML** — loaded from `~/.agent-feed/config.toml`, deep-merged with defaults
- **innerHTML with esc()** — The UI uses `innerHTML` for DOM updates. All dynamic values MUST pass through the `esc()` helper (line 293 of `src/ui/server.js`) which encodes `&`, `<`, `>`, `"`. Never use `innerHTML` with unsanitized data. For new UI code, prefer `textContent` when HTML structure isn't needed.

### REST API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions (filterable by `agent`, `date`) |
| GET | `/api/sessions/:id` | Get session records with flags |
| GET | `/api/sessions/:id/records/:id/raw` | Get raw request/response |
| PATCH | `/api/flags/:id` | Update flag review status/notes |
| GET | `/api/trends` | Aggregated flag trends (filterable) |

### Flag types

`decision`, `assumption`, `architecture`, `pattern`, `dependency`, `tradeoff`, `constraint`, `workaround`, `risk`

### Review statuses

`unreviewed`, `accepted`, `needs_change`, `false_positive`

## Testing

- Tests use Node.js built-in test runner (`node:test`)
- All tests are in `test/*.test.js`
- Tests construct components directly with mocked dependencies (fake fetch, in-memory DB)
- No external test framework or assertion library beyond `node:assert`
