// Codex CLI OTel adapter — `codex.*` events.
// NOT live-validated. Mapping derived from
// developers.openai.com/codex/config-advanced.
// `codex mcp-server` mode emits zero telemetry; WebSocket transport
// observability is undocumented. Treat coverage as opportunistic.

import { createAdapter } from './factory.js';

export const codexAdapter = createAdapter({
  vendor: 'codex',
  prefixes: 'codex.',
  kindMap: {
    'codex.conversation_starts': 'session_start',
    'codex.user_prompt':         'user_prompt',
    'codex.api_request':         'api_request',
    'codex.sse_event':           'api_response_body',
    'codex.websocket_event':     'api_response_body',
    'codex.tool_decision':       'tool_decision',
    'codex.tool_result':         'tool_result',
  },
  attrKeys: {
    // `conversation.id` is the canonical correlation id per Codex docs;
    // session.id / session_id appear on some events as well.
    sessionId: ['conversation.id', 'session.id', 'session_id'],
    promptId:  'prompt_id',
    requestId: 'request_id',
    sequence:  null,
  },
});
