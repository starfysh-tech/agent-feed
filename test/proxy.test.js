import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Proxy, UPSTREAM_RULES, LEGACY_PREFIXES } from '../src/proxy/index.js';

function proxyRequest(proxyPort, { path = '/', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: proxyPort,
      path,
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...headers },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Helper: send request with Anthropic-style headers routed to a test upstream
function makeAnthropicRequest(proxyPort, path = '/', body = null) {
  return proxyRequest(proxyPort, {
    path,
    body,
    headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-ant-test' },
  });
}

// Spin up a fake upstream that echoes JSON. Pass a custom handler for special behavior.
async function createFakeUpstream(handler) {
  const defaultHandler = (req, res) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_ok' }));
    });
  };
  const server = http.createServer(handler ?? defaultHandler);
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  return {
    port: server.address().port,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

// Build test config that routes to a local fake upstream
function testRules(targetPort) {
  return [
    { match: (h) => !!h['anthropic-version'], host: 'localhost', port: targetPort, tls: false },
    { match: (h) => !!h['x-goog-api-key'],   host: 'localhost', port: targetPort, tls: false },
    { match: () => true,                      host: 'localhost', port: targetPort, tls: false },
  ];
}

function testLegacyPrefixes(targetPort) {
  return {
    '/anthropic': { host: 'localhost', port: targetPort, tls: false },
    '/openai':    { host: 'localhost', port: targetPort, tls: false },
    '/google':    { host: 'localhost', port: targetPort, tls: false },
  };
}

describe('Proxy', () => {
  let proxy;
  let targetServer;
  let targetPort;
  let capturedRequests;

  before(async () => {
    capturedRequests = [];

    // Spin up a fake upstream API server
    targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        capturedRequests.push({ path: req.url, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_test123',
          content: [{ type: 'text', text: 'test response' }],
          model: 'claude-test',
          usage: { input_tokens: 10, output_tokens: 20 },
        }));
      });
    });

    await new Promise(resolve => targetServer.listen(0, 'localhost', resolve));
    targetPort = targetServer.address().port;

    proxy = new Proxy({ port: 0, onCapture: () => {}, upstreamRules: testRules(targetPort), legacyPrefixes: testLegacyPrefixes(targetPort) });
    await proxy.start();
  });

  after(async () => {
    await proxy.stop();
    await new Promise(resolve => targetServer.close(resolve));
  });

  it('forwards requests to the target and returns the response', async () => {
    const res = await makeAnthropicRequest(
      proxy.port,
      '/v1/messages',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] }
    );
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.id, 'msg_test123');
  });

  it('calls onCapture with request and response data', async () => {
    const captures = [];
    const capturingProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamRules: testRules(targetPort),
    });
    await capturingProxy.start();

    await makeAnthropicRequest(
      capturingProxy.port,
      '/v1/messages',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] }
    );

    await capturingProxy.stop();

    assert.equal(captures.length, 1);
    assert.ok(captures[0].host);
    assert.ok(captures[0].rawResponse);
    assert.ok(captures[0].timestamp);
  });

  it('scrubs authorization header from captured data', async () => {
    const captures = [];
    const capturingProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamRules: testRules(targetPort),
    });
    await capturingProxy.start();

    await proxyRequest(capturingProxy.port, {
      path: '/v1/messages',
      body: { model: 'claude-test' },
      headers: {
        'anthropic-version': '2023-06-01',
        'authorization': 'Bearer sk-ant-supersecret',
        'x-api-key': 'sk-ant-supersecret',
      },
    });

    await capturingProxy.stop();

    assert.equal(captures.length, 1);
    const captured = captures[0];
    assert.ok(!captured.rawRequest?.includes('supersecret'));
    assert.ok(!JSON.stringify(captured.requestHeaders ?? {}).includes('supersecret'));
  });

  it('returns 502 when target is unreachable', async () => {
    const unreachableProxy = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamRules: [{ match: () => true, host: 'localhost', port: 19999, tls: false }],
    });
    await unreachableProxy.start();

    const res = await makeAnthropicRequest(unreachableProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res.status, 502);

    await unreachableProxy.stop();
  });

  it('routes by header and passes path through unchanged', async () => {
    const beforeCount = capturedRequests.length;

    await makeAnthropicRequest(
      proxy.port,
      '/v1/messages',
      { model: 'claude-test' }
    );

    const newRequests = capturedRequests.slice(beforeCount);
    assert.equal(newRequests.length, 1);
    assert.equal(newRequests[0].path, '/v1/messages');
  });

  it('sets capture host to upstream hostname', async () => {
    const captures = [];
    const headerProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamRules: testRules(targetPort),
    });
    await headerProxy.start();

    await makeAnthropicRequest(
      headerProxy.port,
      '/v1/messages',
      { model: 'claude-test' }
    );

    await headerProxy.stop();

    assert.equal(captures.length, 1);
    assert.equal(captures[0].host, 'localhost');
    assert.equal(captures[0].path, '/v1/messages');
  });

  it('routes OpenAI requests (no anthropic-version header) via fallback', async () => {
    const res = await proxyRequest(proxy.port, {
      path: '/v1/responses',
      body: { model: 'gpt-4o', input: 'hello' },
      headers: { 'authorization': 'Bearer sk-test' },
    });
    assert.equal(res.status, 200);
  });

  it('routes Google requests by x-goog-api-key header', async () => {
    const res = await proxyRequest(proxy.port, {
      path: '/v1beta/models/gemini:generateContent',
      body: { contents: [{ parts: [{ text: 'hello' }] }] },
      headers: { 'x-goog-api-key': 'test-key' },
    });
    assert.equal(res.status, 200);
  });

  it('legacy prefix routing strips prefix and forwards to correct upstream', async () => {
    const beforeCount = capturedRequests.length;

    // Simulate a request from an old session with /anthropic prefix
    const res = await proxyRequest(proxy.port, {
      path: '/anthropic/v1/messages',
      body: { model: 'claude-test' },
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-ant-test' },
    });

    assert.equal(res.status, 200);
    // Verify the upstream received /v1/messages (prefix stripped)
    const newRequests = capturedRequests.slice(beforeCount);
    assert.equal(newRequests.length, 1);
    assert.equal(newRequests[0].path, '/v1/messages');
  });

  it('exports UPSTREAM_RULES with expected entries', () => {
    assert.ok(Array.isArray(UPSTREAM_RULES));
    assert.ok(UPSTREAM_RULES.length >= 3);
    const anthropic = UPSTREAM_RULES.find(r => r.host === 'api.anthropic.com');
    assert.ok(anthropic);
    assert.equal(anthropic.tls, true);
  });

  it('exports LEGACY_PREFIXES with expected entries', () => {
    assert.ok(LEGACY_PREFIXES['/anthropic']);
    assert.equal(LEGACY_PREFIXES['/anthropic'].host, 'api.anthropic.com');
    assert.ok(LEGACY_PREFIXES['/openai']);
    assert.ok(LEGACY_PREFIXES['/google']);
  });
});

describe('Proxy resilience', () => {
  it('survives client disconnect mid-response', async () => {
    // Fake upstream that slow-drips a response
    const slowServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const interval = setInterval(() => res.write('x'), 30);
        setTimeout(() => { clearInterval(interval); res.end(); }, 300);
      });
    });
    await new Promise(resolve => slowServer.listen(0, 'localhost', resolve));
    const slowPort = slowServer.address().port;

    const resilientProxy = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamRules: [{ match: () => true, host: 'localhost', port: slowPort, tls: false }],
    });
    await resilientProxy.start();

    // Connect and immediately destroy the client socket after first data
    await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: resilientProxy.port,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        res.once('data', () => { req.destroy(); });
        res.on('error', () => {}); // expected — we destroyed the socket
      });
      req.on('error', () => {}); // expected
      req.write(JSON.stringify({ model: 'test' }));
      req.end();
      // Give it time to process the disconnect
      setTimeout(resolve, 200);
    });

    // Proxy must still serve new requests
    const res = await makeAnthropicRequest(resilientProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res.status, 200);

    await resilientProxy.stop();
    await new Promise(resolve => slowServer.close(resolve));
  });

  it('survives upstream drop mid-stream and skips partial capture', async () => {
    // Fake upstream that sends headers + partial body, then kills the socket
    const dropServer = await createFakeUpstream((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('partial');
        setTimeout(() => req.socket.destroy(), 30);
      });
    });
    const dropPort = dropServer.port;

    const captures = [];
    const resilientProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamRules: [{ match: () => true, host: 'localhost', port: dropPort, tls: false }],
    });
    await resilientProxy.start();

    // This request will get a partial response then upstream dies
    await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: resilientProxy.port,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
        res.on('error', () => resolve()); // upstream dropped — expect error
      });
      req.on('error', () => resolve());
      req.write(JSON.stringify({ model: 'test' }));
      req.end();
    });

    // Wait for any setImmediate capture to fire
    await new Promise(r => setTimeout(r, 100));

    // Proxy must still serve new requests
    const normal = await createFakeUpstream();
    const proxy2 = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamRules: [{ match: () => true, host: 'localhost', port: normal.port, tls: false }],
    });
    await proxy2.start();
    const res = await makeAnthropicRequest(proxy2.port, '/v1/messages', { model: 'test' });
    assert.equal(res.status, 200);

    // streamErrored flag should have prevented partial capture
    assert.equal(captures.length, 0, 'partial capture should be skipped');

    await resilientProxy.stop();
    await proxy2.stop();
    await dropServer.close();
    await normal.close();
  });

  it('returns 504 when upstream never responds (TTFB timeout)', async () => {
    // Fake upstream that accepts connections but never sends a response
    const hang = await createFakeUpstream(() => { /* silence */ });
    const hangPort = hang.port;

    const timeoutProxy = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamTimeout: 200, // 200ms TTFB timeout
      upstreamRules: [{ match: () => true, host: 'localhost', port: hangPort, tls: false }],
    });
    await timeoutProxy.start();

    const start = Date.now();
    const res = await makeAnthropicRequest(timeoutProxy.port, '/v1/messages', { model: 'test' });
    const elapsed = Date.now() - start;

    assert.equal(res.status, 504);
    assert.ok(elapsed < 2000, `should timeout quickly, took ${elapsed}ms`);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error.includes('timeout'));

    // Proxy must still serve — verify with a normal upstream
    const ok = await createFakeUpstream();
    const proxy2 = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamRules: [{ match: () => true, host: 'localhost', port: ok.port, tls: false }],
    });
    await proxy2.start();
    const res2 = await makeAnthropicRequest(proxy2.port, '/v1/messages', { model: 'test' });
    assert.equal(res2.status, 200);

    await timeoutProxy.stop();
    await proxy2.stop();
    await hang.close();
    await ok.close();
  });

  it('survives onCapture that throws synchronously', async () => {
    const upstream = await createFakeUpstream();
    const throwProxy = new Proxy({
      port: 0,
      onCapture: () => { throw new Error('capture boom'); },
      upstreamRules: [{ match: () => true, host: 'localhost', port: upstream.port, tls: false }],
    });
    await throwProxy.start();

    const res1 = await makeAnthropicRequest(throwProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res1.status, 200);

    // Wait for setImmediate + Promise to settle
    await new Promise(r => setTimeout(r, 100));

    // Proxy must still be alive
    const res2 = await makeAnthropicRequest(throwProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res2.status, 200);

    await throwProxy.stop();
    await upstream.close();
  });

  it('survives onCapture that returns a rejected promise', async () => {
    const upstream = await createFakeUpstream();
    const rejectProxy = new Proxy({
      port: 0,
      onCapture: () => Promise.reject(new Error('async capture boom')),
      upstreamRules: [{ match: () => true, host: 'localhost', port: upstream.port, tls: false }],
    });
    await rejectProxy.start();

    const res1 = await makeAnthropicRequest(rejectProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res1.status, 200);

    await new Promise(r => setTimeout(r, 100));

    const res2 = await makeAnthropicRequest(rejectProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res2.status, 200);

    await rejectProxy.stop();
    await upstream.close();
  });

  it('skips capture when response exceeds maxCaptureSize', async () => {
    const bigBody = 'x'.repeat(200);
    const big = await createFakeUpstream((req, res) => {
      let b = '';
      req.on('data', c => { b += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(bigBody);
      });
    });

    const captures = [];
    const cappedProxy = new Proxy({
      port: 0,
      maxCaptureSize: 100,
      onCapture: (data) => captures.push(data),
      upstreamRules: [{ match: () => true, host: 'localhost', port: big.port, tls: false }],
    });
    await cappedProxy.start();

    const res = await makeAnthropicRequest(cappedProxy.port, '/data', { x: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body, bigBody);

    await new Promise(r => setTimeout(r, 100));
    assert.equal(captures.length, 0, 'capture should be skipped when oversized');

    await cappedProxy.stop();
    await big.close();
  });

  it('skips capture on decompression failure instead of storing garbage', async () => {
    const bad = await createFakeUpstream((req, res) => {
      let b = '';
      req.on('data', c => { b += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        res.end('this is not gzip data');
      });
    });

    const captures = [];
    const decomProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamRules: [{ match: () => true, host: 'localhost', port: bad.port, tls: false }],
    });
    await decomProxy.start();

    const res = await makeAnthropicRequest(decomProxy.port, '/v1/messages', { model: 'test' });
    assert.equal(res.status, 200);

    await new Promise(r => setTimeout(r, 100));
    assert.equal(captures.length, 0, 'capture should be skipped on decompression failure');

    await decomProxy.stop();
    await bad.close();
  });

  it('responds to GET /health with status and uptime', async () => {
    const healthProxy = new Proxy({ port: 0 });
    await healthProxy.start();

    const res = await proxyRequest(healthProxy.port, { path: '/health' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime, 'number');
    assert.ok(body.uptime >= 0);

    await healthProxy.stop();
  });

  it('preserves multi-byte request bodies split across chunks', async () => {
    // Build a JSON body containing multi-byte UTF-8 characters (emoji = 4 bytes each)
    const originalBody = JSON.stringify({ text: '🔥🎉🚀 hello 你好世界' });
    const originalBuffer = Buffer.from(originalBody);

    // Record what the upstream actually receives (raw bytes)
    let receivedBody = null;
    const echoServer = await createFakeUpstream((req, res) => {
      const chunks = [];
      req.on('data', c => { chunks.push(c); });
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_ok' }));
      });
    });

    const testProxy = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamRules: [{ match: () => true, host: 'localhost', port: echoServer.port, tls: false }],
    });
    await testProxy.start();

    // Send the body as deliberately split chunks that break multi-byte sequences.
    // Find an emoji boundary and split there mid-character.
    const splitPoint = originalBody.indexOf('🎉');
    const byteOffset = Buffer.from(originalBody.slice(0, splitPoint)).length + 2; // mid-emoji

    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: testProxy.port,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': originalBuffer.length,
        },
      }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      // Write two chunks that split a multi-byte character
      req.write(originalBuffer.subarray(0, byteOffset));
      req.write(originalBuffer.subarray(byteOffset));
      req.end();
    });

    await testProxy.stop();
    await echoServer.close();

    // The upstream must receive the exact original bytes
    assert.ok(receivedBody, 'upstream should have received a body');
    assert.ok(
      receivedBody.equals(originalBuffer),
      `byte mismatch: sent ${originalBuffer.length} bytes, upstream got ${receivedBody.length} bytes`
    );
  });

  it('proxies WebSocket upgrade requests to upstream', async () => {
    // Create a fake upstream that accepts WebSocket upgrades and echoes
    const net = await import('node:net');
    const wsUpstream = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        // Wait for full HTTP upgrade request
        if (!buf.includes('\r\n\r\n')) return;
        // Send 101 response
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        // After upgrade, echo any further data
        buf = '';
        socket.on('data', (data) => { socket.write(data); });
      });
    });
    await new Promise(resolve => wsUpstream.listen(0, 'localhost', resolve));
    const wsPort = wsUpstream.address().port;

    const wsProxy = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamRules: [{ match: () => true, host: 'localhost', port: wsPort, tls: false }],
    });
    await wsProxy.start();

    // Connect via raw socket and send a WebSocket upgrade
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(wsProxy.port, 'localhost', () => {
        socket.write(
          'GET /v1/responses HTTP/1.1\r\n' +
          'Host: localhost\r\n' +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          '\r\n'
        );
      });

      let response = '';
      let upgraded = false;
      socket.on('data', (chunk) => {
        response += chunk.toString();
        if (!upgraded && response.includes('\r\n\r\n')) {
          upgraded = true;
          // 101 received, send echo test
          socket.write('ping');
        } else if (upgraded && response.includes('ping')) {
          socket.destroy();
          resolve({ response: response.split('\r\n')[0], echoed: true });
        }
      });
      socket.on('error', reject);
      setTimeout(() => { socket.destroy(); reject(new Error('WebSocket test timed out')); }, 5000);
    });

    assert.ok(result.response.includes('101'), 'should receive 101 Switching Protocols');
    assert.ok(result.echoed, 'data should echo through the proxy');

    await wsProxy.stop();
    await new Promise(resolve => wsUpstream.close(resolve));
  });
});
