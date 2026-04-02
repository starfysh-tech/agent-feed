# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Agent Feed is a transparent HTTP proxy that captures coding agent (Claude Code, Codex, Gemini) API responses, classifies them with a secondary LLM call to extract decisions/assumptions/flags, and stores everything in SQLite for post-session review via a web UI.

## Commands

```bash
npm test                    # run all tests (node --test)
npm run test:watch          # run tests in watch mode
node --test test/foo.test.js  # run a single test file

agent-feed start              # start proxy + classifier + UI (daemonizes)
agent-feed start --verbose    # foreground with logging
agent-feed stop               # stop all services
agent-feed env                # output shell export/unset commands
agent-feed shell-init         # output shell integration snippet for .zshrc
agent-feed eval classifier    # precision/recall report
agent-feed eval show          # show missed flags and FPs
```

## Architecture

The system is a pipeline: **Proxy → Adapter → Classifier → Database → UI**.

### Request flow

1. **Proxy** (`src/proxy/index.js`) — HTTP server with header-based routing. Upstream is determined by provider-specific request headers (`anthropic-version` → Anthropic, `x-goog-api-key`/`x-goog-api-client` → Google, fallback → OpenAI). Paths pass through unchanged — the proxy never rewrites URLs. Legacy path prefixes (`/anthropic`, `/openai`, `/google`) are still supported for backward compat with existing sessions. WebSocket upgrade requests (used by Codex) are proxied via raw TLS socket piping. Request bodies are accumulated as `Buffer` chunks (not strings) to preserve multi-byte UTF-8 integrity, then forwarded as raw bytes. Raw response bytes are piped directly to the client (preserving gzip/br encoding); a separate decompressed copy is accumulated for capture. Scrubs auth headers and API key fields on the capture copy only — the forwarded body is never modified. Logs all requests when `verbose: true`; logs non-2xx upstream responses as warnings otherwise. `UPSTREAM_RULES` defines header-based routing; `LEGACY_PREFIXES` defines path-prefix fallback; both are injectable via constructor for testing.

2. **Pipeline** (`src/pipeline.js`) — Orchestrates the capture-to-storage flow. Selects the correct adapter by hostname, extracts session ID and content, runs the classifier, collects git context, then writes the record and flags to the database. Tracks per-session turn counts in memory. Before storage, `trimRequestForStorage` reduces the request payload to only the last 2 messages + metadata (drops tools, system, model, and prior conversation history). The full `capture.rawRequest` is still available in-memory for hashing and session extraction before trimming.

3. **Adapters** (`src/adapters/index.js`) — Per-agent extractors dispatched by `HOST_MAP` (hostname → adapter). Each adapter implements `extractSessionId`, `extractContent`, `extractModel`, `extractTokenCount`. The Claude adapter extracts the persistent conversation session ID from `context.rawRequest` (`metadata.user_id.session_id`, double JSON-encoded), falling back to the response message ID if metadata is absent. The Gemini adapter handles both the public API (`generativelanguage.googleapis.com`) and Code Assist (`cloudcode-pa.googleapis.com`) SSE formats, filtering out thought parts. Admin/quota responses are skipped (return null session ID). All adapters handle both JSON and SSE (streaming) via the shared `parseSSEEvents()`. Adding a new agent = adding a new adapter object and HOST_MAP entry.

4. **Classifier** (`src/classifier/index.js`) — Sends response text to a classification LLM. Supports Anthropic API and OpenAI-compatible APIs (Ollama, LM Studio). The classification prompt (`CLASSIFICATION_PROMPT`) is the primary tuning surface. `validateClassifierWithFallback` tries configured provider → Ollama → LM Studio → Anthropic API key in sequence.

5. **Database** (`src/storage/database.js`) — better-sqlite3 (native SQLite). Two tables: `records` (captured responses with git context) and `flags` (extracted items with review state). Uses WAL mode and `busy_timeout = 5000` for safe concurrent access (daemon + CLI eval).

6. **UI** (`src/ui/server.js`) — Single-file HTTP server serving a self-contained HTML/CSS/JS page plus REST API endpoints. No build step, no bundler, no framework. The entire UI is returned from `buildHTML()`.

7. **Eval** (`src/eval.js`) — Re-runs the classifier against labeled flags to compute precision/recall/F1. Two modes: `runClassifierEval` (aggregate metrics) and `getEvalExamples` (specific missed/FP examples).

### Daemon lifecycle

`agent-feed start` forks a **supervisor** process (detached), which forks the **daemon** child. The supervisor monitors the child and re-forks on non-zero exit with exponential backoff (up to 5 restarts in 60s). The PID file tracks the supervisor, not the daemon. `agent-feed stop` sends SIGTERM to the supervisor, which forwards to the child. In `--verbose` mode, there is no supervisor — the daemon runs in the foreground.

### Key design decisions

- **ESM-only** — `"type": "module"` in package.json, all imports use `.js` extensions
- **No build step** — plain Node.js, no transpilation, no bundler
- **better-sqlite3 not sql.js** — native SQLite with disk-backed storage, WAL mode for concurrent access. The `Database` class methods are `async` for interface compatibility but execute synchronously.
- **Classifier is fire-and-forget** — classifier failures don't block storage (`pipeline.js:47-53`)
- **All state in `~/.agent-feed/`** — database, config, PID file, env file, logs
- **Config is TOML** — loaded from `~/.agent-feed/config.toml`, deep-merged with defaults
- **innerHTML with esc()** — The UI uses `innerHTML` for DOM updates. All dynamic values MUST pass through the `esc()` helper (line 293 of `src/ui/server.js`) which encodes `&`, `<`, `>`, `"`. Never use `innerHTML` with unsanitized data. For new UI code, prefer `textContent` when HTML structure isn't needed.
- **escAttr() for onclick values** — Values embedded in HTML `onclick` attributes via `JSON.stringify` must use `escAttr()` (not raw `JSON.stringify`) to escape `"` as `&quot;`. The `buildHTML()` template literal does not preserve `\'` escapes.

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

## Conventions

- **TODO.md** — Unrelated observations found during work (bugs, tech debt, improvements) should be added to `TODO.md` rather than implemented inline or silently skipped.
