# Configuration

Config lives at `~/.agent-feed/config.toml`. Created with defaults on first run.

```toml
[proxy]
port = 18080

[ui]
port = 3000

[classifier]
provider = "anthropic"            # anthropic | ollama | lmstudio
model = "claude-haiku-4-5-20251001"
base_url = ""                     # required for ollama / lmstudio

[storage]
path = "~/.agent-feed/feed.db"

[otel]
enabled = true
host = "127.0.0.1"
port = 4318
max_body_bytes = 1000000
```

## Daemon readiness & restart safety

`agent-feed start` (foreground CLI) verifies the daemon is actually serving traffic before reporting success. It polls `GET /api/health` on the UI server (default `:3000`); the endpoint runs `SELECT 1` against the SQLite DB so a successful response confirms migrations completed and the DB is queryable, not just that a socket got bound.

- **Default timeout**: 30 seconds. Override per-invocation with `AGENT_FEED_HEALTH_TIMEOUT_MS=<ms>` (e.g. `AGENT_FEED_HEALTH_TIMEOUT_MS=120000 agent-feed start` for a multi-GB DB on slow disk).
- **On probe failure**: the env file at `~/.agent-feed/env` is removed atomically so **new** shells don't inherit exports pointing at a dead port. The CLI prints the exact `unset ANTHROPIC_BASE_URL …` command and exits non-zero. Your **current** shell still has the env vars in process memory until you run `unset` or open a new terminal — the printed command is the fix.
- **Migrations are atomic**: `Database.init()` wraps schema/index work in a single `db.transaction()`. A partial failure rolls back the schema changes; the SQLite pragmas (`journal_mode=WAL`, `busy_timeout`) run outside the transaction and persist regardless. Combined with column-existence guards, re-runs are idempotent.
- **UI readiness probe uses IPv4**: the UI server binds `127.0.0.1` and the probe targets `127.0.0.1` to avoid IPv6 resolver mismatches on macOS. The proxy and the base-URL exports the agents consume still use `localhost` — only the readiness path is pinned.

**MITM caveat**: when a coding agent (Claude Code, Codex, Gemini) is actively routing API traffic through the proxy, `agent-feed restart`/`stop` drops in-flight requests. The shell wrapper from `agent-feed shell-init` re-evals env on stop/restart so new commands fall through to direct upstream — but a request *currently in flight* will fail. Restart only when no agent session depends on it.

## OTel ingestion

Agent Feed runs a local OTLP/JSON receiver alongside the proxy. It accepts OpenTelemetry log records, metrics, and traces from coding agents that emit them.

- Disabled with `[otel] enabled = false` or `agent-feed start --no-otel`.
- Always returns 200 (per OTLP partial-success spec) on parse error to prevent exporter retry storms.
- Body cap (default 1MB) — oversize requests get HTTP 413 (no retry).
- Bound to `127.0.0.1` only by default. Inbound auth is not supported (Gemini does not honor `OTEL_EXPORTER_OTLP_HEADERS`); local trust is assumed.
- Inbound `Authorization` and other custom OTLP headers are discarded and never logged.

To enable on the agent side, run `agent-feed env` and source the printed block.

### Working directory propagation

OTel rows record the working directory differently per agent:
- **Gemini CLI** sets `process.cwd` as a native resource attribute — the sink reads it directly (`src/otel/sink.js`).
- **Claude Code** does not, so `agent-feed env` exports `OTEL_RESOURCE_ATTRIBUTES="process.cwd=$(pwd)"`. `$(pwd)` is evaluated each time the env file is sourced; sourcing once and `cd`ing won't update it. Re-source after `cd` if you want the new directory tagged.
- **Codex CLI** support for `OTEL_RESOURCE_ATTRIBUTES` is undocumented — OTel rows from Codex may store `'<unknown>'` until upstream adds it.

The proxy path uses a separate mechanism: it parses `Primary working directory:` from the system prompt that Claude Code includes in API requests (`src/pipeline.js:extractWorkingDirectory`).

## Using a local model

Ollama:

```toml
[classifier]
provider = "ollama"
model = "llama3.1"
base_url = "http://localhost:11434"
```

LM Studio:

```toml
[classifier]
provider = "lmstudio"
model = "your-loaded-model"
base_url = "http://localhost:1234"
```

Both expose an OpenAI-compatible API. The classifier prompt and parsing work the same regardless of provider. The startup check validates the local server is reachable before launching.

## Data storage

Everything lives at `~/.agent-feed/`:

```
~/.agent-feed/
  feed.db           SQLite database (records, flags, review state)
  config.toml       Configuration
  agent-feed.pid    PID file while running
  agent-feed.log    Log file (always written)
```

Raw responses are stored in full for later use in evals. No automatic retention limit — manage storage manually. Current db size is shown at startup.

API keys are never written to disk. Authorization headers are scrubbed from all stored request data before persistence. OTel records additionally have `user.email`, `user.id`, `user.account_uuid`, `organization.id`, and `installation.id` removed at parse time, with email-shaped strings inside JSON body attributes redacted to `[EMAIL]`.
