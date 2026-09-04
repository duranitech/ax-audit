import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { parseLinkHeader } from '../../dist/checks/http-headers.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('http-headers', () => {
  it('should return score 0 when no headers available', async () => {
    const ctx = mockContext({}, { headers: {} });
    const result = await check(ctx);
    assert.equal(result.score, 0);
  });

  it('should score well with all security headers and AI Link headers', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-xss-protection': '1; mode=block',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=()',
      'content-security-policy': "default-src 'self'",
      'link': '<https://example.com/llms.txt>; rel="alternate", <https://example.com/.well-known/agent.json>; rel="alternate"',
    };
    const ctx = mockContext(
      {
        '/agent.json': mockResponse({ headers: { 'access-control-allow-origin': '*' } }),
        '/llms.txt': mockResponse({ headers: { 'x-robots-tag': 'noindex' } }),
      },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.score >= 90);
  });

  it('should penalize missing critical security headers', async () => {
    const headers = {
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ ok: false, status: 404 }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'fail' && f.message.includes('Strict-Transport-Security')));
    assert.ok(result.findings.some(f => f.status === 'fail' && f.message.includes('X-Content-Type-Options')));
  });

  it('should penalize missing Link header', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ ok: false, status: 404 }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('Link header')));
  });

  it('should penalize Link header without AI references', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'link': '<https://example.com/style.css>; rel="stylesheet"',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ ok: false, status: 404 }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('does not reference AI')));
  });

  it('should detect partial Link header (only llms.txt)', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'link': '<https://example.com/llms.txt>; rel="alternate"',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ ok: false, status: 404 }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('llms.txt')));
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('Agent Card')));
  });

  it('should penalize missing CORS on .well-known', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ headers: {} }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('CORS')));
  });

  it('should pass CORS when access-control-allow-origin is present', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ headers: { 'access-control-allow-origin': '*' } }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('CORS')));
  });

  it('should detect X-Robots-Tag noindex on llms.txt', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    };
    const ctx = mockContext(
      {
        '/agent.json': mockResponse({ ok: false, status: 404 }),
        '/llms.txt': mockResponse({ headers: { 'x-robots-tag': 'noindex' } }),
      },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('X-Robots-Tag')));
  });

  it('should clamp score between 0 and 100', async () => {
    const ctx = mockContext(
      { '/agent.json': mockResponse({ ok: false, status: 404 }) },
      { headers: { 'some-random': 'header' } },
    );
    const result = await check(ctx);
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  });

  it('should not false-match llms.txt in non-URL parts of Link header', async () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'link': '<https://example.com/style.css>; rel="alternate"; title="llms.txt info"',
    };
    const ctx = mockContext(
      { '/agent.json': mockResponse({ ok: false, status: 404 }) },
      { headers },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('does not reference AI')));
  });
});

describe('parseLinkHeader', () => {
  it('should return empty array for empty string', () => {
    assert.deepEqual(parseLinkHeader(''), []);
  });

  it('should parse a single Link entry', () => {
    const links = parseLinkHeader('<https://example.com/llms.txt>; rel="alternate"');
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://example.com/llms.txt');
    assert.equal(links[0].params.rel, 'alternate');
  });

  it('should parse multiple comma-separated entries', () => {
    const header = '<https://example.com/llms.txt>; rel="alternate", <https://example.com/agent.json>; rel="describedby"';
    const links = parseLinkHeader(header);
    assert.equal(links.length, 2);
    assert.equal(links[0].url, 'https://example.com/llms.txt');
    assert.equal(links[1].url, 'https://example.com/agent.json');
    assert.equal(links[1].params.rel, 'describedby');
  });

  it('should handle URLs with commas inside angle brackets', () => {
    const header = '<https://example.com/path?a=1,b=2>; rel="alternate", <https://other.com>; rel="next"';
    const links = parseLinkHeader(header);
    assert.equal(links.length, 2);
    assert.equal(links[0].url, 'https://example.com/path?a=1,b=2');
    assert.equal(links[1].url, 'https://other.com');
  });

  it('should handle multiple parameters', () => {
    const header = '<https://example.com/llms.txt>; rel="alternate"; type="text/plain"; title="LLM context"';
    const links = parseLinkHeader(header);
    assert.equal(links.length, 1);
    assert.equal(links[0].params.rel, 'alternate');
    assert.equal(links[0].params.type, 'text/plain');
    assert.equal(links[0].params.title, 'LLM context');
  });

  it('should handle unquoted parameter values', () => {
    const header = '<https://example.com/api>; rel=preload';
    const links = parseLinkHeader(header);
    assert.equal(links.length, 1);
    assert.equal(links[0].params.rel, 'preload');
  });

  it('should skip entries without angle-bracket URLs', () => {
    const header = 'https://example.com/bad; rel="alternate", <https://example.com/good>; rel="next"';
    const links = parseLinkHeader(header);
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://example.com/good');
  });
});

describe('http-headers: Agent Card path migration', () => {
  it('should accept a Link header pointing at the registered agent-card.json path', async () => {
    const ctx = mockContext(
      {},
      {
        headers: {
          link: '</llms.txt>; rel="alternate"; type="text/plain", </.well-known/agent-card.json>; rel="alternate"; type="application/json"',
        },
      },
    );
    const result = await check(ctx);
    assert.ok(
      result.findings.some((f) => f.status === 'pass' && f.message.includes('both llms.txt and the Agent Card')),
      'a site on the current A2A path must not be marked down for it',
    );
  });

  it('should still accept the pre-0.3 agent.json path', async () => {
    const ctx = mockContext(
      {},
      {
        headers: {
          link: '</llms.txt>; rel="alternate", </.well-known/agent.json>; rel="alternate"',
        },
      },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('both llms.txt and the Agent Card')));
  });

  it('should evaluate CORS against the registered card path when it exists', async () => {
    const ctx = mockContext(
      { '/.well-known/agent-card.json': mockResponse({ headers: { 'access-control-allow-origin': '*' } }) },
      { headers: { 'strict-transport-security': 'max-age=31536000' } },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('CORS enabled')));
  });
});

describe('http-headers: discovery relations', () => {
  const SECURE = {
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };

  it('should report the relations a site advertises', async () => {
    const ctx = mockContext(
      {},
      {
        headers: {
          ...SECURE,
          link: [
            '</llms.txt>; rel="describedby"',
            '</.well-known/api-catalog>; rel="api-catalog"',
            '</openapi.json>; rel="service-desc"',
          ].join(', '),
        },
      },
    );
    const result = await check(ctx);
    const finding = result.findings.find(f => f.message.includes('additional discovery relation'));
    assert.ok(finding);
    assert.ok(finding.message.includes('describedby'));
    assert.ok(finding.message.includes('api-catalog'));
    assert.ok(finding.message.includes('service-desc'));
  });

  it('should recognise a markdown alternate as a discovery relation', async () => {
    const ctx = mockContext(
      {},
      { headers: { ...SECURE, link: '</index.md>; rel="alternate"; type="text/markdown"' } },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('alternate (text/markdown)')));
  });

  it('should match a relation inside a multi-valued rel', async () => {
    const ctx = mockContext({}, { headers: { ...SECURE, link: '</llms.txt>; rel="alternate describedby"' } });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('describedby')));
  });

  it('should read the X-Llms-Txt header', async () => {
    const ctx = mockContext({}, { headers: { ...SECURE, 'x-llms-txt': 'https://example.com/llms.txt' } });
    const result = await check(ctx);
    const finding = result.findings.find(f => f.message.includes('X-Llms-Txt'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('https://example.com/llms.txt'));
  });

  it('should explain each relation when none is advertised', async () => {
    const ctx = mockContext({}, { headers: SECURE });
    const result = await check(ctx);
    const finding = result.findings.find(f => f.message.includes('No machine-readable discovery relations'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('RFC 9727'));
    assert.ok(finding.detail.includes('llms.txt v2'));
    assert.ok(finding.hint.includes('does not affect your score'));
  });

  it('should not deduct for missing discovery relations in 3.x', async () => {
    // Both headers reference llms.txt and the Agent Card, so the pre-3.7
    // deductions are identical; only the extra relations differ.
    const withoutExtras = await check(
      mockContext(
        {},
        { headers: { ...SECURE, link: '</llms.txt>; rel="alternate", </.well-known/agent-card.json>; rel="alternate"' } },
      ),
    );
    const withExtras = await check(
      mockContext(
        {},
        {
          headers: {
            ...SECURE,
            link: [
              '</llms.txt>; rel="alternate"',
              '</.well-known/agent-card.json>; rel="alternate"',
              '</.well-known/api-catalog>; rel="api-catalog"',
              '</openapi.json>; rel="service-desc"',
            ].join(', '),
          },
        },
      ),
    );
    assert.equal(withoutExtras.score, 100);
    assert.equal(withExtras.score, 100, 'a new finding inside a weighted check must be informational in 3.x');
    assert.ok(withExtras.findings.some(f => f.message.includes('additional discovery relation')));
  });
});
