// Gemini CLI OTel adapter — `gemini_cli.*` and OTel semantic `gen_ai.*` events.
// Validated against /tmp/otel-capture/events-gemini.ndjson (44 real events).
// `gen_ai.response.id` plays the role of request_id.

import { createAdapter } from './factory.js';

export const geminiAdapter = createAdapter({
  vendor: 'gemini',
  prefixes: ['gemini_cli.', 'gen_ai.'],
  kindMap: {
    'gemini_cli.user_prompt':                    'user_prompt',
    'gemini_cli.api_request':                    'api_request',
    'gemini_cli.api_response':                   'api_response_body',
    'gemini_cli.api_error':                      'api_error',
    'gemini_cli.tool_call':                      'tool_decision',
    'gemini_cli.tool_output_truncated':          'tool_result',
    'gemini_cli.config':                         'config',
    'gemini_cli.startup_stats':                  'startup',
    'gemini_cli.model_routing':                  'model_routing',
    'gemini_cli.keychain.availability':          'auth',
    'gemini_cli.token_storage.initialization':   'auth',
    'gemini_cli.plan.approval_mode_duration':    'mode_change',
    'gemini_cli.agent.start':                    'agent_start',
    'gemini_cli.agent.finish':                   'agent_finish',
    'gen_ai.client.inference.operation.details': 'api_response_body',
  },
  attrKeys: {
    sessionId: 'session.id',
    promptId:  'prompt_id',
    requestId: 'gen_ai.response.id',
    // Gemini does not emit event.sequence; sink relies on time order
    sequence:  null,
  },
});
