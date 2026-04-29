// Hardened OTLP/JSON HTTP receiver.
//
// Endpoints accepted:
//   POST /v1/logs    -> sink.ingestLogs(parseLogs(body))
//   POST /v1/metrics -> currently parsed for completeness, not stored (TODO)
//   POST /v1/traces  -> 200 + discard (Gemini emits these by default;
//                       returning 4xx/5xx triggers exporter retries)
//
// Hardening rules (per the validated plan):
//   1. Always return 200 with {"partialSuccess":{}} on parse error. NEVER 5xx.
//      Exporter retries on 5xx create storage explosions.
//   2. Body cap: 1,000,000 bytes (4× P99 of observed Claude api_response_body
//      size = 248,233). Reject larger requests with 413.
//   3. Content-Encoding: gzip ingress handled. Other encodings -> 400.
//   4. Bind to 127.0.0.1 by default. No inbound auth (Gemini doesn't support
//      OTEL_EXPORTER_OTLP_HEADERS so universal shared-secret is impossible).
//   5. Discard inbound Authorization and other custom OTLP headers; never log.
//   6. Sync DB write inside try/catch; failure logs but returns 200.

import http from 'node:http';
import zlib from 'node:zlib';
import { parseLogs, parseMetrics } from './parse.js';

const DEFAULT_PORT = 4318;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MAX_BODY = 1_000_000;

const PARTIAL_SUCCESS = JSON.stringify({ partialSuccess: {} });

export class OtelReceiver {
  constructor({
    sink,
    port = DEFAULT_PORT,
    host = DEFAULT_HOST,
    maxBodyBytes = DEFAULT_MAX_BODY,
    logger = console,
  } = {}) {
    if (!sink) throw new Error('OtelReceiver requires a sink');
    this.sink = sink;
    this.port = port;
    this.host = host;
    this.maxBodyBytes = maxBodyBytes;
    this.logger = logger;
    this.server = null;
    this.metrics = {
      otel_logs_received_total: 0,
      otel_metrics_received_total: 0,
      otel_traces_discarded_total: 0,
      otel_parse_failures_total: 0,
      otel_oversize_total: 0,
      otel_unknown_path_total: 0,
    };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handle(req, res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.logger.info?.(`[otel-receiver] listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server.close(() => { this.server = null; resolve(); });
    });
  }

  getMetrics() { return { ...this.metrics }; }

  async _handle(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(PARTIAL_SUCCESS);
      return;
    }

    // Path routing
    const route = (req.url ?? '').split('?')[0];
    if (!['/v1/logs', '/v1/metrics', '/v1/traces'].includes(route)) {
      this.metrics.otel_unknown_path_total++;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(PARTIAL_SUCCESS);
      return;
    }

    // Read body with cap
    let body;
    try {
      body = await this._readBody(req);
    } catch (err) {
      if (err.code === 'TOO_LARGE') {
        this.metrics.otel_oversize_total++;
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(PARTIAL_SUCCESS);
        return;
      }
      if (err.code === 'BAD_ENCODING') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(PARTIAL_SUCCESS);
        return;
      }
      // Unknown read error — still 200 to prevent retry storms
      this.metrics.otel_parse_failures_total++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(PARTIAL_SUCCESS);
      return;
    }

    // Trace endpoint: accept and discard
    if (route === '/v1/traces') {
      this.metrics.otel_traces_discarded_total++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(PARTIAL_SUCCESS);
      return;
    }

    // Parse JSON envelope
    let envelope = null;
    const ct = req.headers['content-type'] ?? '';
    if (ct.includes('json')) {
      try {
        envelope = JSON.parse(body.toString('utf8'));
      } catch (err) {
        this.metrics.otel_parse_failures_total++;
        this.logger.warn?.('[otel-receiver] JSON parse failed:', err.message);
        // Still 200 — exporter retry would just resend the same garbage
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(PARTIAL_SUCCESS);
        return;
      }
    } else {
      // Protobuf not supported in v1 — return 415 so the exporter can detect
      // and switch to JSON (returning 200 here would silently swallow the data).
      // OTel exporters do NOT retry on 4xx, so this is safe.
      this.metrics.otel_parse_failures_total++;
      this.logger.warn?.(`[otel-receiver] unsupported content-type: ${ct}`);
      res.writeHead(415, { 'content-type': 'application/json' });
      res.end(PARTIAL_SUCCESS);
      return;
    }

    // Dispatch to sink
    try {
      if (route === '/v1/logs') {
        this.metrics.otel_logs_received_total++;
        const records = parseLogs(envelope);
        await this.sink.ingestLogs(records);
      } else if (route === '/v1/metrics') {
        this.metrics.otel_metrics_received_total++;
        // Parse but don't store yet — placeholder for future metric ingestion
        parseMetrics(envelope);
      }
    } catch (err) {
      this.metrics.otel_parse_failures_total++;
      this.logger.error?.('[otel-receiver] sink error:', err.message ?? err);
      // Always 200 even on sink failure
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(PARTIAL_SUCCESS);
  }

  async _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let aborted = false;
      req.on('data', (chunk) => {
        if (aborted) return;
        total += chunk.length;
        if (total > this.maxBodyBytes) {
          aborted = true;
          // Pause ingestion but let the request complete cleanly so we can
          // respond with 413 (vs destroying the socket, which races the
          // response and fails the client).
          req.pause();
          const err = new Error('body too large');
          err.code = 'TOO_LARGE';
          reject(err);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        let buf = Buffer.concat(chunks);
        const enc = req.headers['content-encoding'];
        if (enc === 'gzip') {
          try {
            buf = zlib.gunzipSync(buf);
          } catch (err) {
            const e = new Error('gunzip failed');
            e.code = 'BAD_ENCODING';
            reject(e);
            return;
          }
        } else if (enc && enc !== 'identity') {
          const e = new Error(`unsupported encoding: ${enc}`);
          e.code = 'BAD_ENCODING';
          reject(e);
          return;
        }
        // Re-check decompressed size
        if (buf.length > this.maxBodyBytes) {
          const e = new Error('decompressed body too large');
          e.code = 'TOO_LARGE';
          reject(e);
          return;
        }
        resolve(buf);
      });
      req.on('error', reject);
    });
  }
}
