import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/http-hygiene.js';
import { mockContext, mockResponse } from '../helpers.js';

const HOME = '<html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><main>Hi</main></body></html>';
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

/**
 * The probe path is random, so route on the prefix and let everything else
 * fall through to the mock's 404.
 */
function ctx({ probe, homepage, head, headers = HTML_HEADERS, html = HOME } = {}) {
  return mockContext(
    {
      '/ax-audit-probe-': probe ?? mockResponse({ status: 404, ok: false, body: 'Not found' }),
      'https://example.com': (url, options) => {
        if (options?.method === 'HEAD') return head ?? mockResponse({ headers, body: '' });
        return homepage ?? mockResponse({ headers, body: html });
      },
    },
    { html, headers },
  );
}

describe('http-hygiene: status honesty', () => {
  it('should pass a site that returns a real 404', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Missing pages return 404')));
  });

  it('should accept 410 for removed pages', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 410, ok: false, body: 'Gone' }) }));
    assert.ok(result.findings.some((f) => f.message.includes('Missing pages return 410')));
  });

  it('should fail a soft 404 served with HTTP 200', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 200, body: '<html><body><h1>404 — page not found</h1></body></html>' }) }));
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding);
    assert.ok(finding.message.includes('"page not found" screen is served with HTTP 200'));
    assert.ok(finding.hint.includes('no way to see that this page is an apology'));
    assert.equal(result.score, 70);
  });

  it('should fail a 200 on a nonexistent path even without apology text', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 200, body: '<html><body>' + 'content '.repeat(200) + '</body></html>' }) }));
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding.message.includes('returns HTTP 200'));
    assert.equal(result.score, 70);
  });

  it('should warn when a missing page redirects to the homepage', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 302, ok: false, redirectLocation: '/', body: '' }) }));
    const finding = result.findings.find((f) => f.message.includes('redirects (302) instead of returning 404'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('believes it arrived'));
    assert.equal(result.score, 80);
  });

  it('should treat 403 on an unknown path as defensible but lossy', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 403, ok: false, body: '' }) }));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.hint?.includes('defensible hardening choice')));
  });

  it('should warn about an empty 404 body', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 404, ok: false, body: '' }) }));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('404 responses have an empty body')));
  });

  it('should decline to judge when the probe is challenged', async () => {
    const result = await check(ctx({ probe: mockResponse({ status: 403, ok: false, headers: { 'cf-mitigated': 'challenge' }, body: '' }) }));
    assert.equal(result.score, 100, 'an unverifiable probe must not be scored as a failure');
    assert.ok(result.findings.some((f) => f.message.includes('Could not test 404 handling')));
  });
});

describe('http-hygiene: redirects', () => {
  it('should pass a homepage that answers directly', async () => {
    const result = await check(ctx());
    assert.ok(result.findings.some((f) => f.message.includes('without a redirect')));
  });

  it('should accept a single redirect hop', async () => {
    let calls = 0;
    const c = mockContext(
      {
        '/ax-audit-probe-': mockResponse({ status: 404, ok: false, body: 'x' }),
        'https://example.com': (url, options) => {
          if (options?.method === 'HEAD') return mockResponse({ headers: HTML_HEADERS, body: '' });
          if (options?.redirect === 'manual' && calls++ === 0) {
            return mockResponse({ status: 301, ok: false, redirectLocation: 'https://example.com/en', body: '' });
          }
          return mockResponse({ headers: HTML_HEADERS, body: HOME });
        },
      },
      { html: HOME, headers: HTML_HEADERS },
    );
    const result = await check(c);
    assert.ok(result.findings.some((f) => f.message.includes('after 1 redirect')));
    assert.equal(result.score, 100);
  });

  it('should warn about a long redirect chain', async () => {
    const hops = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];
    let i = 0;
    const c = mockContext(
      {
        '/ax-audit-probe-': mockResponse({ status: 404, ok: false, body: 'x' }),
        'https://example.com': (url, options) => {
          if (options?.method === 'HEAD') return mockResponse({ headers: HTML_HEADERS, body: '' });
          if (options?.redirect === 'manual' && i < hops.length) {
            return mockResponse({ status: 301, ok: false, redirectLocation: hops[i++], body: '' });
          }
          return mockResponse({ headers: HTML_HEADERS, body: HOME });
        },
      },
      { html: HOME, headers: HTML_HEADERS },
    );
    const result = await check(c);
    const finding = result.findings.find((f) => f.message.includes('redirects to answer'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('round trip the agent pays for'));
    assert.equal(result.score, 90);
  });
});

describe('http-hygiene: HEAD and rate limits', () => {
  it('should pass when HEAD works', async () => {
    const result = await check(ctx());
    assert.ok(result.findings.some((f) => f.message.includes('HEAD requests are supported')));
  });

  it('should warn when HEAD is refused', async () => {
    const result = await check(ctx({ head: mockResponse({ status: 405, ok: false, body: '' }) }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('HEAD requests are refused (405)')));
  });

  it('should fail a 429 with no Retry-After', async () => {
    const result = await check(ctx({ head: mockResponse({ status: 429, ok: false, body: '' }) }));
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding);
    assert.ok(finding.message.includes('no Retry-After'));
    assert.equal(result.score, 80);
  });

  it('should warn, not fail, on a 429 that says when to return', async () => {
    const result = await check(ctx({ head: mockResponse({ status: 429, ok: false, headers: { 'retry-after': '30' }, body: '' }) }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Retry-After: 30')));
  });
});

describe('http-hygiene: content typing', () => {
  it('should pass a declared charset', async () => {
    const result = await check(ctx());
    assert.ok(result.findings.some((f) => f.message.includes('with charset')));
  });

  it('should accept a charset declared only in the document', async () => {
    const result = await check(ctx({ headers: { 'content-type': 'text/html' } }));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('declared in the document')));
  });

  it('should warn when no charset is declared anywhere', async () => {
    const html = '<html lang="en"><head><title>T</title></head><body>Hi</body></html>';
    const result = await check(ctx({ headers: { 'content-type': 'text/html' }, html }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.hint?.includes('replacement characters')));
  });

  it('should warn when there is no Content-Type at all', async () => {
    const result = await check(ctx({ headers: {} }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('no Content-Type header')));
  });

  it('should flag a language mismatch between the document and the header', async () => {
    const result = await check(ctx({ headers: { ...HTML_HEADERS, 'content-language': 'fr' } }));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('disagrees with Content-Language')));
  });

  it('should accept a region variant of the same language', async () => {
    const result = await check(ctx({ headers: { ...HTML_HEADERS, 'content-language': 'en-GB' } }));
    assert.equal(result.score, 100);
  });
});
