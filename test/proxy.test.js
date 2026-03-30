import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Proxy, UPSTREAM_MAP } from '../src/proxy/index.js';

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

// Backward-compat helper using x-forwarded-host
function makeRequest(proxyPort, targetPort, path = '/', body = null) {
  return proxyRequest(proxyPort, {
    path,
    body,
    headers: { 'x-forwarded-host': `localhost:${targetPort}`, 'x-target-protocol': 'http' },
  });
}

// Path-prefix routing helper
function makePathPrefixRequest(proxyPort, prefix, path = '/', body = null) {
  return proxyRequest(proxyPort, { path: prefix + path, body });
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

    proxy = new Proxy({ port: 0, onCapture: () => {} });
    await proxy.start();
  });

  after(async () => {
    await proxy.stop();
    await new Promise(resolve => targetServer.close(resolve));
  });

  it('forwards requests to the target and returns the response', async () => {
    const res = await makeRequest(
      proxy.port,
      targetPort,
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
    });
    await capturingProxy.start();

    await makeRequest(
      capturingProxy.port,
      targetPort,
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
    });
    await capturingProxy.start();

    const options = {
      hostname: 'localhost',
      port: capturingProxy.port,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-forwarded-host': `localhost:${targetPort}`,
        'x-target-protocol': 'http',
        'content-type': 'application/json',
        'authorization': 'Bearer sk-ant-supersecret',
        'x-api-key': 'sk-ant-supersecret',
      },
    };

    await new Promise((resolve, reject) => {
      const req = http.request(options, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(JSON.stringify({ model: 'claude-test' }));
      req.end();
    });

    await capturingProxy.stop();

    assert.equal(captures.length, 1);
    const captured = captures[0];
    assert.ok(!captured.rawRequest?.includes('supersecret'));
    assert.ok(!JSON.stringify(captured.requestHeaders ?? {}).includes('supersecret'));
  });

  it('returns 502 when target is unreachable', async () => {
    const res = await makeRequest(proxy.port, 19999, '/v1/messages', { model: 'test' });
    assert.equal(res.status, 502);
  });

  it('routes requests using path prefix', async () => {
    const captures = [];
    const prefixProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamMap: {
        '/test': { host: 'localhost', port: targetPort, tls: false },
      },
    });
    await prefixProxy.start();

    const res = await makePathPrefixRequest(
      prefixProxy.port,
      '/test',
      '/v1/messages',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] }
    );

    await prefixProxy.stop();

    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.id, 'msg_test123');
  });

  it('strips path prefix before forwarding', async () => {
    const serverRequests = [];
    const prefixProxy = new Proxy({
      port: 0,
      onCapture: () => {},
      upstreamMap: {
        '/test': { host: 'localhost', port: targetPort, tls: false },
      },
    });
    await prefixProxy.start();

    // Track what path the target server receives via capturedRequests
    const beforeCount = capturedRequests.length;

    await makePathPrefixRequest(
      prefixProxy.port,
      '/test',
      '/v1/messages',
      { model: 'claude-test' }
    );

    await prefixProxy.stop();

    const newRequests = capturedRequests.slice(beforeCount);
    assert.equal(newRequests.length, 1);
    assert.equal(newRequests[0].path, '/v1/messages');
  });

  it('sets capture host to upstream hostname', async () => {
    const captures = [];
    const prefixProxy = new Proxy({
      port: 0,
      onCapture: (data) => captures.push(data),
      upstreamMap: {
        '/test': { host: 'localhost', port: targetPort, tls: false },
      },
    });
    await prefixProxy.start();

    await makePathPrefixRequest(
      prefixProxy.port,
      '/test',
      '/v1/messages',
      { model: 'claude-test' }
    );

    await prefixProxy.stop();

    assert.equal(captures.length, 1);
    assert.equal(captures[0].host, 'localhost');
    assert.equal(captures[0].path, '/v1/messages');
  });

  it('falls back to x-forwarded-host when no prefix matches', async () => {
    const res = await makeRequest(
      proxy.port,
      targetPort,
      '/v1/messages',
      { model: 'claude-test', messages: [{ role: 'user', content: 'hello' }] }
    );
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.id, 'msg_test123');
  });

  it('returns 404 for unrecognized paths without x-forwarded-host', async () => {
    const res = await proxyRequest(proxy.port, {
      path: '/unknown/path',
      body: { test: true },
    });
    assert.equal(res.status, 404);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error.includes('Unknown route'));
  });

  it('exports UPSTREAM_MAP with expected entries', () => {
    assert.ok(UPSTREAM_MAP['/anthropic']);
    assert.equal(UPSTREAM_MAP['/anthropic'].host, 'api.anthropic.com');
    assert.equal(UPSTREAM_MAP['/anthropic'].tls, true);
    assert.ok(UPSTREAM_MAP['/openai']);
    assert.ok(UPSTREAM_MAP['/google']);
  });
});
