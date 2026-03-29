import fs from 'node:fs';
import TOML from 'toml';

export const defaultConfig = {
  proxy: {
    port: 8080,
  },
  ui: {
    port: 3000,
  },
  classifier: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    base_url: '',
  },
  storage: {
    path: '~/.agent-feed/feed.db',
  },
};

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

export function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { ...defaultConfig };
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = TOML.parse(raw);
  return deepMerge(defaultConfig, parsed);
}
