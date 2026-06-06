import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/agent-access.js';
import { mockContext, mockResponse } from '../helpers.js';

const FULL_PAGE = `<html><body><main>${'Real content. '.repeat(60)}</main></body></html>`;
const TINY_PAGE = '<html><body>Checking your browser…</body></html>';
const ALLOW_ALL_ROBOTS = 'User-agent: *\nAllow: /';

/**
 * Build a homepage responder that serves per-crawler responses.
 * @param {Record<string, object>} byToken - crawler token → mockResponse overrides
 */
function homepage(byToken = {}) {
  return (url, fetchOptions) => {
    const ua = fetchOptions?.headers?.['User-Agent'] ?? '';
    for (const [token, overrides] of Object.entries(byToken)) {
      if (ua.includes(token)) return mockResponse({ body: FULL_PAGE, url, ...overrides });
    }
    return mockResponse({ body: FULL_PAGE, url });
  };
}

function ctxWith({ byToken = {}, robots = ALLOW_ALL_ROBOTS } = {}) {
  return mockContext(
    {
      '/robots.txt': robots === null ? mockResponse({ status: 404, ok: false }) : mockResponse({ body: robots }),
      'https://example.com': homepage(byToken),
    },
    { html: FULL_PAGE },
  );
}

describe('agent-access', () => {
  it('should score 100 when every crawler UA receives the baseline response', async () => {
    const result = await check(ctxWith());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('equivalent responses')));
  });

  it('should warn and deduct when a crawler allowed by robots.txt is blocked', async () => {
    const result = await check(ctxWith({ byToken: { GPTBot: { status: 403, ok: false, body: '' } } }));
    assert.equal(result.score, 88); // 7/8
    const finding = result.findings.find((f) => f.message.includes('GPTBot'));
    assert.equal(finding.status, 'warn');
    assert.ok(finding.message.includes('allowed in robots.txt'));
    assert.ok(finding.detail.includes('403'));
  });

  it('should treat a network error for a crawler UA as blocked', async () => {
    const result = await check(ctxWith({ byToken: { ClaudeBot: { status: 0, ok: false, body: '' } } }));
    assert.equal(result.score, 88);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('ClaudeBot')));
  });

  it('should not penalize a block that is consistent with an explicit robots.txt Disallow', async () => {
    const robots = ['User-agent: GPTBot', 'Disallow: /', '', 'User-agent: *', 'Allow: /'].join('\n');
    const result = await check(ctxWith({ robots, byToken: { GPTBot: { status: 403, ok: false, body: '' } } }));
    assert.equal(result.score, 100);
    const finding = result.findings.find((f) => f.message.includes('GPTBot'));
    assert.equal(finding.status, 'pass');
    assert.ok(finding.message.includes('consistent'));
  });

  it('should treat a wildcard Disallow as blocking intent for unconfigured crawlers', async () => {
    const robots = 'User-agent: *\nDisallow: /';
    const result = await check(ctxWith({ robots, byToken: { CCBot: { status: 403, ok: false, body: '' } } }));
    assert.equal(result.score, 100);
  });

  it('should consider crawlers unrestricted when robots.txt is missing', async () => {
    const result = await check(ctxWith({ robots: null, byToken: { GPTBot: { status: 403, ok: false, body: '' } } }));
    assert.equal(result.score, 88);
    const finding = result.findings.find((f) => f.message.includes('GPTBot'));
    assert.ok(finding.message.includes('not restricted'));
  });

  it('should warn with half credit when a crawler receives reduced content', async () => {
    const result = await check(ctxWith({ byToken: { PerplexityBot: { body: TINY_PAGE } } }));
    assert.equal(result.score, 94); // 7.5/8
    const finding = result.findings.find((f) => f.message.includes('PerplexityBot'));
    assert.equal(finding.status, 'warn');
    assert.ok(finding.message.includes('reduced content'));
  });

  it('should skip content comparison when the baseline page is too small to judge', async () => {
    const ctx = mockContext(
      {
        '/robots.txt': mockResponse({ body: ALLOW_ALL_ROBOTS }),
        'https://example.com': (url, fetchOptions) => {
          const ua = fetchOptions?.headers?.['User-Agent'] ?? '';
          return mockResponse({ body: ua.includes('GPTBot') ? '<html><body>hi</body></html>' : TINY_PAGE, url });
        },
      },
      { html: TINY_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should fail with score 0 when the baseline request itself fails', async () => {
    const ctx = mockContext({
      '/robots.txt': mockResponse({ body: ALLOW_ALL_ROBOTS }),
      'https://example.com': mockResponse({ status: 500, ok: false, body: '' }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('Baseline')));
  });

  it('should accumulate deductions across multiple blocked crawlers', async () => {
    const result = await check(
      ctxWith({
        byToken: {
          GPTBot: { status: 403, ok: false, body: '' },
          ClaudeBot: { status: 403, ok: false, body: '' },
          PerplexityBot: { body: TINY_PAGE },
        },
      }),
    );
    assert.equal(result.score, 69); // (5 + 0.5) / 8
  });

  it('should probe with a UA containing the crawler token', async () => {
    const seen = [];
    const ctx = mockContext(
      {
        '/robots.txt': mockResponse({ body: ALLOW_ALL_ROBOTS }),
        'https://example.com': (url, fetchOptions) => {
          const ua = fetchOptions?.headers?.['User-Agent'];
          if (ua) seen.push(ua);
          return mockResponse({ body: FULL_PAGE, url });
        },
      },
      { html: FULL_PAGE },
    );
    await check(ctx);
    assert.ok(seen.some((ua) => ua.includes('GPTBot') && ua.startsWith('Mozilla/5.0')));
    assert.ok(seen.some((ua) => ua.includes('Claude-SearchBot')));
  });

  it('should clamp score within [0,100]', async () => {
    const result = await check(ctxWith());
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});
