import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Proxy } from './proxy/index.js';
import { Database } from './storage/database.js';
import { Pipeline } from './pipeline.js';
import { buildClassifier, validateClassifierWithFallback } from './classifier/index.js';
import { createUIServer } from './ui/server.js';
import { OtelReceiver } from './otel/receiver.js';
import { OtelSink } from './otel/sink.js';

function resolvePath(p) {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export class App {
  constructor({ config, skipClassifierValidation = false, verbose = false } = {}) {
    this.config = config;
    this.skipClassifierValidation = skipClassifierValidation;
    this._verbose = verbose;
    this._running = false;
    this._proxy = null;
    this._db = null;
    this._uiServer = null;
    this._otelReceiver = null;
    this.proxyPort = null;
    this.uiPort = null;
    this.otelPort = null;
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
      upstreamTimeout: proxyCfg.upstream_timeout ?? 0,
      maxCaptureSize: proxyCfg.max_capture_size ?? Infinity,
      verbose: this._verbose,
      onCapture: (capture) => {
        pipeline.process(capture).catch((err) => {
          console.error('[agent-feed] pipeline error:', err.message ?? err);
        });
      },
    });
    await this._proxy.start();
    this.proxyPort = this._proxy.port;

    // Start OTel receiver (optional, on by default)
    const otelCfg = this.config.otel ?? {};
    if (otelCfg.enabled !== false) {
      const sink = new OtelSink({ db: this._db });
      this._otelReceiver = new OtelReceiver({
        sink,
        host: otelCfg.host ?? '127.0.0.1',
        port: otelCfg.port ?? 4318,
        maxBodyBytes: otelCfg.max_body_bytes ?? 1_000_000,
        logger: this._verbose ? console : { info() {}, warn: console.warn, error: console.error },
      });
      try {
        await this._otelReceiver.start();
        this.otelPort = this._otelReceiver.server.address().port;
      } catch (err) {
        // Don't fail the daemon if the OTel port is taken — proxy is canonical.
        console.warn(`[agent-feed] OTel receiver failed to start on :${otelCfg.port ?? 4318}: ${err.message}`);
        this._otelReceiver = null;
      }
    }

    // Start UI server
    this._uiServer = createUIServer({ db: this._db });
    await this._uiServer.listen(uiCfg.port);
    this.uiPort = this._uiServer.port;

    this._running = true;
  }

  async stop() {
    if (this._proxy) await this._proxy.stop();
    if (this._otelReceiver) await this._otelReceiver.stop();
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
    } catch { /* stat may fail if file was just deleted — return 0 */ }
    return {
      proxyPort: this.proxyPort,
      uiPort: this.uiPort,
      otelPort: this.otelPort,
      otelMetrics: this._otelReceiver?.getMetrics() ?? null,
      dbSizeBytes,
      classifierLabel: this._classifierLabel ?? null,
    };
  }
}
