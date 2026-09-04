import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/llms-txt.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('llms-txt', () => {
  it('should return score 0 when /llms.txt is not found', async () => {
    const ctx = mockContext();
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.equal(result.findings[0].status, 'fail');
  });

  it('should return score 100 for a fully compliant llms.txt', async () => {
    const body = [
      '# Example Corp',
      '',
      '> A company that does things.',
      '',
      '## Products',
      '',
      '- [Product A](https://example.com/a)',
      '- [Product B](https://example.com/b)',
      '',
      '## About',
      '',
      'We are a company with many products and services that span across multiple domains.',
    ].join('\n');

    const ctx = mockContext({
      '/llms.txt': mockResponse({ body, headers: { 'content-type': 'text/plain; charset=utf-8' } }),
      '/llms-full.txt': mockResponse({ body: body + '\n\nMore details...' }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should warn on wrong Content-Type for /llms.txt', async () => {
    const body = '# Title\n\n> Description\n\n## Section\n\n[Link](https://example.com)\n\nFiller content here.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body, headers: { 'content-type': 'text/html' } }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Content-Type')));
  });

  it('should warn on missing Content-Type for /llms.txt', async () => {
    const body = '# Title\n\n> Description\n\n## Section\n\n[Link](https://example.com)\n\nFiller content here.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body, headers: {} }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Content-Type')));
  });

  it('should penalize missing H1 heading', async () => {
    const body = '> Description\n\n## Section\n\n[Link](https://example.com)\n\nSome filler content to pass the length check easily here.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('H1')));
  });

  it('should penalize missing blockquote', async () => {
    const body = '# Title\n\n## Section\n\n[Link](https://example.com)\n\nSome filler content to pass the length check easily here.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('blockquote')));
  });

  it('should penalize missing section headings', async () => {
    const body = '# Title\n\n> Description\n\n[Link](https://example.com)\n\nSome filler content to pass the length check easily here.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('section')));
  });

  it('should penalize missing links', async () => {
    const body = '# Title\n\n> Description\n\n## Section\n\nSome filler content to pass the length check easily here without any links.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('link')));
  });

  it('should penalize minimal content', async () => {
    const body = '# Hi\n\n> Short';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('minimal')));
  });

  it('should give bonus for llms-full.txt but cap at 100', async () => {
    const body = '# Title\n\n> Description of things.\n\n## Section\n\n[Link](https://example.com)\n\nSome filler content that is long enough to pass checks.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
      '/llms-full.txt': mockResponse({ body: 'full content' }),
    });
    const result = await check(ctx);
    assert.ok(result.score <= 100);
    assert.ok(result.findings.some(f => f.message.includes('llms-full.txt') && f.status === 'pass'));
  });

  it('should never return score above 100', async () => {
    const body = '# Title\n\n> Desc block.\n\n## Section\n\n[Link](https://example.com/page)\n\nContent that is definitely long enough to pass the minimum character requirement for this test.';
    const ctx = mockContext({
      '/llms.txt': mockResponse({ body }),
      '/llms-full.txt': mockResponse({ body: 'full' }),
    });
    const result = await check(ctx);
    assert.ok(result.score <= 100);
  });
});

describe('llms-txt: v2 features and link health', () => {
  const GOOD = [
    '# Acme',
    '',
    '> Everything Acme does, for agents.',
    '',
    '## Docs',
    '',
    '- [Getting started](https://example.com/docs/start)',
    '- [API](https://example.com/docs/api)',
  ].join('\n');

  const TXT_HEADERS = { 'content-type': 'text/plain' };

  function ctx({ body = GOOD, routes = {}, html = '', headers = {} } = {}) {
    return mockContext(
      {
        '/llms.txt': mockResponse({ body, headers: TXT_HEADERS }),
        'https://example.com/docs/start': mockResponse({ body: 'ok' }),
        'https://example.com/docs/api': mockResponse({ body: 'ok' }),
        ...routes,
      },
      { html, headers },
    );
  }

  it('should confirm sampled links resolve', async () => {
    const result = await check(ctx());
    assert.ok(result.findings.some((f) => f.message.includes('2 sampled link(s) resolve')));
  });

  it('should fail broken links without changing the score', async () => {
    const result = await check(
      ctx({ routes: { 'https://example.com/docs/api': mockResponse({ status: 404, ok: false, body: '' }) } }),
    );
    const finding = result.findings.find((f) => f.message.includes('sampled llms.txt link(s) are broken'));
    assert.ok(finding);
    assert.equal(finding.status, 'fail');
    assert.ok(finding.hint.includes('wastes exactly the budget it was meant to save'));

    const clean = await check(ctx());
    assert.equal(result.score, clean.score, 'a new finding inside a weighted check must be informational in 3.x');
  });

  it('should report redirecting links separately from dead ones', async () => {
    const result = await check(
      ctx({
        routes: {
          'https://example.com/docs/api': mockResponse({
            status: 301,
            ok: false,
            redirectLocation: 'https://example.com/docs/api/v2',
            body: '',
          }),
        },
      }),
    );
    const finding = result.findings.find((f) => f.message.includes('sampled link(s) redirect'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('round trip the agent pays for'));
    assert.ok(!result.findings.some((f) => f.message.includes('are broken')));
  });

  it('should fall back to GET when an origin refuses HEAD', async () => {
    const result = await check(
      ctx({
        routes: {
          'https://example.com/docs/api': (url, options) =>
            options?.method === 'HEAD'
              ? mockResponse({ status: 405, ok: false, body: '' })
              : mockResponse({ body: 'ok' }),
        },
      }),
    );
    assert.ok(!result.findings.some((f) => f.message.includes('are broken')));
  });

  it('should report duplicate links', async () => {
    const body = `${GOOD}\n- [API again](https://example.com/docs/api)`;
    const result = await check(ctx({ body }));
    assert.ok(result.findings.some((f) => f.message.includes('1 duplicate link(s)')));
  });

  it('should detect a describedby relation in the HTML', async () => {
    const result = await check(ctx({ html: '<html><head><link rel="describedby" href="/llms.txt"></head></html>' }));
    assert.ok(result.findings.some((f) => f.message.includes('rel="describedby"') && f.status === 'pass'));
  });

  it('should detect a describedby relation in the Link header', async () => {
    const result = await check(ctx({ headers: { link: '</llms.txt>; rel="describedby"' } }));
    assert.ok(result.findings.some((f) => f.message.includes('Link header') && f.status === 'pass'));
  });

  it('should nudge when nothing points at the llms.txt', async () => {
    const result = await check(ctx());
    const finding = result.findings.find((f) => f.message.includes('No rel="describedby"'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('landed on a deep page'));
  });

  it('should detect a per-page Markdown mirror', async () => {
    const result = await check(ctx({ routes: { '/index.md': mockResponse({ body: '# Acme\n\nContent.' }) } }));
    assert.ok(result.findings.some((f) => f.message.includes('Markdown mirror available at /index.md')));
  });

  it('should not accept an HTML shell as a Markdown mirror', async () => {
    const result = await check(ctx({ routes: { '/index.md': mockResponse({ body: '<!doctype html><html></html>' }) } }));
    assert.ok(result.findings.some((f) => f.message.includes('No per-page Markdown mirror')));
  });

  it('should warn about an oversized index', async () => {
    const body = `${GOOD}\n${'filler text. '.repeat(5000)}`;
    const result = await check(ctx({ body }));
    const finding = result.findings.find((f) => f.message.includes('KB'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('competes with the content it points at'));
  });

  it('should state plainly who reads this file', async () => {
    const result = await check(ctx());
    const finding = result.findings.find((f) => f.message.includes('Consumer note'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('Search ignores llms.txt'));
    assert.ok(finding.detail.includes('Claude Code'));
  });

  it('should keep the 3.6 scoring exactly', async () => {
    const result = await check(
      mockContext({
        '/llms.txt': mockResponse({ body: GOOD, headers: TXT_HEADERS }),
        '/llms-full.txt': mockResponse({ body: '# Acme full' }),
      }),
    );
    assert.equal(result.score, 100, 'H1 + blockquote + sections + links + llms-full bonus');
  });
});
