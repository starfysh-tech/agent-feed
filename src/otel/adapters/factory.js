// Factory for vendor-specific OTel adapters. Each vendor is reduced to a
// config object: prefix(es) for namespace match, kindMap for event-name ->
// canonical kind, and attr key paths for the four correlation IDs.

export function createAdapter({ vendor, prefixes, kindMap, attrKeys }) {
  const prefixList = Array.isArray(prefixes) ? prefixes : [prefixes];
  return {
    vendor,
    matches(name) {
      return typeof name === 'string' && prefixList.some(p => name.startsWith(p));
    },
    kindFor(name) { return kindMap[name] ?? 'unknown'; },
    extract(record) {
      const a = record.attrs ?? {};
      return {
        vendor,
        kind: this.kindFor(record.name),
        name: record.name,
        time: record.time,
        sessionId: pickFirst(a, attrKeys.sessionId),
        promptId:  pickFirst(a, attrKeys.promptId),
        requestId: pickFirst(a, attrKeys.requestId),
        sequence:  attrKeys.sequence ? numOrNull(a[attrKeys.sequence]) : null,
        attrs: a,
        resource: record.resource,
      };
    },
  };
}

function pickFirst(attrs, keys) {
  if (!keys) return null;
  for (const k of (Array.isArray(keys) ? keys : [keys])) {
    if (attrs[k] != null) return attrs[k];
  }
  return null;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
