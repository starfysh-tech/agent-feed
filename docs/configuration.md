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
