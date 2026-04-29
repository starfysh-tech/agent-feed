// Claude Code OTel adapter — `claude_code.*` events.
// Validated against /tmp/otel-capture/events2.ndjson (72 real events).

import { createAdapter } from './factory.js';

export const claudeAdapter = createAdapter({
  vendor: 'claude',
  prefixes: 'claude_code.',
  kindMap: {
    'claude_code.user_prompt':             'user_prompt',
    'claude_code.tool_decision':           'tool_decision',
    'claude_code.tool_result':             'tool_result',
    'claude_code.api_request':             'api_request',
    'claude_code.api_request_body':        'api_request_body',
    'claude_code.api_response_body':       'api_response_body',
    'claude_code.api_error':               'api_error',
    'claude_code.api_retries_exhausted':   'api_retries_exhausted',
    'claude_code.hook_execution_start':    'hook',
    'claude_code.hook_execution_complete': 'hook',
    'claude_code.mcp_server_connection':   'mcp',
    'claude_code.permission_mode_changed': 'mode_change',
    'claude_code.auth':                    'auth',
    'claude_code.skill_activated':         'skill',
    'claude_code.plugin_installed':        'plugin',
    'claude_code.at_mention':              'mention',
    'claude_code.internal_error':          'internal_error',
  },
  attrKeys: {
    sessionId: 'session.id',
    promptId:  'prompt.id',
    requestId: 'request_id',
    sequence:  'event.sequence',
  },
});
