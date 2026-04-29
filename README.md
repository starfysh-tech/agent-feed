# Agent Feed

A transparent proxy that captures coding agent responses and extracts decisions, assumptions, and architectural choices into a reviewable log.

Works with Claude Code, Codex, and Gemini. Agents are unaware of it.

## How it works

```
Agent ─┬→ ANTHROPIC_BASE_URL=:18080  → Proxy   ─┐
       └→ OTEL_EXPORTER_OTLP_ENDPOINT=:4318 → OTLP Receiver ─┤
                                                              ├→ SQLite (~/.agent-feed/feed.db)
                                                Classifier  ─┘
                                                     ↓
                                                Web UI (localhost:3000)
```

Two parallel ingestion paths:
- **Proxy** (port 18080) captures full HTTP request/response bodies via header-based upstream routing. Canonical for body content.
- **OTLP receiver** (port 4318) ingests native OpenTelemetry from agents that emit it. Adds visibility for tool decisions, hooks, MCP server lifecycle, skill activation, and other events the proxy can't see.

When both capture the same turn, the UI coalesces by `request_id`. Neither blocks the agent.

## Quick start

```bash
git clone <repo>
cd agent-feed
npm install

# Start everything
agent-feed start

# Open the UI
open http://localhost:3000

# Stop when done
agent-feed stop
```

### Shell integration (recommended)

```bash
npm link
echo 'eval "$(agent-feed shell-init)"' >> ~/.zshrc
source ~/.zshrc
```

Automatically sets/clears env vars on start/stop. New tabs pick up the proxy if running.

## CLI

```
agent-feed start             Start proxy + classifier + UI (daemonizes)
agent-feed start --verbose   Foreground with logging
agent-feed stop              Stop all services
agent-feed restart            Stop and restart
agent-feed env               Output shell export/unset commands
agent-feed shell-init        Shell integration snippet for .zshrc
agent-feed eval classifier   Precision/recall report
agent-feed eval show         Show missed flags and false positives
```

## Session review

The web UI shows flagged items per session. Each flag includes:
- Type, confidence, and supporting context from the agent's response
- Accept / Needs Change / False Positive actions
- Reviewer note and outcome fields

Flags are sorted by actionability — low confidence items surface first. Reviewed items dim to keep focus on what's unreviewed.

## Frontend development

```bash
cd src/ui/frontend && npm install
npm run dev    # Vite dev server on :5173 (proxies /api to daemon on :3000)
npm run build  # Production build → dist/
```

## Docs

- [Configuration & data storage](docs/configuration.md)
- [Supported agents & flag types](docs/agents.md)
- [Classifier evals & improvement](docs/evals.md)

## Requirements

- Node.js >= 20
- An Anthropic API key (or Ollama / LM Studio)
