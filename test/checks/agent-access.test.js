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
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('the same page as a regular client')));
  });

  it('should warn and deduct when a crawler allowed by robots.txt is blocked', async () => {
    const result = await check(ctxWith({ byToken: { GPTBot: { status: 403, ok: false, body: '' } } }));
    assert.equal(result.score, 90); // 9/10 probeable core crawlers
    const finding = result.findings.find((f) => f.message.includes('GPTBot'));
    assert.equal(finding.status, 'warn');
    assert.ok(finding.message.includes('allowed in robots.txt'));
    assert.ok(finding.detail.includes('403'));
  });

  it('should treat a network error as unknown rather than as a block', async () => {
    const result = await check(ctxWith({ byToken: { ClaudeBot: { status: 0, ok: false, body: '', error: 'Request timed out' } } }));
    // 9 ok + 1 inconclusive (0.75) = 9.75 / 10
    assert.equal(result.score, 98);
    const finding = result.findings.find((f) => f.message.includes('ClaudeBot probe failed'));
    assert.ok(finding);
    assert.equal(finding.status, 'warn');
    assert.ok(finding.hint.includes('unknown'), 'a failed request proves nothing about access policy');
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
    assert.equal(result.score, 90);
    const finding = result.findings.find((f) => f.message.includes('GPTBot'));
    assert.ok(finding.message.includes('not restricted'));
  });

  it('should warn with half credit when a crawler receives reduced content', async () => {
    const result = await check(ctxWith({ byToken: { PerplexityBot: { body: TINY_PAGE } } }));
    assert.equal(result.score, 95); // 9.5/10
    const finding = result.findings.find((f) => f.message.includes('PerplexityBot'));
    assert.equal(finding.status, 'warn');
    assert.ok(finding.message.includes('a different page than a regular client'));
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
    assert.equal(result.score, 75); // 7.5/10
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

describe('agent-access: probe set', () => {
  it('should never send a robots.txt-only control token as a user agent', async () => {
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

    // Google-Extended and Applebot-Extended govern how a crawled page may be
    // used. No request ever carries them, so probing with them proves nothing.
    for (const tokenOnly of ['Google-Extended', 'Applebot-Extended']) {
      assert.ok(
        !seen.some((ua) => ua.includes(tokenOnly)),
        `${tokenOnly} is a robots.txt control token, not a user agent`,
      );
    }
    assert.ok(seen.some((ua) => ua.includes('GPTBot')));
    assert.ok(seen.some((ua) => ua.includes('Meta-ExternalAgent')), 'the 3.7 catalogue added Meta to the core set');
  });
});

describe('agent-access: response classification', () => {
  it('should report a Cloudflare challenge as a challenge, not as a block', async () => {
    const result = await check(
      ctxWith({ byToken: { GPTBot: { status: 403, ok: false, body: '', headers: { 'cf-mitigated': 'challenge' } } } }),
    );
    const finding = result.findings.find((f) => f.message.includes('GPTBot receives a Cloudflare challenge'));
    assert.ok(finding, 'a challenge and a policy block need different fixes');
    assert.ok(finding.hint.includes('bot-management exception'));
    assert.ok(finding.hint.includes('Web Bot Auth'), 'the caveat about unsigned probes must be stated');
    assert.equal(result.score, 98, 'a challenge earns partial credit, not zero');
  });

  it('should report an AWS WAF challenge served on HTTP 202', async () => {
    const result = await check(
      ctxWith({
        byToken: { ClaudeBot: { status: 202, ok: true, body: '', headers: { 'x-amzn-waf-action': 'challenge' } } },
      }),
    );
    assert.ok(result.findings.some((f) => f.message.includes('ClaudeBot receives a AWS WAF challenge')));
  });

  it('should report pay-per-crawl as priced access, with full credit', async () => {
    const result = await check(
      ctxWith({ byToken: { CCBot: { status: 402, ok: false, body: '', headers: { 'crawler-price': 'USD 0.01' } } } }),
    );
    const finding = result.findings.find((f) => f.message.includes('CCBot is offered priced access'));
    assert.ok(finding);
    assert.equal(finding.status, 'pass');
    assert.ok(finding.message.includes('USD 0.01'));
    assert.equal(result.score, 100, 'monetised is not blocked');
  });

  it('should report an RSL licence challenge as conditional access', async () => {
    const result = await check(
      ctxWith({
        byToken: {
          'OAI-SearchBot': {
            status: 401,
            ok: false,
            body: '',
            headers: { 'www-authenticate': 'License error="invalid_token"' },
          },
        },
      }),
    );
    assert.ok(result.findings.some((f) => f.message.includes('obtain a licence')));
    assert.equal(result.score, 100);
  });

  it('should report a Web Bot Auth requirement as the site working as designed', async () => {
    const result = await check(
      ctxWith({
        byToken: { PerplexityBot: { status: 403, ok: false, body: '', headers: { 'accept-signature': 'sig1=()' } } },
      }),
    );
    const finding = result.findings.find((f) => f.message.includes('Web Bot Auth signature'));
    assert.ok(finding);
    assert.equal(finding.status, 'pass');
  });

  it('should soften a bare 403 from a bot-managing CDN to inconclusive', async () => {
    const result = await check(
      ctxWith({ byToken: { GPTBot: { status: 403, ok: false, body: '', headers: { 'cf-ray': 'abc123' } } } }),
    );
    const finding = result.findings.find((f) => f.message.includes('refused by Cloudflare'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('anti-spoofing'));
    assert.ok(finding.hint.includes('removes you from OpenAI model training') === false);
    assert.equal(result.score, 98);
  });

  it('should keep a bare 403 from a plain origin as a definite block', async () => {
    const result = await check(
      ctxWith({ byToken: { GPTBot: { status: 403, ok: false, body: '', headers: { server: 'nginx' } } } }),
    );
    const finding = result.findings.find((f) => f.message.includes('User-Agent is refused'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('OpenAI model training'), 'the hint should say what this block costs');
    assert.equal(result.score, 90);
  });

  it('should warn when a single probe is rate limited', async () => {
    const result = await check(
      ctxWith({ byToken: { CCBot: { status: 429, ok: false, body: '', headers: { 'retry-after': '3600' } } } }),
    );
    const finding = result.findings.find((f) => f.message.includes('rate limited'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('3600'));
  });

  it('should collect inconclusive probes into one caveat finding', async () => {
    const result = await check(
      ctxWith({
        byToken: {
          GPTBot: { status: 403, ok: false, body: '', headers: { 'cf-mitigated': 'challenge' } },
          ClaudeBot: { status: 403, ok: false, body: '', headers: { 'cf-mitigated': 'challenge' } },
        },
      }),
    );
    const finding = result.findings.find((f) => f.message.includes('could not be settled from outside'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('GPTBot'));
    assert.ok(finding.detail.includes('ClaudeBot'));
  });
});

describe('agent-access: content parity', () => {
  it('should detect a swapped title even when the text volume matches', async () => {
    const baseline = `<html><head><title>Acme Docs</title></head><body><h1>Acme Docs</h1><main>${'Content. '.repeat(60)}</main></body></html>`;
    const cloaked = `<html><head><title>Access Denied</title></head><body><h1>Acme Docs</h1><main>${'Content. '.repeat(60)}</main></body></html>`;
    const ctx = mockContext(
      {
        '/robots.txt': mockResponse({ body: ALLOW_ALL_ROBOTS }),
        'https://example.com': (url, fetchOptions) => {
          const ua = fetchOptions?.headers?.['User-Agent'] ?? '';
          return mockResponse({ body: ua.includes('GPTBot') ? cloaked : baseline, url });
        },
      },
      { html: baseline },
    );
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('different page'));
    assert.ok(finding, 'equal text length must not hide a swapped title');
    assert.ok(finding.detail.includes('title differs'));
  });

  it('should detect structured data stripped for a crawler', async () => {
    const withLd = `<html><head><title>T</title><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>T</h1><main>${'Content. '.repeat(60)}</main></body></html>`;
    const withoutLd = `<html><head><title>T</title></head><body><h1>T</h1><main>${'Content. '.repeat(60)}</main></body></html>`;
    const ctx = mockContext(
      {
        '/robots.txt': mockResponse({ body: ALLOW_ALL_ROBOTS }),
        'https://example.com': (url, fetchOptions) => {
          const ua = fetchOptions?.headers?.['User-Agent'] ?? '';
          return mockResponse({ body: ua.includes('CCBot') ? withoutLd : withLd, url });
        },
      },
      { html: withLd },
    );
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('CCBot receives a different page'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('JSON-LD block(s) missing'));
  });

  it('should not flag parity when the pages match', async () => {
    const result = await check(ctxWith());
    assert.ok(!result.findings.some((f) => f.message.includes('different page')));
    assert.equal(result.score, 100);
  });
});
