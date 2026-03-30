import http from 'node:http';
import https from 'node:https';

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
  constructor({ port = 8080, onCapture = () => {}, upstreamMap = UPSTREAM_MAP } = {}) {
    this._configPort = port;
    this.port = null;
    this.onCapture = onCapture;
    this._upstreamEntries = Object.entries(upstreamMap);
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
    let requestBody = '';
    req.on('data', chunk => { requestBody += chunk; });
    req.on('end', () => {
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
      // Fallback: x-forwarded-host or host header (backward compat)
      const hostHeader = req.headers['x-forwarded-host'] || req.headers['host'];
      const protocol = req.headers['x-target-protocol'] || 'https';

      if (!hostHeader) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing target host' }));
        return;
      }

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
    const scrubbedRequestBody = this._scrubBodyKeys(requestBody);

    const transport = useTls ? https : http;

    const upstreamReq = transport.request(options, (upstreamRes) => {
      let responseBody = '';
      upstreamRes.on('data', chunk => { responseBody += chunk; });
      upstreamRes.on('end', () => {
        // Forward response to original caller
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        res.end(responseBody);

        // Fire capture callback asynchronously
        setImmediate(() => {
          this.onCapture({
            timestamp,
            host: targetHost,
            path: forwardPath,
            method: req.method,
            requestHeaders: scrubbedHeaders,
            rawRequest: scrubbedRequestBody,
            rawResponse: responseBody,
            statusCode: upstreamRes.statusCode,
          });
        });
      });
    });

    upstreamReq.on('error', (err) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Bad gateway', detail: err.message }));
    });

    if (requestBody) upstreamReq.write(requestBody);
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
