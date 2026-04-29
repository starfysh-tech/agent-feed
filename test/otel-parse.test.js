import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogs, parseMetrics, attrsToObject } from '../src/otel/parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'otel');

function loadEnvelopes(file) {
  return fs.readFileSync(path.join(fixturesDir, file), 'utf8')
    .trim().split('\n').map(JSON.parse);
}

describe('OTLP parse', () => {
  describe('attrsToObject — coercion', () => {
    it('coerces stringValue, intValue, doubleValue, boolValue', () => {
      const out = attrsToObject([
        { key: 's', value: { stringValue: 'hi' } },
        { key: 'i', value: { intValue: 5 } },
        { key: 'i_str', value: { intValue: '7' } },
        { key: 'd', value: { doubleValue: 1.5 } },
        { key: 'b', value: { boolValue: true } },
      ]);
      assert.deepEqual(out, { s: 'hi', i: 5, i_str: 7, d: 1.5, b: true });
    });

    it('coerces invalid numerics to null, not NaN', () => {
      const out = attrsToObject([
        { key: 'bad_int', value: { intValue: 'not-a-number' } },
        { key: 'bad_dbl', value: { doubleValue: NaN } },
      ]);
      assert.equal(out.bad_int, null);
      assert.equal(out.bad_dbl, null);
    });

    it('preserves repeated keys as array', () => {
      const out = attrsToObject([
        { key: 'tag', value: { stringValue: 'a' } },
        { key: 'tag', value: { stringValue: 'b' } },
        { key: 'tag', value: { stringValue: 'c' } },
      ]);
      assert.deepEqual(out.tag, ['a', 'b', 'c']);
    });

    it('handles missing value cleanly', () => {
      const out = attrsToObject([{ key: 'empty', value: {} }]);
      assert.equal(out.empty, null);
    });

    it('returns empty object for null/undefined input', () => {
      assert.deepEqual(attrsToObject(null), {});
      assert.deepEqual(attrsToObject(undefined), {});
    });
  });

  describe('parseLogs', () => {
    it('parses Claude fixture into named records', () => {
      const envelopes = loadEnvelopes('claude.ndjson');
      const records = [];
      for (const env of envelopes) {
        if (env.url === '/v1/logs' && env.bodyJson) {
          records.push(...parseLogs(env.bodyJson));
        }
      }
      assert.ok(records.length > 0, 'should produce records');
      // Every record has a name in the claude_code namespace
      for (const r of records) {
        assert.ok(r.name?.startsWith('claude_code.'), `unexpected name ${r.name}`);
      }
      // Names cover the validated event types
      const names = new Set(records.map(r => r.name));
      for (const expected of ['claude_code.user_prompt', 'claude_code.tool_decision', 'claude_code.tool_result', 'claude_code.api_request']) {
        assert.ok(names.has(expected), `missing ${expected} in parsed records`);
      }
    });

    it('parses Gemini fixture and surfaces session.id + prompt_id', () => {
      const envelopes = loadEnvelopes('gemini.ndjson');
      const records = [];
      for (const env of envelopes) {
        if (env.url === '/v1/logs' && env.bodyJson) {
          records.push(...parseLogs(env.bodyJson));
        }
      }
      assert.ok(records.length > 0);
      const userPrompt = records.find(r => r.name === 'gemini_cli.user_prompt');
      assert.ok(userPrompt, 'fixture must contain gemini_cli.user_prompt');
      assert.ok(userPrompt.attrs['session.id']);
      assert.ok(userPrompt.attrs.prompt_id);
    });

    it('returns ISO timestamps from nano times', () => {
      const env = {
        resourceLogs: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
          scopeLogs: [{
            logRecords: [{
              timeUnixNano: '1777483631858000000',
              body: { stringValue: 'claude_code.user_prompt' },
              attributes: [],
            }],
          }],
        }],
      };
      const records = parseLogs(env);
      assert.equal(records.length, 1);
      assert.equal(records[0].name, 'claude_code.user_prompt');
      // ISO produced from nanoseconds — check it's a valid 24-char ISO ending in Z
      assert.match(records[0].time, /^2026-04-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('parseMetrics', () => {
    it('flattens datapoints from sum metrics', () => {
      const envelopes = loadEnvelopes('claude.ndjson');
      const points = [];
      for (const env of envelopes) {
        if (env.url === '/v1/metrics' && env.bodyJson) {
          points.push(...parseMetrics(env.bodyJson));
        }
      }
      const byName = new Set(points.map(p => p.name));
      for (const expected of ['claude_code.session.count', 'claude_code.token.usage', 'claude_code.cost.usage']) {
        assert.ok(byName.has(expected), `missing metric ${expected}`);
      }
    });
  });
});
