# Agent Feed

A transparent proxy that captures coding agent responses and extracts decisions, assumptions, and architectural choices into a reviewable log.

## What it does

Agent Feed sits invisibly between your coding agents and their APIs. Every response is captured, classified by a secondary LLM call, and stored locally. After a session, you open a web UI to review what was decided, assumed, or introduced -- and mark anything that needs to change.

It works with Claude Code, Codex, and Gemini. Agents are unaware of it.

## Use cases

**Post-session validation**
You run a long automated coding session -- feature build, refactor, bug triage. Before merging or reviewing output, open Agent Feed and scan what the agent decided. Catch choices that conflict with your architecture, dependencies you didn't intend to introduce, or assumptions that are wrong about your environment.

**Prompt and harness improvement**
Over time, patterns emerge. Your agent consistently applies a workaround pattern in auth flows. It makes assumptions about infrastructure that are often wrong. Assumptions cluster around a specific type of task. These patterns are invisible turn-by-turn but obvious in aggregate. Use the Trends view to identify them, then adjust your system prompt or harness to address the root cause.

**Junior and offshore developer oversight**
When staff-augmented developers use coding agents, you lose visibility into what the agent decided on their behalf. Agent Feed creates a reviewable audit trail without requiring developers to document anything themselves. You can spot drift from your standards before it reaches code review.

**Classifier quality feedback loop**
The eval command measures how well the classifier extracts flags from raw responses. As you review flags and mark false positives, the ground truth set grows. Run `eval classifier` periodically to track whether classifier quality is improving or degrading across prompt iterations.

**Pre-merge decision audit**
Before a PR review, pull up the session that produced the branch and scan flagged decisions. Reviewers can focus on code quality knowing the architectural decisions have already been surfaced and evaluated separately.

## How it works

```
Agent → ANTHROPIC_BASE_URL=http://localhost:18080 → Proxy → api.anthropic.com
                                                     ↓
                                                Classifier (Haiku / local model)
                                                     ↓
                                                SQLite (~/.agent-feed/feed.db)
                                                     ↓
                                                Web UI (localhost:3000)
```

The proxy uses header-based routing to determine the upstream target. Requests with an `anthropic-version` header go to `api.anthropic.com`. Requests with `x-goog-api-key` or `x-goog-api-client` go to Google. All other requests fall back to OpenAI. Paths pass through unchanged -- the proxy never rewrites URLs. Responses are captured asynchronously and classified. Nothing blocks the agent.

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
# Start everything (daemonizes by default)
agent-feed start

# Open the UI
open http://localhost:3000

# Stop when done
agent-feed stop
```

### Shell integration (recommended)

Set up automatic env var management so agents route through the proxy whenever it's running:

```bash
# One-time setup
npm link
echo 'eval "$(agent-feed shell-init)"' >> ~/.zshrc
source ~/.zshrc
```

After this, `agent-feed start` automatically sets the env vars and `agent-feed stop` clears them. New terminal tabs pick up the vars if the proxy is running. If the proxy crashes, new shells auto-detect the dead PID and clean up.

### Manual setup

If you prefer not to use the shell integration:

```bash
export ANTHROPIC_BASE_URL=http://localhost:18080
export OPENAI_BASE_URL=http://localhost:18080/v1
export GOOGLE_API_BASE_URL=http://localhost:18080
export GOOGLE_GEMINI_BASE_URL=http://localhost:18080
export CODE_ASSIST_ENDPOINT=http://localhost:18080
```

## CLI

```
agent-feed start                 Start proxy, classifier, and UI (daemonizes)
agent-feed start --verbose       Start in foreground with diagnostic logging
agent-feed stop                  Stop all services
agent-feed restart               Stop and restart all services
agent-feed env                   Output shell export/unset commands based on proxy state
agent-feed shell-init            Output shell integration snippet for ~/.zshrc
agent-feed eval classifier       Precision/recall report across labeled flags
agent-feed eval show             Show missed flags and false positives
```

Startup output confirms all services are healthy before detaching:

```
Starting Agent Feed...
  ✓ Proxy listening on :18080
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
port = 18080

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

The web UI is a React SPA. Open it after a long automated run and work through flagged items chronologically.

Each flag shows:
- Type and confidence score
- Extracted content
- Supporting context (the passage from the agent response that supports the flag)
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

## Evals

Agent Feed has two kinds of evals: **classifier quality** (is the LLM correctly extracting flags?) and **agent/prompt quality** (are your prompts producing better decisions over time?). The first is measured with CLI commands. The second is visible in the Trends view.

### Building a ground truth set

The ground truth set is built passively as you review sessions. Every flag you mark `accepted`, `needs_change`, or `false_positive` in the UI becomes a labeled sample. You do not need a separate labeling step.

To build a useful ground truth set:

1. Run a few agent sessions covering different task types (auth, data modeling, API design, refactoring)
2. Open the UI and work through the session detail view, marking each flag
3. Use `accepted` or `needs_change` for flags that are real -- the classifier should have found them
4. Use `false_positive` for flags the classifier extracted that are not meaningful

A minimum of 5 samples per flag type produces reliable per-type metrics. Types below that threshold are flagged in the report. Aim for 10+ per type before acting on the numbers.

### Measuring classifier quality

Once you have reviewed flags, run the eval:

```bash
agent-feed eval classifier
```

Output:

```
Classifier Eval -- 2026-03-28
Labeled samples: 87

Overall:    precision 0.81  recall 0.74  F1 0.77
By type:
  decision       P 0.89  R 0.82  F1 0.85  (24 samples)
  assumption     P 0.76  R 0.71  F1 0.73  (18 samples)
  workaround     P 0.65  R 0.58  F1 0.61  (9 samples)
  risk           P 0.70  R 0.60  F1 0.65  (7 samples)
  dependency     P 0.88  R 0.80  F1 0.84  (6 samples)
  architecture   P 0.91  R 0.85  F1 0.88  (5 samples)

Types below minimum sample threshold: constraint, tradeoff, pattern
```

**Reading the numbers:**

- **Precision** -- of the flags the classifier extracted, how many were real? Low precision means too much noise. Your review queue fills with things that aren't meaningful.
- **Recall** -- of the real flags in the responses, how many did the classifier find? Low recall means you're missing things. Important decisions slip through unlogged.
- **F1** -- harmonic mean of precision and recall. Use this as the single headline number when comparing across prompt iterations.

For a review tool, recall matters more than precision. A missed decision is worse than a false positive you can quickly dismiss.

### Finding what to fix

To see the specific flags behind the numbers:

```bash
agent-feed eval show
```

Output:

```
Labeled: 87  TP: 63  Missed: 14  FP: 10

── Missed flags (classifier should have found these) ────────────────
  [assumption] Assuming the database schema already exists
  Response: "I'll proceed with the migration assuming the schema is already in place..."

  [workaround] Using string concatenation instead of parameterized queries temporarily
  Response: "For now I'll use string concatenation -- we can switch to prepared statements..."

── False Positives (classifier flagged, reviewer rejected) ──────────
  [risk] Listed directory contents
  Response: "Here are the files in the src directory: index.js, config.js, utils.js..."
```

Use this output to diagnose the classifier prompt. Missed flags tell you what language patterns the classifier is not recognizing. False positives tell you what benign content it is over-indexing on.

### Improving the classifier prompt

The classifier prompt lives in `src/classifier/index.js` as `CLASSIFICATION_PROMPT`. Edit it directly based on what `eval show` surfaces.

Common patterns:

| Problem | Likely cause | Fix |
|---|---|---|
| Missing `assumption` flags | Prompt examples don't cover implicit assumptions | Add examples of passive phrasing like "assuming X is available" |
| False positives on file listings | Classifier over-triggers on list-like content | Add negative examples to the prompt |
| Missing `workaround` flags | Temporal language ("for now", "temporarily") not covered | Add examples with that phrasing |
| Low recall on `risk` | Risk language is subtle and varied | Add more examples of hedging language |

After editing the prompt, re-run `eval classifier` and compare F1 scores. Track changes in a comment above the prompt constant so you have a history of what improved what.

### Tracking agent/prompt quality over time

The Trends view shows flag patterns across sessions. Use the agent and date filters to compare behavior before and after a system prompt change.

What to look for:

- **Rising workaround rate** -- your prompt is not giving the agent enough context to solve problems correctly
- **High assumption rate on a specific task type** -- the agent lacks information it needs; add it to the system prompt
- **Decisions clustering around the same choice** -- the agent has a default it keeps reverting to; decide if that default is correct and either accept it or explicitly redirect it
- **False positive rate rising** -- the classifier prompt has drifted from your labeling behavior; run `eval classifier` and re-calibrate

### The improvement loop

```
Run session
    ↓
Review flags in UI  ←──────────────────────┐
    ↓                                       │
eval classifier  →  read scores             │
    ↓                                       │
eval show  →  find specific misses and FPs  │
    ↓                                       │
Edit CLASSIFICATION_PROMPT                  │
    ↓                                       │
eval classifier  →  confirm F1 improved ────┘
```

Run this loop periodically rather than after every session. Ten or more newly reviewed flags between runs gives the metrics enough signal to move meaningfully.

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
| Claude Code | `metadata.user_id.session_id` from request (falls back to response message ID) | `ANTHROPIC_BASE_URL=http://localhost:18080` |
| Codex | `thread_id` from `thread.started` JSONL event | `OPENAI_BASE_URL=http://localhost:18080/v1` |
| Gemini | Proxy-generated per connection | `GOOGLE_API_BASE_URL=http://localhost:18080` |

Adding a new agent requires a small adapter in `src/adapters/index.js` with two methods: `extractSessionId` and `extractContent`.

## Project structure

```
src/
  adapters/       Per-agent session ID and content extraction
  classifier/     LLM classification prompt and provider adapters
  cli/            start / stop / restart / eval commands
  proxy/          Header-based proxy with HTTPS forwarding and capture callback
  storage/        SQLite database with full schema
  ui/
    server.js     API-only HTTP server (~150 lines), serves Vite build output as static files
    frontend/     Vite + React 19 SPA (TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query)
  app.js          Wires all components together
  config.js       TOML config loader with defaults
  eval.js         Classifier precision/recall eval runner
  git.js          Git context collector (branch, commit, repo)
  pipeline.js     Capture → adapter → classifier → db write
test/
  *.test.js       Tests covering all modules
```

### Frontend development

The frontend is a separate Vite project with its own `package.json`:

```bash
cd src/ui/frontend && npm install   # install frontend deps
npm run dev:ui                       # Vite dev server on :5173 (proxies /api to :3000)
npm run build:ui                     # production build → src/ui/frontend/dist/
```

In dev mode, Vite proxies `/api` requests to the running daemon on port 3000, so you get HMR without restarting the daemon.

## Backlog

- Content-level flag clustering using embedding similarity
- Additional config knobs (log level, classifier timeout, confidence threshold)
- Export tooling (CSV, JSON)
