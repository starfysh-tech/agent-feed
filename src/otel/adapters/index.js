// OTel adapter dispatch. Mirrors src/adapters/index.js HOST_MAP pattern, but
// keyed off vendor namespace prefix on the event name.

import { claudeAdapter } from './claude.js';
import { codexAdapter }  from './codex.js';
import { geminiAdapter } from './gemini.js';

const ADAPTERS = [claudeAdapter, codexAdapter, geminiAdapter];

export function getAdapter(record) {
  for (const a of ADAPTERS) {
    if (a.matches(record.name)) return a;
  }
  return null;
}

export function adapterByVendor(vendor) {
  return ADAPTERS.find(a => a.vendor === vendor) ?? null;
}

export const VENDORS = Object.freeze({
  CLAUDE: 'claude',
  CODEX:  'codex',
  GEMINI: 'gemini',
});
