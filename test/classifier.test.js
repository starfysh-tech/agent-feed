import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSUMPTION_SUPPORT_PROMPT,
  buildAssumptionSupportChecker,
  buildClassifier,
  CLASSIFICATION_PROMPT,
} from '../src/classifier/index.js';

describe('CLASSIFICATION_PROMPT', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof CLASSIFICATION_PROMPT, 'string');
    assert.ok(CLASSIFICATION_PROMPT.length > 100);
  });

  it('instructs JSON-only output', () => {
    assert.ok(CLASSIFICATION_PROMPT.toLowerCase().includes('json'));
  });

  it('includes all flag types', () => {
    const types = [
      'decision', 'assumption', 'architecture', 'pattern',
      'dependency', 'tradeoff', 'constraint', 'workaround', 'risk',
    ];
    for (const type of types) {
      assert.ok(CLASSIFICATION_PROMPT.includes(type), `prompt should mention flag type: ${type}`);
    }
  });
});

describe('ASSUMPTION_SUPPORT_PROMPT', () => {
  it('requires exact evidence and a two-state judgment', () => {
    assert.ok(ASSUMPTION_SUPPORT_PROMPT.includes('exact, contiguous quote'));
    assert.ok(ASSUMPTION_SUPPORT_PROMPT.includes('supported'));
    assert.ok(ASSUMPTION_SUPPORT_PROMPT.includes('unsupported'));
    assert.equal(ASSUMPTION_SUPPORT_PROMPT.includes('"supported" or "unsupported"'), false);
  });
});

describe('buildClassifier', () => {
  it('returns a function', () => {
    const classifier = buildClassifier({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' });
    assert.equal(typeof classifier, 'function');
  });

  it('returned function accepts content string and returns a promise', () => {
    // We mock the fetch to avoid real API calls in unit tests
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            response_summary: 'Agent decided to use JWT for authentication',
            flags: [
              { type: 'decision', content: 'Use JWT over session cookies', confidence: 0.95 },
              { type: 'assumption', content: 'Stateless architecture is preferred', confidence: 0.80 },
            ],
          }),
        }],
      }),
    });

    const classifier = buildClassifier(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    const result = classifier('I decided to use JWT for auth because it is stateless');
    assert.ok(result instanceof Promise);
  });

  it('parses classifier response into summary and flags', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            response_summary: 'Agent chose JWT for auth',
            flags: [
              { type: 'decision', content: 'Use JWT', confidence: 0.95 },
            ],
          }),
        }],
      }),
    });

    const classifier = buildClassifier(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    const result = await classifier('I will use JWT for authentication');
    assert.equal(typeof result.response_summary, 'string');
    assert.ok(Array.isArray(result.flags));
    assert.equal(result.flags[0].type, 'decision');
    assert.equal(result.flags[0].confidence, 0.95);
  });

  it('returns empty flags array when classifier returns none', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            response_summary: 'Agent listed some files',
            flags: [],
          }),
        }],
      }),
    });

    const classifier = buildClassifier(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    const result = await classifier('ls -la');
    assert.deepEqual(result.flags, []);
  });

  it('handles malformed JSON from classifier gracefully', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'not valid json at all' }],
      }),
    });

    const classifier = buildClassifier(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      mockFetch,
    );

    const result = await classifier('some content');
    assert.ok(typeof result.response_summary === 'string');
    assert.deepEqual(result.flags, []);
  });

  it('builds correct endpoint for ollama provider', () => {
    let capturedUrl = null;
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{"response_summary":"ok","flags":[]}' }] }),
      };
    };

    const classifier = buildClassifier(
      { provider: 'ollama', model: 'llama3.1', base_url: 'http://localhost:11434' },
      mockFetch,
    );

    return classifier('test').then(() => {
      assert.ok(capturedUrl.startsWith('http://localhost:11434'), `expected ollama URL, got ${capturedUrl}`);
    });
  });
});

describe('buildAssumptionSupportChecker', () => {
  it('accepts supported only when the evidence is present verbatim', async () => {
    const captured = 'The integration test passed with three isolated workers.';
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({
              support_status: 'supported',
              evidence: 'The integration test passed with three isolated workers.',
            }),
          }],
        }),
      }),
    );

    const result = await checker('Workers are isolated', captured);
    assert.deepEqual(result, { support_status: 'supported', evidence: captured });
  });

  it('parses a supported OpenAI-compatible response', async () => {
    const captured = 'The health check returned HTTP 200.';
    const checker = buildAssumptionSupportChecker(
      { provider: 'ollama', model: 'llama3.1', base_url: 'http://localhost:11434' },
      async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                support_status: 'supported',
                evidence: captured,
              }),
            },
          }],
        }),
      }),
    );

    const result = await checker('The service is healthy', captured);
    assert.deepEqual(result, { support_status: 'supported', evidence: captured });
  });

  it('accepts an explicit unsupported result', async () => {
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({ support_status: 'unsupported', evidence: null }),
          }],
        }),
      }),
    );

    const result = await checker('Docker is available', 'Assuming Docker is available.');
    assert.deepEqual(result, { support_status: 'unsupported', evidence: null });
  });

  it('downgrades invented evidence to unsupported', async () => {
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({
              support_status: 'supported',
              evidence: 'A test proved token reuse is safe.',
            }),
          }],
        }),
      }),
    );

    const result = await checker(
      'Auth tokens can be reused across workers',
      'We can safely reuse this auth token across workers.',
    );
    assert.deepEqual(result, { support_status: 'unsupported', evidence: null });
  });

  it('does not accept an exact short assumption as evidence', async () => {
    const statement = 'DB is up.';
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({
              support_status: 'supported',
              evidence: statement,
            }),
          }],
        }),
      }),
    );

    const result = await checker('DB is up', statement);
    assert.deepEqual(result, { support_status: 'unsupported', evidence: null });
  });

  it('accepts overlapping evidence when it adds a supporting fact', async () => {
    const evidence = 'Docker is available in the sandbox, confirmed by docker ps.';
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({ support_status: 'supported', evidence }),
          }],
        }),
      }),
    );

    const result = await checker('Docker is available in the sandbox', evidence);
    assert.deepEqual(result, { support_status: 'supported', evidence });
  });

  it('leaves malformed JSON unchecked', async () => {
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'not json' }] }),
      }),
    );

    const result = await checker('Docker is available', 'Docker is available.');
    assert.deepEqual(result, { support_status: null, evidence: null });
  });

  it('leaves an unexpected support status unchecked', async () => {
    const checker = buildAssumptionSupportChecker(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
      async () => ({
        ok: true,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({ support_status: 'unknown', evidence: null }),
          }],
        }),
      }),
    );

    const result = await checker('Docker is available', 'Docker is available.');
    assert.deepEqual(result, { support_status: null, evidence: null });
  });

  it('leaves the result unchecked when the support service fails', async () => {
    const checker = buildAssumptionSupportChecker(
      { provider: 'ollama', model: 'llama3.1', base_url: 'http://localhost:11434' },
      async () => ({ ok: false }),
    );

    const result = await checker('Docker is available', 'Assuming Docker is available.');
    assert.deepEqual(result, { support_status: null, evidence: null });
  });
});
