export const AGENTS = {
  CLAUDE: 'claude-code',
  CODEX: 'codex',
  GEMINI: 'gemini',
  UNKNOWN: 'unknown',
};

const claudeAdapter = {
  name: AGENTS.CLAUDE,

  extractSessionId(body) {
    try {
      const parsed = JSON.parse(body);
      return parsed.id ?? null;
    } catch {
      return null;
    }
  },

  extractContent(body) {
    try {
      const parsed = JSON.parse(body);
      const parts = parsed.content ?? [];
      return parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join('\n') || null;
    } catch {
      return null;
    }
  },

  extractModel(body) {
    try {
      return JSON.parse(body).model ?? null;
    } catch {
      return null;
    }
  },

  extractTokenCount(body) {
    try {
      const parsed = JSON.parse(body);
      const usage = parsed.usage ?? {};
      return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || null;
    } catch {
      return null;
    }
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

  extractSessionId(_body, context = {}) {
    return context.proxySessionId ?? null;
  },

  extractContent(body) {
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
    try {
      return JSON.parse(body).modelVersion ?? null;
    } catch {
      return null;
    }
  },

  extractTokenCount(body) {
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
};

export function getAdapter(host) {
  return HOST_MAP[host] ?? unknownAdapter;
}
