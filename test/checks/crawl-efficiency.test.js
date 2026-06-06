import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/crawl-efficiency.js';
import { mockContext, mockResponse } from '../helpers.js';

const BODY = '<html><body>'.padEnd(1000, 'x') + '</body></html>';

/**
 * A homepage responder that honors conditional requests.
 * @param {object} opts
 * @param {Record<string,string>} opts.headers - headers on the 200 response
 * @param {boolean} opts.honor304 - return 304 when a conditional header is present
 * @param {string} opts.body - response body
 */
function server({ headers = {}, honor304 = false, body = BODY } = {}) {
  return (url, fetchOptions) => {
    const reqHeaders = fetchOptions?.headers ?? {};
    const conditional = 'If-None-Match' in reqHeaders || 'If-Modified-Since' in reqHeaders;
    if (conditional && honor304) {
      return mockResponse({ status: 304, ok: false, body: '', url });
    }
    return mockResponse({ body, headers, url });
  };
}

function ctxWith(opts) {
  return mockContext({ 'https://example.com': server(opts) });
}

const GOOD_HEADERS = { 'content-encoding': 'br', etag: '"abc123"' };

describe('crawl-efficiency', () => {
  it('should score 100 with Brotli, a working conditional GET, and a small page', async () => {
    const result = await check(ctxWith({ headers: GOOD_HEADERS, honor304: true }));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Brotli')));
    assert.ok(result.findings.some((f) => f.message.includes('304 Not Modified')));
  });

  it('should fail with score 0 when the homepage request fails', async () => {
    const ctx = mockContext({ 'https://example.com': mockResponse({ status: 500, ok: false, body: '' }) });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.status === 'fail'));
  });

  it('should deduct 30 when the response is uncompressed', async () => {
    const result = await check(ctxWith({ headers: { etag: '"x"' }, honor304: true }));
    assert.equal(result.score, 70);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('not compressed')));
  });

  it('should accept gzip but suggest Brotli', async () => {
    const result = await check(ctxWith({ headers: { 'content-encoding': 'gzip', etag: '"x"' }, honor304: true }));
    assert.equal(result.score, 100);
    const finding = result.findings.find((f) => f.message.includes('gzip'));
    assert.equal(finding.status, 'pass');
    assert.ok(finding.detail.includes('Brotli'));
  });

  it('should deduct 30 when there is no cache validator', async () => {
    const result = await check(ctxWith({ headers: { 'content-encoding': 'br' } }));
    assert.equal(result.score, 70);
    assert.ok(result.findings.some((f) => f.message.includes('No ETag or Last-Modified')));
  });

  it('should accept Last-Modified as a validator when ETag is absent', async () => {
    const result = await check(
      ctxWith({ headers: { 'content-encoding': 'br', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' }, honor304: true }),
    );
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Last-Modified')));
  });

  it('should deduct 15 when a validator is present but 304 is not honored', async () => {
    const result = await check(ctxWith({ headers: GOOD_HEADERS, honor304: false }));
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('instead of 304')));
  });

  it('should send both conditional headers when both validators exist', async () => {
    let seen = null;
    const ctx = mockContext({
      'https://example.com': (url, fetchOptions) => {
        const h = fetchOptions?.headers ?? {};
        if ('If-None-Match' in h || 'If-Modified-Since' in h) {
          seen = h;
          return mockResponse({ status: 304, ok: false, body: '', url });
        }
        return mockResponse({ body: BODY, headers: { 'content-encoding': 'br', etag: '"x"', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' }, url });
      },
    });
    await check(ctx);
    assert.equal(seen['If-None-Match'], '"x"');
    assert.equal(seen['If-Modified-Since'], 'Wed, 01 Jan 2025 00:00:00 GMT');
  });

  it('should warn on a very large page', async () => {
    const big = 'x'.repeat(2_100_000);
    const result = await check(ctxWith({ headers: GOOD_HEADERS, honor304: true, body: big }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('very large')));
  });

  it('should warn mildly on a moderately large page', async () => {
    const mid = 'x'.repeat(600_000);
    const result = await check(ctxWith({ headers: GOOD_HEADERS, honor304: true, body: mid }));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('large side')));
  });

  it('should accumulate deductions across dimensions', async () => {
    // Uncompressed (−30), no validator (−30): 40.
    const result = await check(ctxWith({ headers: {} }));
    assert.equal(result.score, 40);
  });

  it('should clamp score within [0,100]', async () => {
    const result = await check(ctxWith({ headers: GOOD_HEADERS, honor304: true }));
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});
