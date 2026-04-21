# Supported Agents

| Agent | Session ID source | Base URL env var |
|---|---|---|
| Claude Code | `metadata.user_id.session_id` from request (fallback: response message ID) | `ANTHROPIC_BASE_URL=http://localhost:18080` |
| Codex | `thread_id` from `thread.started` JSONL event | `OPENAI_BASE_URL=http://localhost:18080/v1` |
| Gemini | Proxy-generated per connection | `GOOGLE_API_BASE_URL=http://localhost:18080` |

## Adding a new agent

Create an adapter object in `src/adapters/index.js` with four methods:

- `extractSessionId(responseBody, context)` — return a stable session identifier
- `extractContent(responseBody)` — return the readable text from the response
- `extractModel(responseBody)` — return the model name
- `extractTokenCount(responseBody)` — return total tokens used

Add the adapter to `HOST_MAP` keyed by the API hostname.

## Flag types

The classifier extracts these types from every response:

| Type | What it captures |
|---|---|
| `decision` | A choice between alternatives |
| `assumption` | Something assumed true without verification |
| `architecture` | A structural or design choice |
| `pattern` | A design pattern or convention applied |
| `dependency` | A library, service, or external system introduced |
| `tradeoff` | An explicit A-over-B choice with reasoning |
| `constraint` | A hard limit shaping the approach |
| `workaround` | A temporary or non-ideal solution knowingly applied |
| `risk` | Something flagged as potentially problematic |
