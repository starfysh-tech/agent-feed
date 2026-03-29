import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateClassifierWithFallback } from '../src/classifier/index.js';

describe('validateClassifierWithFallback', () => {
  it('returns configured provider when it succeeds', async () => {
    const mockFetch = async () => ({ ok: true, json: async () => ({}) });
    const result = await validateClassifierWithFallback(
      { provider: 'ollama', model: 'llama3.1', base_url: 'http://localhost:11434' },
      mockFetch,
    );
    assert.equal(result.ok, true);
    assert.ok(result.label.includes('ollama'));
    assert.equal(result.provider, 'ollama');
    assert.equal(result.base_url, 'http://localhost:11434');
  });

  it('falls back to ollama when configured provider fails', async () => {
    let callCount = 0;
    const mockFetch = async (url) => {
      callCount++;
      // First call (anthropic validation via key check) -- no key set
      // Second call (ollama tags endpoint) -- succeeds
      if (url.includes('11434')) return { ok: true, json: async () => ({}) };
      throw new Error('unreachable');
    };

    // Simulate no API key
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await validateClassifierWithFallback(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'ollama');
    assert.ok(result.label.includes('ollama'));
  });

  it('falls back to lmstudio when ollama also fails', async () => {
    const mockFetch = async (url) => {
      if (url.includes('1234')) return { ok: true, json: async () => ({}) };
      throw new Error('unreachable');
    };

    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await validateClassifierWithFallback(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'lmstudio');
    assert.ok(result.label.includes('lmstudio'));
  });

  it('falls back to anthropic api key when local providers fail', async () => {
    const mockFetch = async () => { throw new Error('unreachable'); };

    const savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const result = await validateClassifierWithFallback(
      { provider: 'ollama', model: 'llama3.1', base_url: 'http://localhost:11434' },
      mockFetch,
    );

    process.env.ANTHROPIC_API_KEY = savedKey ?? '';

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'anthropic');
    assert.ok(result.label.includes('anthropic'));
  });

  it('fails with descriptive message when all providers fail', async () => {
    const mockFetch = async () => { throw new Error('connection refused'); };

    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await validateClassifierWithFallback(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('anthropic'));
    assert.ok(result.reason.includes('ollama'));
    assert.ok(result.reason.includes('lmstudio'));
  });

  it('returns effective config so classifier can be built with correct provider', async () => {
    const mockFetch = async (url) => {
      if (url.includes('11434')) return { ok: true, json: async () => ({}) };
      throw new Error('unreachable');
    };

    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await validateClassifierWithFallback(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

    assert.ok(result.effectiveConfig);
    assert.equal(result.effectiveConfig.provider, 'ollama');
    assert.ok(result.effectiveConfig.base_url);
  });
});
