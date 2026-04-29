// PII scrubbing for OTel events.
//
// Removes attribute keys that vendors are known to include with personal data,
// and recursively redacts email-shaped strings inside JSON-string body attributes
// (e.g. claude's api_request_body / api_response_body, gemini's gen_ai.input.messages).

const PII_ATTR_KEYS = new Set([
  'user.email',
  'user.id',
  'user.account_uuid',
  'user.account_id',
  'organization.id',
  'installation.id',
]);

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// scrubString handles every string value: it tries JSON parse first
// (which catches the body / gen_ai.*_messages / system_instructions cases
// where embedded user text may contain emails) and falls back to a plain
// regex replace for non-JSON strings.
export function scrubAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return attrs;
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (PII_ATTR_KEYS.has(k)) continue;
    if (typeof v === 'string') {
      out[k] = scrubString(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrubAttrs(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Replace email addresses with [EMAIL]. Operates on a string; if the string is
// JSON, parses + recurses + re-stringifies; otherwise simple regex replace.
//
// Fast path: if there's no '@' anywhere in the string, no email exists and the
// JSON walk would only consume CPU. This skips the parse+walk+stringify
// roundtrip on typical Claude api_response_body payloads (~250KB JSON with
// no embedded emails) — measured ~5-20× speedup on email-free bodies.
export function scrubString(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  if (!s.includes('@')) return s;
  const first = s[0];
  if (first === '{' || first === '[') {
    try {
      const parsed = JSON.parse(s);
      return JSON.stringify(scrubJsonValue(parsed));
    } catch {
      // not actually JSON, fall through
    }
  }
  return s.replace(EMAIL_RE, '[EMAIL]');
}

function scrubJsonValue(v) {
  if (v == null) return v;
  if (typeof v === 'string') return v.replace(EMAIL_RE, '[EMAIL]');
  if (Array.isArray(v)) return v.map(scrubJsonValue);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (PII_ATTR_KEYS.has(k)) continue;
      out[k] = scrubJsonValue(val);
    }
    return out;
  }
  return v;
}

export const PII_KEYS_FOR_TEST = PII_ATTR_KEYS;
