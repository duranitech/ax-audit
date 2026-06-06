import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFetcher } from '../dist/fetcher.js';

/**
 * Integration tests for the fetcher against a real local HTTP server,
 * exercising header merging, per-header caching, and error handling.
 */
describe('fetcher', () => {
  let server;
  let baseUrl;
  let requests;

  before(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push({ url: req.url, headers: req.headers });
      if (req.url === '/negotiate') {
        const accept = req.headers['accept'] ?? '';
        if (accept.includes('text/markdown')) {
          res.writeHead(200, { 'Content-Type': 'text/markdown', Vary: 'Accept' });
          res.end('# Markdown');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html', Vary: 'Accept' });
        res.end('<html><body>HTML</body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should send the default User-Agent and Accept headers', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/plain`);
    assert.equal(requests.length, 1);
    assert.match(requests[0].headers['user-agent'], /^ax-audit\//);
    assert.ok(requests[0].headers['accept'].includes('text/html'));
  });

  it('should replace the default Accept with a custom one (case-insensitive merge)', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/custom-accept`, { headers: { accept: 'text/markdown' } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers['accept'], 'text/markdown');
    // The default User-Agent must survive a partial override.
    assert.match(requests[0].headers['user-agent'], /^ax-audit\//);
  });

  it('should cache repeated requests for the same URL and headers', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/cached`);
    await fetcher.fetch(`${baseUrl}/cached`);
    assert.equal(requests.length, 1);
  });

  it('should cache requests with identical custom headers regardless of casing or order', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/multi`, { headers: { Accept: 'text/markdown', 'X-Probe': '1' } });
    await fetcher.fetch(`${baseUrl}/multi`, { headers: { 'x-probe': '1', accept: 'text/markdown' } });
    assert.equal(requests.length, 1);
  });

  it('should NOT share cache entries between different Accept headers (Vary semantics)', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    const html = await fetcher.fetch(`${baseUrl}/negotiate`);
    const md = await fetcher.fetch(`${baseUrl}/negotiate`, { headers: { Accept: 'text/markdown' } });
    assert.equal(requests.length, 2);
    assert.ok(html.headers['content-type'].includes('text/html'));
    assert.ok(md.headers['content-type'].includes('text/markdown'));
    assert.equal(md.body, '# Markdown');
  });

  it('should treat an empty headers object the same as no options', async () => {
    requests.length = 0;
    const fetcher = createFetcher();
    await fetcher.fetch(`${baseUrl}/empty-opts`);
    await fetcher.fetch(`${baseUrl}/empty-opts`, { headers: {} });
    assert.equal(requests.length, 1);
  });

  it('should return a status-0 error response on connection failure', async () => {
    // Port 1 is reserved and never listening locally.
    const fetcher = createFetcher({ timeout: 2000 });
    const res = await fetcher.fetch('http://127.0.0.1:1/unreachable');
    assert.equal(res.status, 0);
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });

  it('should cache error responses per URL+headers key', async () => {
    const fetcher = createFetcher({ timeout: 2000 });
    const first = await fetcher.fetch('http://127.0.0.1:1/unreachable');
    const second = await fetcher.fetch('http://127.0.0.1:1/unreachable');
    assert.equal(first, second);
  });

  it('should lowercase response header names', async () => {
    const fetcher = createFetcher();
    const res = await fetcher.fetch(`${baseUrl}/negotiate`);
    assert.ok('content-type' in res.headers);
    assert.ok('vary' in res.headers);
  });
});
