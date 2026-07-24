import { createAdapter } from './factory.js';

export const opencodeAdapter = createAdapter({
  vendor: 'opencode',
  prefixes: 'opencode.',
  kindMap: {
    'opencode.session.created':         'session_created',
    'opencode.plugin.started':          'plugin_started',
    'opencode.user_prompt':             'user_prompt',
    'opencode.tool_decision':           'tool_decision',
    'opencode.tool_result':             'tool_result',
    'opencode.api_request':             'api_request',
    'opencode.api_request_body':        'api_request_body',
    'opencode.api_response_body':       'api_response_body',
    'opencode.api_error':               'api_error',
    'opencode.api_retries_exhausted':   'api_retries_exhausted',
    'opencode.hook_execution_start':    'hook',
    'opencode.hook_execution_complete': 'hook',
    'opencode.mcp_server_connection':   'mcp',
    'opencode.permission_mode_changed': 'mode_change',
    'opencode.auth':                    'auth',
    'opencode.skill_activated':         'skill',
    'opencode.plugin_installed':        'plugin',
    'opencode.at_mention':              'mention',
    'opencode.internal_error':          'internal_error',
  },
  attrKeys: {
    sessionId: 'session.id',
    promptId:  'prompt.id',
    requestId: 'request_id',
    sequence:  'event.sequence',
  },
});
