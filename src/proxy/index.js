import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const SCRUBBED_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key'];

export const UPSTREAM_MAP = {
  '/anthropic': { host: 'api.anthropic.com', port: 443, tls: true },
  '/openai':    { host: 'api.openai.com', port: 443, tls: true },
  '/google':    { host: 'generativelanguage.googleapis.com', port: 443, tls: true },
};

function scrubHeaders(headers) {
  const scrubbed = { ...headers };
  for (const key of SCRUBBED_HEADERS) {
    if (scrubbed[key]) scrubbed[key] = '[REDACTED]';
  }
  return scrubbed;
}

export class Proxy {
  constructor({ port = 8080, onCapture = () => {}, upstreamMap = UPSTREAM_MAP, upstreamTimeout = 0, maxCaptureSize = Infinity } = {}) {
    this._configPort = port;
    this.port = null;
    this.onCapture = onCapture;
    this._upstreamEntries = Object.entries(upstreamMap);
    // WHY: Node's request.setTimeout() is a socket IDLE timeout, not TTFB.
    // It fires during SSE streaming pauses too. We set it on request creation
    // then CLEAR it once response headers arrive — making it a pure TTFB guard.
    // 0 means no timeout (default, preserves existing behavior).
    this._upstreamTimeout = upstreamTimeout;
    // WHY: Capture chunks are buffered in memory then concatenated. Large responses
    // consume 2x memory. Truncation is NOT safe — downstream adapters parse
    // rawResponse for session IDs/content/tokens; truncated JSON breaks them silently.
    // Instead: skip capture entirely when exceeded. Infinity = no limit (default).
    this._maxCaptureSize = maxCaptureSize;
    this._server = null;
  }

  async start() {
    this._server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });

    await new Promise((resolve, reject) => {
      this._server.listen(this._configPort, 'localhost', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    this.port = this._server.address().port;
  }

  async stop() {
    if (!this._server) return;
    await new Promise((resolve) => this._server.close(resolve));
    this._server = null;
  }

  _handleRequest(req, res) {
    // WHY: /health on the proxy port (not UI port) because the proxy is the
    // critical path — if it's down, agents can't work. Checked before body
    // buffering to avoid wasting the read. Does not conflict with UPSTREAM_MAP
    // prefixes (/anthropic, /openai, /google). Reserved path.
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    // WHY: Without an error listener, a client disconnect during body upload
    // emits an unhandled 'error' → process crash → all agent traffic dies.
    // No peer cleanup needed here — body read is local to this request.
    req.on('error', (err) => {
      if (err.code !== 'ECONNRESET') {
        console.error('[proxy] client request error:', err.code, err.message);
      }
    });

    const requestChunks = [];
    req.on('data', chunk => { requestChunks.push(chunk); });
    req.on('end', () => {
      const requestBody = Buffer.concat(requestChunks);
      this._forwardRequest(req, requestBody, res);
    });
  }

  _forwardRequest(req, requestBody, res) {
    let targetHost, targetPort, useTls, forwardPath;

    const prefixMatch = this._upstreamEntries.find(([prefix]) => req.url.startsWith(prefix));

    if (prefixMatch) {
      const [prefix, upstream] = prefixMatch;
      targetHost = upstream.host;
      targetPort = upstream.port;
      useTls = upstream.tls;
      forwardPath = req.url.slice(prefix.length) || '/';
    } else {
      // Fallback: only honor explicit x-forwarded-host (not bare host header)
      const hostHeader = req.headers['x-forwarded-host'];

      if (!hostHeader) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Unknown route. Use /anthropic, /openai, or /google path prefix.' }));
        return;
      }

      const protocol = req.headers['x-target-protocol'] || 'https';
      const [hostname, portStr] = hostHeader.split(':');
      targetHost = hostname;
      targetPort = portStr ? parseInt(portStr, 10) : (protocol === 'https' ? 443 : 80);
      useTls = protocol === 'https';
      forwardPath = req.url;
    }

    // Build forwarded headers, scrubbing sensitive values
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['x-forwarded-host'];
    delete forwardHeaders['x-target-protocol'];
    forwardHeaders['host'] = targetHost;

    const options = {
      hostname: targetHost,
      port: targetPort,
      path: forwardPath,
      method: req.method,
      headers: forwardHeaders,
    };

    const timestamp = new Date().toISOString();
    const scrubbedHeaders = scrubHeaders(forwardHeaders);
    const scrubbedRequestBody = this._scrubBodyKeys(requestBody.toString());

    const transport = useTls ? https : http;

    const upstreamReq = transport.request(options, (upstreamRes) => {
      // Clear TTFB timeout — headers arrived, stream is alive (see constructor for rationale)
      if (this._upstreamTimeout) upstreamReq.setTimeout(0);

      // WHY: upstreamRes.pipe(res) has zero error handlers by default. A client
      // disconnect or upstream stream failure emits 'error' on the pipe. With no
      // listener, Node throws → process crash → all agent traffic dies.
      //
      // Each handler cleans up its peer stream:
      // - upstreamRes error → destroy res (client gets abrupt close, correct signal)
      // - res error → destroy upstreamReq (stop reading from upstream)
      //
      // If upstreamRes errors mid-stream, the 'end' event may not fire but chunks
      // are partially accumulated. streamErrored prevents storing partial responses
      // as if they were complete — garbage in DB is worse than no capture.
      let streamErrored = false;

      upstreamRes.on('error', (err) => {
        streamErrored = true;
        if (err.code !== 'ECONNRESET') {
          console.error('[proxy] upstream response error:', err.code, err.message);
        }
        if (!res.destroyed) res.destroy();
      });

      res.on('error', (err) => {
        if (err.code !== 'ECONNRESET' && err.code !== 'ERR_STREAM_DESTROYED') {
          console.error('[proxy] client response error:', err.code, err.message);
        }
        if (!upstreamReq.destroyed) upstreamReq.destroy();
      });

      // Pipe raw bytes directly to client (preserves gzip/br encoding)
      if (upstreamRes.statusCode >= 400) {
        console.warn(`[proxy] upstream ${upstreamRes.statusCode} ${req.method} ${forwardPath}`);
      }
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);

      // Separately accumulate raw bytes for capture (need to decompress for storage)
      const chunks = [];
      let captureSize = 0;
      let captureSkipped = false;
      upstreamRes.on('data', chunk => {
        if (captureSkipped) return;
        captureSize += chunk.length;
        if (captureSize > this._maxCaptureSize) {
          captureSkipped = true;
          chunks.length = 0; // free accumulated memory
          console.warn(`[proxy] capture skipped: response exceeds ${this._maxCaptureSize} bytes (path=${forwardPath})`);
          return;
        }
        chunks.push(chunk);
      });
      upstreamRes.on('end', () => {
        // Partial or oversized data corrupts downstream adapters — skip capture
        if (streamErrored || captureSkipped) return;

        const rawBuffer = Buffer.concat(chunks);
        const encoding = upstreamRes.headers['content-encoding'];
        const decode = encoding === 'gzip' ? zlib.gunzip
          : encoding === 'br' ? zlib.brotliDecompress
          : encoding === 'deflate' ? zlib.inflate
          : null;

        // WHY: onCapture runs after response piping completes. If it throws
        // synchronously → uncaughtException. If it returns a rejected promise →
        // unhandledRejection. Both would trigger the process-level safety net
        // and kill the process. But this is a known code path, not an unknown bug.
        // Promise.resolve().then() catches both sync throws and async rejections.
        // Capture is best-effort — log, don't crash.
        const emitCapture = (body) => {
          setImmediate(() => {
            Promise.resolve().then(() => this.onCapture({
              timestamp,
              host: targetHost,
              path: forwardPath,
              method: req.method,
              requestHeaders: scrubbedHeaders,
              rawRequest: scrubbedRequestBody,
              rawResponse: body,
              statusCode: upstreamRes.statusCode,
            })).catch((err) => {
              console.error('[proxy] capture error:', err.message ?? err);
            });
          });
        };

        if (decode) {
          // WHY: Decompression failure used to fall back to rawBuffer.toString(),
          // passing raw gzip/brotli binary as UTF-8 into the pipeline. This is
          // garbage that every adapter fails to parse silently. Binary garbage in
          // the DB is worse than no capture. Skip capture entirely on failure.
          decode(rawBuffer, (err, decoded) => {
            if (err) {
              console.error(`[proxy] decompression failed: ${err.message} encoding=${encoding} path=${forwardPath} size=${rawBuffer.length}`);
              return;
            }
            emitCapture(decoded.toString());
          });
        } else {
          emitCapture(rawBuffer.toString());
        }
      });
    });

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Bad gateway', detail: err.message }));
      } else if (!res.destroyed) {
        res.destroy();
      }
    });

    // TTFB timeout: if upstream never sends response headers (API outage, DNS
    // black hole), destroy the request and send 504. Cleared inside response
    // callback once headers arrive — safe for long-running SSE streams.
    if (this._upstreamTimeout) {
      upstreamReq.setTimeout(this._upstreamTimeout, () => {
        upstreamReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504);
          res.end(JSON.stringify({ error: 'Gateway timeout' }));
        }
      });
    }

    if (requestBody.length) upstreamReq.write(requestBody);
    upstreamReq.end();
  }

  _scrubBodyKeys(body) {
    if (!body) return body;
    try {
      const parsed = JSON.parse(body);
      // Scrub any top-level key that looks like an API key
      for (const key of Object.keys(parsed)) {
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')) {
          parsed[key] = '[REDACTED]';
        }
      }
      return JSON.stringify(parsed);
    } catch {
      return body;
    }
  }
}
