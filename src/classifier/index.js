export const CLASSIFICATION_PROMPT = `You are analyzing a response from a coding agent.
Your job is to extract structured information about decisions, assumptions, and other notable items.

Return ONLY a JSON object with no preamble, explanation, or markdown formatting. No backticks.

The JSON must have this exact shape:
{
  "response_summary": "2-3 sentence summary of what the agent did or said",
  "flags": [
    {
      "type": "one of the types listed below",
      "content": "specific item that was decided, assumed, introduced, etc.",
      "confidence": 0.0 to 1.0
    }
  ]
}

Flag types (use exactly these strings):
- decision: a choice the agent made between alternatives
- assumption: something the agent assumed to be true without verifying
- architecture: a structural or design choice about the system
- pattern: a design pattern or coding convention the agent applied
- dependency: a library, service, or external system the agent introduced
- tradeoff: an explicit acknowledgment that option A was chosen over option B
- constraint: a hard limit the agent identified as shaping the approach
- workaround: a temporary or non-ideal solution the agent knowingly applied
- risk: something the agent flagged as potentially problematic

Extract every qualifying flag you find. Include all flags with confidence >= 0.7.
If there are no qualifying flags, return an empty array.`;

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function buildAnthropicBody(model, content) {
  return {
    model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: `${CLASSIFICATION_PROMPT}\n\nAgent response to analyze:\n\n${content}` }],
  };
}

function buildOpenAICompatibleBody(model, content) {
  return {
    model,
    max_tokens: 1000,
    messages: [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      { role: 'user', content: `Agent response to analyze:\n\n${content}` },
    ],
  };
}

function parseClassifierResponse(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      response_summary: parsed.response_summary ?? '',
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch {
    return { response_summary: '', flags: [] };
  }
}

export function buildClassifier(config, fetchFn = fetch) {
  const { provider, model, base_url } = config;

  return async function classify(content) {
    let url;
    let body;
    const headers = { 'Content-Type': 'application/json' };

    if (provider === 'anthropic') {
      url = ANTHROPIC_API_URL;
      body = buildAnthropicBody(model, content);
      // API key injected by environment at runtime
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      // ollama and lmstudio both expose OpenAI-compatible /v1/chat/completions
      url = `${base_url}/v1/chat/completions`;
      body = buildOpenAICompatibleBody(model, content);
    }

    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { response_summary: '', flags: [] };
    }

    const data = await response.json();

    // Handle both Anthropic and OpenAI response shapes
    let text = '';
    if (provider === 'anthropic') {
      text = data.content?.find(b => b.type === 'text')?.text ?? '';
    } else {
      text = data.choices?.[0]?.message?.content ?? '';
    }

    return parseClassifierResponse(text);
  };
}

const FALLBACK_PROVIDERS = [
  { provider: 'ollama',    base_url: 'http://localhost:11434', model: 'llama3.1' },
  { provider: 'lmstudio', base_url: 'http://localhost:1234',  model: 'local-model' },
];

export async function validateClassifierWithFallback(config, fetchFn = fetch) {
  const tried = [];

  // 1. Try configured provider first
  const primary = await validateClassifier(config, fetchFn);
  if (primary.ok) {
    return { ...primary, provider: config.provider, base_url: config.base_url, effectiveConfig: config };
  }
  tried.push({ provider: config.provider, reason: primary.reason });

  // 2. Try local fallbacks (skip if configured provider is already that local provider)
  for (const fallback of FALLBACK_PROVIDERS) {
    if (fallback.provider === config.provider) continue;
    const result = await validateClassifier(fallback, fetchFn);
    if (result.ok) {
      const effectiveConfig = { ...config, ...fallback };
      return {
        ok: true,
        label: result.label,
        provider: fallback.provider,
        base_url: fallback.base_url,
        effectiveConfig,
      };
    }
    tried.push({ provider: fallback.provider, reason: result.reason });
  }

  // 3. Try Anthropic API key directly (covers SSO-adjacent setups with a separate classifier key)
  if (config.provider !== 'anthropic') {
    const anthropicConfig = {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      base_url: '',
    };
    const result = await validateClassifier(anthropicConfig, fetchFn);
    if (result.ok) {
      return {
        ok: true,
        label: result.label,
        provider: 'anthropic',
        base_url: '',
        effectiveConfig: anthropicConfig,
      };
    }
    tried.push({ provider: 'anthropic', reason: result.reason });
  }

  // All failed
  const summary = tried.map(t => `${t.provider}: ${t.reason}`).join('; ');
  return {
    ok: false,
    reason: `No classifier available. Tried: ${summary}`,
  };
}


export async function validateClassifier(config, fetchFn = fetch) {
  const { provider, model, base_url } = config;

  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false, reason: 'ANTHROPIC_API_KEY environment variable not set' };
    }
    return { ok: true, label: `anthropic/${model}` };
  }

  // For local providers, ping the models endpoint
  try {
    const url = provider === 'ollama'
      ? `${base_url}/api/tags`
      : `${base_url}/v1/models`;

    const res = await fetchFn(url);
    if (!res.ok) {
      return { ok: false, reason: `${provider} returned status ${res.status}` };
    }
    return { ok: true, label: `${provider}/${model} at ${base_url}` };
  } catch (err) {
    return { ok: false, reason: `${provider} unreachable at ${base_url}: ${err.message}` };
  }
}
