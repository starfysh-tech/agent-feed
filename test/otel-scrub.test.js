import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scrubAttrs, scrubString } from '../src/otel/scrub.js';

describe('PII scrub', () => {
  describe('scrubAttrs', () => {
    it('removes top-level PII keys', () => {
      const input = {
        'user.email': 'a@b.com',
        'user.id': '123',
        'user.account_uuid': 'uuid',
        'user.account_id': 'acc',
        'organization.id': 'org',
        'installation.id': 'inst',
        'session.id': 'keep-me',
        'tool_name': 'Bash',
      };
      const out = scrubAttrs(input);
      assert.equal(out['user.email'], undefined);
      assert.equal(out['user.id'], undefined);
      assert.equal(out['user.account_uuid'], undefined);
      assert.equal(out['user.account_id'], undefined);
      assert.equal(out['organization.id'], undefined);
      assert.equal(out['installation.id'], undefined);
      assert.equal(out['session.id'], 'keep-me');
      assert.equal(out['tool_name'], 'Bash');
    });

    it('redacts email in plain string attribute', () => {
      const out = scrubAttrs({ note: 'contact me at foo@bar.com please' });
      assert.equal(out.note, 'contact me at [EMAIL] please');
    });

    it('descends into nested object attribute', () => {
      const out = scrubAttrs({
        meta: {
          'user.email': 'should-go@example.com',
          keep: 'this',
        },
      });
      assert.deepEqual(out.meta, { keep: 'this' });
    });

    it('handles null and undefined cleanly', () => {
      assert.equal(scrubAttrs(null), null);
      assert.equal(scrubAttrs(undefined), undefined);
    });
  });

  describe('scrubString — JSON body case', () => {
    it('parses JSON body, recursively scrubs, re-stringifies', () => {
      const input = JSON.stringify({
        messages: [
          { role: 'user', content: 'reach me at agent@example.com' },
          { role: 'assistant', content: 'ok' },
        ],
        metadata: { 'user.email': 'meta@example.com' },
      });
      const out = scrubString(input);
      const parsed = JSON.parse(out);
      assert.equal(parsed.messages[0].content, 'reach me at [EMAIL]');
      assert.equal(parsed.messages[1].content, 'ok');
      assert.equal(parsed.metadata?.['user.email'], undefined);
    });

    it('redacts email in non-JSON string', () => {
      assert.equal(scrubString('hello user@host.org goodbye'), 'hello [EMAIL] goodbye');
    });

    it('passes through non-PII strings unchanged', () => {
      assert.equal(scrubString('nothing to see'), 'nothing to see');
    });

    it('returns string unchanged on JSON parse failure (no false-positive errors)', () => {
      // Looks like JSON (starts with {) but isn't valid
      assert.equal(scrubString('{not really json}'), '{not really json}');
    });

    it('returns empty string and null cleanly', () => {
      assert.equal(scrubString(''), '');
      assert.equal(scrubString(null), null);
    });
  });

  describe('scrubAttrs — body field case', () => {
    it('scrubs Claude-style api_response_body content', () => {
      const body = JSON.stringify({
        model: 'claude-opus-4-7',
        content: [{ type: 'text', text: 'email me at user@example.com when done' }],
      });
      const out = scrubAttrs({ body, body_length: '1000', model: 'claude-opus-4-7' });
      const parsed = JSON.parse(out.body);
      assert.equal(parsed.content[0].text, 'email me at [EMAIL] when done');
      assert.equal(out.body_length, '1000');
      assert.equal(out.model, 'claude-opus-4-7');
    });

    it('scrubs Gemini gen_ai.input.messages structure', () => {
      const messages = JSON.stringify([
        { role: 'user', content: 'login as admin@gem.dev' },
      ]);
      const out = scrubAttrs({ 'gen_ai.input.messages': messages });
      const parsed = JSON.parse(out['gen_ai.input.messages']);
      assert.equal(parsed[0].content, 'login as [EMAIL]');
    });
  });
});
