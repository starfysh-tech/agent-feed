import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, defaultConfig } from '../src/config.js';

describe('loadConfig', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default config when no file exists', () => {
    const cfg = loadConfig(path.join(tmpDir, 'nonexistent.toml'));
    assert.deepEqual(cfg, defaultConfig);
  });

  it('merges file config over defaults', () => {
    const toml = `
[proxy]
port = 9090

[classifier]
provider = "ollama"
model = "llama3.1"
base_url = "http://localhost:11434"
`;
    const cfgPath = path.join(tmpDir, 'config.toml');
    fs.writeFileSync(cfgPath, toml);
    const cfg = loadConfig(cfgPath);
    assert.equal(cfg.proxy.port, 9090);
    assert.equal(cfg.classifier.provider, 'ollama');
    assert.equal(cfg.classifier.model, 'llama3.1');
    assert.equal(cfg.classifier.base_url, 'http://localhost:11434');
    // defaults preserved for unset keys
    assert.equal(cfg.ui.port, defaultConfig.ui.port);
  });

  it('partial section override preserves other section defaults', () => {
    const toml = `
[ui]
port = 4000
`;
    const cfgPath = path.join(tmpDir, 'partial.toml');
    fs.writeFileSync(cfgPath, toml);
    const cfg = loadConfig(cfgPath);
    assert.equal(cfg.ui.port, 4000);
    assert.equal(cfg.proxy.port, defaultConfig.proxy.port);
    assert.equal(cfg.classifier.provider, defaultConfig.classifier.provider);
  });

  it('throws on invalid toml', () => {
    const cfgPath = path.join(tmpDir, 'bad.toml');
    fs.writeFileSync(cfgPath, 'this is not = valid = toml :::');
    assert.throws(() => loadConfig(cfgPath));
  });
});
