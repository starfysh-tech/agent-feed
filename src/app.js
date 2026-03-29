import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Proxy } from './proxy/index.js';
import { Database } from './storage/database.js';
import { Pipeline } from './pipeline.js';
import { buildClassifier, validateClassifierWithFallback } from './classifier/index.js';
import { createUIServer } from './ui/server.js';

function resolvePath(p) {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export class App {
  constructor({ config, skipClassifierValidation = false } = {}) {
    this.config = config;
    this.skipClassifierValidation = skipClassifierValidation;
    this._running = false;
    this._proxy = null;
    this._db = null;
    this._uiServer = null;
    this.proxyPort = null;
    this.uiPort = null;
  }

  async start() {
    const { proxy: proxyCfg, ui: uiCfg, storage: storageCfg } = this.config;
    let classifierCfg = this.config.classifier;

    // Validate classifier unless skipped (test mode)
    if (!this.skipClassifierValidation) {
      const validation = await validateClassifierWithFallback(classifierCfg);
      if (!validation.ok) {
        throw new Error(`Classifier unreachable: ${validation.reason}`);
      }
      this._classifierLabel = validation.label;
      // Use whichever provider actually connected (may differ from config)
      classifierCfg = validation.effectiveConfig;
    }

    // Init database
    const dbPath = resolvePath(storageCfg.path);
    this._db = new Database(dbPath);
    await this._db.init();
    this._dbPath = dbPath;

    // Build classifier function
    const classifierFn = this.skipClassifierValidation
      ? null
      : buildClassifier(classifierCfg);

    // Build pipeline
    const pipeline = new Pipeline({ db: this._db, classifierFn });

    // Start proxy
    this._proxy = new Proxy({
      port: proxyCfg.port,
      onCapture: (capture) => {
        pipeline.process(capture).catch((err) => {
          console.error('[agent-feed] pipeline error:', err.message ?? err);
        });
      },
    });
    await this._proxy.start();
    this.proxyPort = this._proxy.port;

    // Start UI server
    this._uiServer = createUIServer({ db: this._db });
    await this._uiServer.listen(uiCfg.port);
    this.uiPort = this._uiServer.port;

    this._running = true;
  }

  async stop() {
    if (this._proxy) await this._proxy.stop();
    if (this._uiServer) await this._uiServer.close();
    if (this._db) await this._db.close();
    this._running = false;
  }

  isRunning() {
    return this._running;
  }

  getStatus() {
    let dbSizeBytes = 0;
    try {
      if (this._dbPath && fs.existsSync(this._dbPath)) {
        dbSizeBytes = fs.statSync(this._dbPath).size;
      }
    } catch {}
    return {
      proxyPort: this.proxyPort,
      uiPort: this.uiPort,
      dbSizeBytes,
      classifierLabel: this._classifierLabel ?? null,
    };
  }
}
