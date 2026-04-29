// OTLP envelope -> flat event objects.
//
// Input shape (OTLP/JSON):
//   {
//     resourceLogs: [{
//       resource: { attributes: KeyValue[] },
//       scopeLogs: [{ logRecords: [{ timeUnixNano, body, attributes: KeyValue[] }] }]
//     }]
//   }
// KeyValue = { key, value: { stringValue | intValue | doubleValue | boolValue | ... } }
//
// Output shape:
//   { kind: 'log'|'metric'|'trace', resource: {...}, records: [{ time, name, body, attrs }] }
//
// Coercion rules:
//   - intValue / stringValue / doubleValue / boolValue -> JS primitive
//   - missing or unrecognized value -> null (never NaN)
//   - repeated keys -> array (preserves both rather than overwriting)

function coerceValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue'    in v) {
    const s = v.intValue;
    if (typeof s === 'number') return s;
    if (typeof s === 'string') {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  if ('doubleValue' in v) {
    const n = Number(v.doubleValue);
    return Number.isFinite(n) ? n : null;
  }
  if ('boolValue'   in v) return Boolean(v.boolValue);
  if ('arrayValue'  in v) {
    return (v.arrayValue?.values ?? []).map(coerceValue);
  }
  if ('kvlistValue' in v) {
    return attrsToObject(v.kvlistValue?.values ?? []);
  }
  return null;
}

export function attrsToObject(arr) {
  const out = {};
  for (const a of arr ?? []) {
    if (!a?.key) continue;
    const v = coerceValue(a.value);
    if (a.key in out) {
      // Repeated key: convert to array, preserve all values. Push instead of
      // spread — O(N) instead of O(N²) for the rare repeated-key case.
      const existing = out[a.key];
      if (Array.isArray(existing)) {
        existing.push(v);
      } else {
        out[a.key] = [existing, v];
      }
    } else {
      out[a.key] = v;
    }
  }
  return out;
}

// Parse an OTLP/JSON logs envelope. Returns array of normalized log records.
// Each record: { time: ISO string, name: claude_code.* | codex.* | gemini_cli.*, body: string|null, attrs: object, resource: object }
export function parseLogs(envelope) {
  const out = [];
  for (const rl of envelope?.resourceLogs ?? []) {
    const resource = attrsToObject(rl.resource?.attributes);
    const serviceName = resource['service.name'];
    const vendorPrefix = vendorPrefixFor(serviceName);
    for (const sl of rl.scopeLogs ?? []) {
      for (const lr of sl.logRecords ?? []) {
        const attrs = attrsToObject(lr.attributes);
        const time = nanoToIso(lr.timeUnixNano ?? lr.observedTimeUnixNano);
        const body = lr.body ? (lr.body.stringValue ?? null) : null;
        // Vendor name precedence — produce a fully-prefixed name (e.g.
        // "claude_code.user_prompt") regardless of how the vendor encoded it:
        //   - Claude: body has prefix, attrs["event.name"] is bare
        //   - Gemini: attrs["event.name"] has prefix, body is human-readable
        //   - Codex: assumed similar to Claude/Gemini convention
        const eventName = attrs['event.name'];
        let name = null;
        if (typeof body === 'string' && body.includes('.') && !body.includes(' ')) {
          name = body;
        } else if (typeof eventName === 'string' && eventName.includes('.')) {
          name = eventName;
        } else if (typeof eventName === 'string' && vendorPrefix) {
          name = `${vendorPrefix}.${eventName}`;
        } else {
          name = eventName ?? body ?? null;
        }
        out.push({ time, name, body, attrs, resource });
      }
    }
  }
  return out;
}

function vendorPrefixFor(serviceName) {
  if (!serviceName) return null;
  const s = String(serviceName).toLowerCase();
  if (s.includes('claude')) return 'claude_code';
  if (s.includes('gemini')) return 'gemini_cli';
  if (s.includes('codex'))  return 'codex';
  return null;
}

// Parse OTLP/JSON metrics envelope into a flat list of datapoints.
// Returns array of { name, time, attrs, value, kind } where kind is 'sum'|'gauge'|'histogram'.
export function parseMetrics(envelope) {
  const out = [];
  for (const rm of envelope?.resourceMetrics ?? []) {
    const resource = attrsToObject(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        const name = m.name;
        const points = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? m.histogram?.dataPoints ?? [];
        const kind = m.sum ? 'sum' : (m.gauge ? 'gauge' : (m.histogram ? 'histogram' : 'unknown'));
        for (const dp of points) {
          out.push({
            name,
            kind,
            time: nanoToIso(dp.timeUnixNano),
            attrs: attrsToObject(dp.attributes),
            value: dp.asInt != null ? Number(dp.asInt) : (dp.asDouble != null ? Number(dp.asDouble) : null),
            resource,
          });
        }
      }
    }
  }
  return out;
}

// Convert OTLP nanosecond timestamp to JS ISO string.
// Returns null on missing/invalid input — callers MUST handle null.
// (`src/otel/sink.js:_writeRecord` falls back to `new Date().toISOString()`
// before any DB insert, where `timestamp NOT NULL` would otherwise fail.)
function nanoToIso(nano) {
  if (!nano) return null;
  // OTLP carries nanos as string for precision; JS Date is millis
  const ns = typeof nano === 'string' ? Number(nano) : nano;
  if (!Number.isFinite(ns)) return null;
  return new Date(ns / 1e6).toISOString();
}
