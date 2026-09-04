import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFetcher } from '../dist/fetcher.js';

/**
 * Integration tests for the transport-level fetcher options added in 3.7:
 * HEAD requests, manual redirect handling, timing, and the extended cache key.
 */
describe('fetcher transport options', () => {
  let server;
  let baseUrl;
  let requests;

  before(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push({ url: req.url, method: req.method });

      if (req.url === '/redirect') {
        res.writeHead(301, { Location: '/target' });
        res.end();
        return;
      }
      if (req.url === '/redirect-chain') {
        res.writeHead(302, { Location: '/redirect' });
        res.end();
        return;
      }
      if (req.url === '/target') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('arrived');
        return;
      }
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('slow');
        }, 60);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain', ETag: '"abc"' });
      res.end('body-content');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should issue a HEAD request and return an empty body with headers intact', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    const res = await fetcher.fetch(`${baseUrl}/doc`, { method: 'HEAD' });
    assert.equal(requests[0].method, 'HEAD');
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
    assert.equal(res.headers['etag'], '"abc"');
  });

  it('should cache HEAD and GET separately for the same URL', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/dual`, { method: 'HEAD' });
    const get = await fetcher.fetch(`${baseUrl}/dual`);
    assert.equal(requests.length, 2, 'HEAD must not satisfy a later GET from cache');
    assert.equal(get.body, 'body-content');
  });

  it('should follow redirects by default and mark the response as redirected', async () => {
    const fetcher = createFetcher();
    const res = await fetcher.fetch(`${baseUrl}/redirect`);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'arrived');
    assert.equal(res.redirected, true);
    assert.match(res.url, /\/target$/);
  });

  it('should return the 3xx itself with redirectLocation when redirect is manual', async () => {
    const fetcher = createFetcher();
    const res = await fetcher.fetch(`${baseUrl}/redirect`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.redirectLocation, '/target');
    assert.equal(res.ok, false);
  });

  it('should cache manual and follow redirect modes separately', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/redirect-chain`, { redirect: 'manual' });
    await fetcher.fetch(`${baseUrl}/redirect-chain`);
    // manual: 1 request. follow: chain of 3 (chain -> redirect -> target).
    assert.equal(requests.length, 4);
  });

  it('should report elapsedMs on successful responses', async () => {
    const fetcher = createFetcher();
    const res = await fetcher.fetch(`${baseUrl}/slow`);
    assert.equal(typeof res.elapsedMs, 'number');
    assert.ok(res.elapsedMs >= 50, `expected >=50ms, got ${res.elapsedMs}`);
  });

  it('should report elapsedMs on network failures', async () => {
    const fetcher = createFetcher({ retries: 0 });
    const res = await fetcher.fetch('http://127.0.0.1:1/unreachable');
    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.equal(typeof res.elapsedMs, 'number');
  });

  it('should keep the plain-GET cache key stable (no header/method suffix)', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/stable`);
    await fetcher.fetch(`${baseUrl}/stable`);
    assert.equal(requests.length, 1);
  });
});
