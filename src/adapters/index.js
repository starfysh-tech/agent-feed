export const AGENTS = {
  CLAUDE: 'claude-code',
  CODEX: 'codex',
  GEMINI: 'gemini',
  UNKNOWN: 'unknown',
};

function parseSSEEvents(body) {
  const events = [];
  for (const block of body.split('\n\n')) {
    const dataLine = block.split('\n').find(l => l.startsWith('data: '));
    if (!dataLine) continue;
    try { events.push(JSON.parse(dataLine.slice(6))); } catch { /* skip malformed */ }
  }
  return events;
}

function isSSE(body) {
  return body.startsWith('event:') || body.startsWith('data:');
}

function extractClaudeSessionFromRequest(rawRequest) {
  if (!rawRequest) return null;
  try {
    const parsed = JSON.parse(rawRequest);
    const userIdStr = parsed?.metadata?.user_id;
    if (!userIdStr) return null;
    return JSON.parse(userIdStr)?.session_id ?? null;
  } catch {
    return null;
  }
}

const claudeAdapter = {
  name: AGENTS.CLAUDE,

  extractSessionId(body, context = {}) {
    const fromRequest = extractClaudeSessionFromRequest(context.rawRequest);
    if (fromRequest) return fromRequest;

    // Fall back to response message ID
    try { return JSON.parse(body).id ?? null; } catch {}
    if (!isSSE(body)) return null;
    const events = parseSSEEvents(body);
    const start = events.find(e => e.type === 'message_start');
    return start?.message?.id ?? null;
  },

  extractContent(body) {
    try {
      const parsed = JSON.parse(body);
      const parts = parsed.content ?? [];
      return parts.filter(p => p.type === 'text').map(p => p.text).join('\n') || null;
    } catch {}
    if (!isSSE(body)) return null;
    const events = parseSSEEvents(body);
    const textChunks = [];
    for (const e of events) {
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        textChunks.push(e.delta.text);
      }
    }
    return textChunks.join('') || null;
  },

  extractModel(body) {
    try { return JSON.parse(body).model ?? null; } catch {}
    if (!isSSE(body)) return null;
    const events = parseSSEEvents(body);
    const start = events.find(e => e.type === 'message_start');
    return start?.message?.model ?? null;
  },

  extractTokenCount(body) {
    try {
      const parsed = JSON.parse(body);
      const usage = parsed.usage ?? {};
      return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || null;
    } catch {}
    if (!isSSE(body)) return null;
    const events = parseSSEEvents(body);
    const start = events.find(e => e.type === 'message_start');
    const delta = events.find(e => e.type === 'message_delta');
    const inputTokens = start?.message?.usage?.input_tokens ?? 0;
    const outputTokens = delta?.usage?.output_tokens ?? 0;
    return (inputTokens + outputTokens) || null;
  },
};

const codexAdapter = {
  name: AGENTS.CODEX,

  extractSessionId(body, context = {}) {
    const lines = body.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && event.thread_id) {
          return event.thread_id;
        }
      } catch {
        continue;
      }
    }
    return context.requestHash ?? null;
  },

  extractContent(body) {
    const lines = body.split('\n').filter(Boolean);
    const messages = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (
          event.type === 'item.completed' &&
          event.item?.type === 'agent_message' &&
          event.item?.text
        ) {
          messages.push(event.item.text);
        }
      } catch {
        continue;
      }
    }
    return messages.join('\n') || null;
  },

  extractModel(body) {
    const lines = body.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.model) return event.model;
      } catch {
        continue;
      }
    }
    return null;
  },

  extractTokenCount(body) {
    const lines = body.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'turn.completed' && event.usage) {
          const u = event.usage;
          return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) || null;
        }
      } catch {
        continue;
      }
    }
    return null;
  },
};

const geminiAdapter = {
  name: AGENTS.GEMINI,

  extractSessionId(body, context = {}) {
    // SSE stream (Code Assist format) — extract responseId
    if (isSSE(body)) {
      const events = parseSSEEvents(body);
      for (const e of events) {
        if (e.response?.responseId) return e.response.responseId;
      }
    }
    // Plain JSON (public Gemini API)
    try {
      const parsed = JSON.parse(body);
      if (parsed.responseId) return parsed.responseId;
      // Skip admin/quota responses that have no content (loadCodeAssist, retrieveUserQuota, etc.)
      if (parsed.candidates) return context.proxySessionId ?? null;
    } catch {}
    // No identifiable content — return null to skip capture
    return null;
  },

  extractContent(body) {
    // SSE format (Code Assist): data: {"response": {"candidates": [...]}}
    if (isSSE(body)) {
      const events = parseSSEEvents(body);
      const textParts = [];
      for (const e of events) {
        const parts = e.response?.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) {
          if (p.text && !p.thought) textParts.push(p.text);
        }
      }
      return textParts.join('') || null;
    }
    // Plain JSON (public Gemini API)
    try {
      const parsed = JSON.parse(body);
      const candidates = parsed.candidates ?? [];
      if (!candidates.length) return null;
      const parts = candidates[0]?.content?.parts ?? [];
      return parts.map(p => p.text ?? '').join('\n') || null;
    } catch {
      return null;
    }
  },

  extractModel(body) {
    if (isSSE(body)) {
      const events = parseSSEEvents(body);
      for (const e of events) {
        if (e.response?.modelVersion) return e.response.modelVersion;
      }
      return null;
    }
    try {
      return JSON.parse(body).modelVersion ?? null;
    } catch {
      return null;
    }
  },

  extractTokenCount(body) {
    if (isSSE(body)) {
      const events = parseSSEEvents(body);
      // Last event typically has full usage metadata
      for (let i = events.length - 1; i >= 0; i--) {
        const meta = events[i].response?.usageMetadata;
        if (meta?.totalTokenCount) return meta.totalTokenCount;
        if (meta?.promptTokenCount) {
          return (meta.promptTokenCount ?? 0) + (meta.candidatesTokenCount ?? 0);
        }
      }
      return null;
    }
    try {
      const parsed = JSON.parse(body);
      const meta = parsed.usageMetadata ?? {};
      return (meta.promptTokenCount ?? 0) + (meta.candidatesTokenCount ?? 0) || null;
    } catch {
      return null;
    }
  },
};

const unknownAdapter = {
  name: AGENTS.UNKNOWN,
  extractSessionId: () => null,
  extractContent: () => null,
  extractModel: () => null,
  extractTokenCount: () => null,
};

const HOST_MAP = {
  'api.anthropic.com': claudeAdapter,
  'api.openai.com': codexAdapter,
  'generativelanguage.googleapis.com': geminiAdapter,
  'cloudcode-pa.googleapis.com': geminiAdapter,
};

export function getAdapter(host) {
  return HOST_MAP[host] ?? unknownAdapter;
}
