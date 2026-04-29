# Supported Agents

Agent Feed has two ingestion paths that run in parallel:

1. **Proxy** (always on, port 18080) — captures full request/response bodies via a transparent HTTP proxy. Canonical for body content; never truncates.
2. **OTel receiver** (port 4318, on by default) — ingests native OpenTelemetry from agents that emit it (Claude Code, Gemini CLI, Codex CLI). Adds visibility for tool decisions, hooks, MCP server lifecycle, and other signals the proxy can't see.

When both capture the same turn, the UI coalesces by `request_id` and prefers the proxy body (untruncated) plus OTel cost/token metadata.

| Agent | Session ID source | Proxy URL env var | OTel emission |
|---|---|---|---|
| Claude Code | `metadata.user_id.session_id` (proxy) or `session.id` attribute (OTel) | `ANTHROPIC_BASE_URL=http://localhost:18080` | Native — enable with `CLAUDE_CODE_ENABLE_TELEMETRY=1` (full event set, see below) |
| Codex CLI | `thread_id` from `thread.started` JSONL (proxy) | `OPENAI_BASE_URL=http://localhost:18080/v1` | Partial — paste TOML into `~/.codex/config.toml`. `codex mcp-server` emits no telemetry; WebSocket transport observability undocumented. **Proxy stays canonical for Codex.** |
| Gemini CLI | OTel `session.id` (preferred when available) or proxy-generated | `GOOGLE_API_BASE_URL=http://localhost:18080` | Native — enable with `GEMINI_TELEMETRY_ENABLED=true`. Richest event surface; native `process.cwd` resource attribute. |

## OTel enablement

Run `agent-feed env` to print the export block (Claude + Gemini env vars + Codex TOML hint). Source it in your shell, then start the agent.

OTel events stored:

- `user_prompt`, `tool_decision`, `tool_result` — what the agent ran and what was approved
- `hook` — pre/post tool-use hook executions, blocking/cancelled counts
- `mcp` — MCP server connect/fail/disconnect lifecycle with transport, scope, error codes
- `api_request_body` / `api_response_body` — full Anthropic/Gemini bodies (subject to vendor truncation)
- `skill`, `plugin`, `mention`, `auth`, `mode_change` — additional Claude signals when emitted

PII (`user.email`, `user.id`, `user.account_uuid`, `organization.id`, `installation.id`) is scrubbed at parse time; nested email addresses inside JSON bodies are redacted to `[EMAIL]`.

## Adding a new agent (proxy path)

Create an adapter object in `src/adapters/index.js` with four methods:

- `extractSessionId(responseBody, context)` — return a stable session identifier
- `extractContent(responseBody)` — return the readable text from the response
- `extractModel(responseBody)` — return the model name
- `extractTokenCount(responseBody)` — return total tokens used

Add the adapter to `HOST_MAP` keyed by the API hostname.

## Adding a new agent (OTel path)

Create an adapter file in `src/otel/adapters/<vendor>.js` exporting an object:

```js
export const myAdapter = {
  vendor: 'myagent',
  matches(name) { return name?.startsWith('myagent.'); },
  kindFor(name) { /* map vendor event names to canonical event_kind */ },
  extract(record) { /* return { vendor, kind, name, time, sessionId, promptId, requestId, sequence, attrs, resource } */ },
};
```

Register it in `src/otel/adapters/index.js` `ADAPTERS` array.

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
