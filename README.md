# Agent Feed

A transparent proxy that captures coding agent responses and documents decisions, assumptions, and architectural choices for review and trend analysis.

## Overview

Agent Feed sits invisibly between your coding agents (Claude Code, Codex, Gemini) and their APIs, capturing responses and extracting structured insights into a local SQLite database with a web UI for session review.

## Quick Start

```bash
# Configure your shell
export ANTHROPIC_BASE_URL=http://localhost:8080
export OPENAI_BASE_URL=http://localhost:8080

# Start
agent-feed start

# Stop
agent-feed stop

# Diagnostics
agent-feed start --verbose

# Evals
agent-feed eval classifier
```

## Configuration

Config lives at `~/.agent-feed/config.toml`:

```toml
[proxy]
port = 8080

[ui]
port = 3000

[classifier]
provider = "anthropic" # anthropic | ollama | lmstudio
model = "claude-haiku-4-5-20251001"
base_url = "" # required for ollama/lmstudio

[storage]
path = "~/.agent-feed/feed.db"
```

## Data

All data lives at `~/.agent-feed/`:
- `feed.db` — SQLite database
- `agent-feed.pid` — PID file
- `agent-feed.log` — log file
- `config.toml` — configuration

