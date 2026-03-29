import http from 'node:http';

const SCRUBBED_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key'];

function scrubHeaders(headers) {
  const scrubbed = { ...headers };
  for (const key of SCRUBBED_HEADERS) {
    if (scrubbed[key]) scrubbed[key] = '[REDACTED]';
  }
  return scrubbed;
}

export class Proxy {
  constructor({ port = 8080, onCapture = () => {} } = {}) {
    this._configPort = port;
    this.port = null;
    this.onCapture = onCapture;
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
    // Determine target from x-forwarded-host header or host
    const targetHost = req.headers['x-forwarded-host'] || req.headers['host'];
    const protocol = req.headers['x-target-protocol'] || 'https';

    if (!targetHost) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing target host' }));
      return;
    }

    const [hostname, portStr] = targetHost.split(':');
    const port = portStr ? parseInt(portStr, 10) : (protocol === 'https' ? 443 : 80);

    // Build forwarded headers, scrubbing sensitive values
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['x-forwarded-host'];
    delete forwardHeaders['x-target-protocol'];
    forwardHeaders['host'] = targetHost;

    const options = {
      hostname,
      port,
      path: req.url,
      method: req.method,
      headers: forwardHeaders,
    };

    const timestamp = new Date().toISOString();
    const scrubbedHeaders = scrubHeaders(forwardHeaders);
    const scrubbedRequestBody = this._scrubBodyKeys(requestBody);

    const upstreamReq = http.request(options, (upstreamRes) => {
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
            host: hostname,
            path: req.url,
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
