import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { App } from '../src/app.js';

describe('App', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feed-app-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('starts and reports ready state', async () => {
    const app = new App({
      config: {
        proxy: { port: 0 },
        ui: { port: 0 },
        classifier: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
        storage: { path: path.join(tmpDir, 'app-test.db') },
      },
      skipClassifierValidation: true,
    });

    await app.start();
    assert.ok(app.isRunning());
    assert.ok(app.proxyPort > 0);
    assert.ok(app.uiPort > 0);
    await app.stop();
  });

  it('stops cleanly and reports not running', async () => {
    const app = new App({
      config: {
        proxy: { port: 0 },
        ui: { port: 0 },
        classifier: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
        storage: { path: path.join(tmpDir, 'app-stop-test.db') },
      },
      skipClassifierValidation: true,
    });

    await app.start();
    assert.ok(app.isRunning());
    await app.stop();
    assert.ok(!app.isRunning());
  });

  it('reports db size on start', async () => {
    const app = new App({
      config: {
        proxy: { port: 0 },
        ui: { port: 0 },
        classifier: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', base_url: '' },
        storage: { path: path.join(tmpDir, 'app-size-test.db') },
      },
      skipClassifierValidation: true,
    });

    await app.start();
    const status = app.getStatus();
    assert.ok(typeof status.dbSizeBytes === 'number');
    assert.ok(status.dbSizeBytes >= 0);
    await app.stop();
  });
});
