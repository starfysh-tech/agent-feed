# Agent Feed

A transparent proxy that captures coding agent responses and extracts decisions, assumptions, and architectural choices into a reviewable log.

## What it does

Agent Feed sits invisibly between your coding agents and their APIs. Every response is captured, classified by a secondary LLM call, and stored locally. After a session, you open a web UI to review what was decided, assumed, or introduced -- and mark anything that needs to change.

It works with Claude Code, Codex, and Gemini. Agents are unaware of it.

## How it works

```
Agent → ANTHROPIC_BASE_URL → Proxy → api.anthropic.com
                                ↓
                           Classifier (Haiku / local model)
                                ↓
                           SQLite (~/.agent-feed/feed.db)
                                ↓
                           Web UI (localhost:3000)
```

The proxy forwards every request untouched and captures the response. After the response completes, a classifier extracts structured flag entries. Nothing blocks the agent.

## Requirements

- Node.js >= 20
- An Anthropic API key (or a running Ollama / LM Studio instance)

## Installation

```bash
git clone <repo>
cd agent-feed
npm install
```

## Quick start

```bash
# Point your agents at the proxy
export ANTHROPIC_BASE_URL=http://localhost:8080
export OPENAI_BASE_URL=http://localhost:8080

# Start everything
node src/cli/index.js start

# Open the UI
open http://localhost:3000

# Stop when done
node src/cli/index.js stop
```

Add the `export` lines to your shell profile so agents always route through the proxy.

## CLI

```
node src/cli/index.js start                 Start proxy, classifier, and UI in background
node src/cli/index.js start --verbose       Start in foreground with diagnostic logging
node src/cli/index.js stop                  Stop all services
node src/cli/index.js eval classifier       Run classifier precision/recall eval
```

Startup output confirms all services are healthy before detaching:

```
Starting Agent Feed...
  ✓ Proxy listening on :8080
  ✓ Classifier ready (anthropic/claude-haiku-4-5-20251001)
  ✓ Web UI available at http://localhost:3000
  ✓ SQLite initialized at ~/.agent-feed/feed.db (1.2 MB)
Agent Feed ready.
```

If any service fails to start, the process exits cleanly with an error. Nothing runs in a partial state.

## Configuration

Config lives at `~/.agent-feed/config.toml`. Created with defaults on first run.

```toml
[proxy]
port = 8080

[ui]
port = 3000

[classifier]
provider = "anthropic"            # anthropic | ollama | lmstudio
model = "claude-haiku-4-5-20251001"
base_url = ""                     # required for ollama / lmstudio

[storage]
path = "~/.agent-feed/feed.db"
```

### Using a local model

```toml
[classifier]
provider = "ollama"
model = "llama3.1"
base_url = "http://localhost:11434"
```

Both Ollama and LM Studio expose an OpenAI-compatible API. The classifier prompt and parsing work the same regardless of provider. The startup check validates the local server is reachable before launching.

## Flag types

The classifier extracts the following types from every response:

| Type | What it captures |
|---|---|
| `decision` | A choice the agent made between alternatives |
| `assumption` | Something assumed true without verification |
| `architecture` | A structural or design choice about the system |
| `pattern` | A design pattern or convention applied |
| `dependency` | A library, service, or external system introduced |
| `tradeoff` | An explicit A-over-B choice with reasoning |
| `constraint` | A hard limit shaping the approach |
| `workaround` | A temporary or non-ideal solution knowingly applied |
| `risk` | Something flagged as potentially problematic |

## Session review

The web UI is built for post-session review. Open it after a long automated run and work through flagged items chronologically.

Each flag shows:
- Type and confidence score
- Extracted content
- Accept / Needs Change / False Positive status buttons
- Reviewer note field
- Outcome field
- Toggle to view the full raw response

Progress is tracked per session so you can see at a glance how much is left to review.

## Trends

The Trends tab shows flag patterns across sessions:
- Total flag count with agent, repo, branch, and date filters
- Flag breakdown by type with bar chart and false positive rates
- Per-session flag volume with drilldown links

Use this to spot patterns like a prompt consistently producing workaround flags, or assumption rates rising after a system prompt change.

## Classifier eval

Once you have reviewed enough flags, measure classifier quality:

```bash
node src/cli/index.js eval classifier
```

Output:

```
Classifier Eval -- 2026-03-28
Labeled samples: 87 flags across 12 sessions

Overall:    precision 0.81  recall 0.74  F1 0.77
By type:
  decision       P 0.89  R 0.82  F1 0.85  (24 samples)
  assumption     P 0.76  R 0.71  F1 0.73  (18 samples)
  workaround     P 0.65  R 0.58  F1 0.61  (9 samples)
  ...

Types below minimum sample threshold: constraint, tradeoff
```

The eval re-runs the classifier against every reviewed flag's raw response and compares output against your review decisions. `accepted` and `needs_change` flags are true positives. `false_positive` flags are true negatives.

## Data

Everything lives at `~/.agent-feed/`:

```
~/.agent-feed/
  feed.db           SQLite database (records, flags, review state)
  config.toml       Configuration
  agent-feed.pid    PID file while running
  agent-feed.log    Log file (always written)
```

Raw responses are stored in full for later use in evals. No automatic retention limit -- manage storage manually. Current db size is shown at startup.

API keys are never written to disk. Authorization headers are scrubbed from all stored request data before any persistence step.

## Supported agents

| Agent | Session ID source | Base URL env var |
|---|---|---|
| Claude Code | `id` field in response body | `ANTHROPIC_BASE_URL` |
| Codex | `thread_id` from `thread.started` JSONL event | `OPENAI_BASE_URL` |
| Gemini | Proxy-generated per connection | `GOOGLE_API_BASE_URL` (if supported) |

Adding a new agent requires a small adapter in `src/adapters/index.js` with two methods: `extractSessionId` and `extractContent`.

## Project structure

```
src/
  adapters/       Per-agent session ID and content extraction
  classifier/     LLM classification prompt and provider adapters
  cli/            start / stop / eval commands
  proxy/          Transparent HTTP proxy with capture callback
  storage/        SQLite database with full schema
  ui/             HTTP server with REST API and HTML interface
  app.js          Wires all components together
  config.js       TOML config loader with defaults
  eval.js         Classifier precision/recall eval runner
  git.js          Git context collector (branch, commit, repo)
  pipeline.js     Capture → adapter → classifier → db write
test/
  *.test.js       65 tests covering all modules
```

## Backlog

- Content-level flag clustering using embedding similarity
- Additional config knobs (log level, classifier timeout, confidence threshold)
- Export tooling (CSV, JSON)
