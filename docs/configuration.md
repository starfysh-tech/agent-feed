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
```

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

API keys are never written to disk. Authorization headers are scrubbed from all stored request data before persistence.
