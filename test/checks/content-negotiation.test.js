import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { meta } from '../../dist/checks/content-negotiation.js';
import { mockContext, mockResponse } from '../helpers.js';

const HTML_PAGE = '<!doctype html><html><head><title>Example</title></head><body><main>Hello world</main></body></html>';
const MARKDOWN_BODY = '# Example\n\nHello world. [Docs](https://example.com/docs)\n';

/** Build a responder that serves Markdown when the request asks for it, HTML otherwise. */
function negotiatingServer({ markdownHeaders = {}, markdownBody = MARKDOWN_BODY } = {}) {
  return (url, fetchOptions) => {
    const accept = fetchOptions?.headers?.Accept ?? fetchOptions?.headers?.accept ?? '';
    if (accept.includes('text/markdown')) {
      return mockResponse({
        body: markdownBody,
        headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept', ...markdownHeaders },
        url,
      });
    }
    return mockResponse({ body: HTML_PAGE, headers: { 'content-type': 'text/html' }, url });
  };
}

describe('content-negotiation', () => {
  it('should have weight 0 (informational) in 3.x', () => {
    assert.equal(meta.weight, 0);
  });

  it('should probe with the Accept header a real agent sends', async () => {
    let seenAccept = null;
    const ctx = mockContext(
      {
        'https://example.com': (url, fetchOptions) => {
          // The check makes several probes; only the first is the Accept probe.
          seenAccept ??= fetchOptions?.headers?.Accept ?? null;
          return mockResponse({ body: HTML_PAGE, headers: { 'content-type': 'text/html' }, url });
        },
      },
      { html: HTML_PAGE },
    );
    await check(ctx);
    // Claude Code, Cursor and OpenCode all send a q-weighted list with HTML as
    // the fallback. Probing with a bare `text/markdown` would pass against a
    // negotiation implementation that fails every real request.
    assert.ok(seenAccept.startsWith('text/markdown'));
    assert.ok(seenAccept.includes('text/html;q='), 'the probe must include the HTML fallback a real client sends');
  });

  it('should score 100 for proper negotiation with Vary: Accept', async () => {
    const ctx = mockContext({ 'https://example.com': negotiatingServer() }, { html: HTML_PAGE });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('content negotiation')));
  });

  it('should report token-efficiency when Markdown is smaller than HTML', async () => {
    const ctx = mockContext({ 'https://example.com': negotiatingServer() }, { html: HTML_PAGE });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('lighter')));
  });

  it('should warn when Markdown is not smaller than HTML', async () => {
    const bloated = `# Example\n\n${'x'.repeat(HTML_PAGE.length * 2)}\n`;
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownBody: bloated }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('not smaller')));
    // Size is informational — it must not affect the score.
    assert.equal(result.score, 100);
  });

  it('should warn and deduct when Vary lacks Accept', async () => {
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownHeaders: { vary: 'Accept-Encoding' } }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Vary')));
  });

  it('should warn and deduct when the Vary header is missing entirely', async () => {
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownHeaders: { vary: '' } }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 85);
  });

  it('should accept Vary: * as varying on Accept', async () => {
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownHeaders: { vary: '*' } }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should match Vary header case-insensitively within a list', async () => {
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownHeaders: { vary: 'Accept-Encoding, ACCEPT' } }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should warn when text/markdown response is actually an HTML document', async () => {
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownBody: HTML_PAGE }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 75);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('HTML document')));
  });

  it('should not flag Markdown containing inline HTML as an HTML document', async () => {
    const inlineHtml = '# Title\n\nSome text with <strong>inline</strong> HTML and <img src="x.png" alt="x">.\n';
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownBody: inlineHtml }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should warn when the Markdown body is empty', async () => {
    const ctx = mockContext(
      { 'https://example.com': negotiatingServer({ markdownBody: '   \n' }) },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 70);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('empty')));
  });

  it('should score 0 when the server ignores Accept and returns HTML', async () => {
    const ctx = mockContext(
      {
        'https://example.com': mockResponse({ body: HTML_PAGE, headers: { 'content-type': 'text/html' } }),
      },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('does not serve Markdown')));
  });

  it('should mention HTTP 406 in the failure detail when the server rejects the Accept header', async () => {
    const ctx = mockContext(
      {
        'https://example.com': mockResponse({
          status: 406,
          ok: false,
          body: '',
          headers: { 'content-type': 'text/plain' },
        }),
      },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.detail?.includes('406')));
  });

  it('should give partial credit for a <link rel="alternate" type="text/markdown"> fallback', async () => {
    const htmlWithAlternate = HTML_PAGE.replace(
      '</head>',
      '<link rel="alternate" type="text/markdown" href="/index.md"></head>',
    );
    const ctx = mockContext(
      {
        'https://example.com': mockResponse({ body: htmlWithAlternate, headers: { 'content-type': 'text/html' } }),
      },
      { html: htmlWithAlternate },
    );
    const result = await check(ctx);
    assert.equal(result.score, 40);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('alternate')));
  });

  it('should not credit alternate links of other types', async () => {
    const htmlWithRss = HTML_PAGE.replace(
      '</head>',
      '<link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>',
    );
    const ctx = mockContext(
      {
        'https://example.com': mockResponse({ body: htmlWithRss, headers: { 'content-type': 'text/html' } }),
      },
      { html: htmlWithRss },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
  });

  it('should fail with score 0 on network error', async () => {
    const ctx = mockContext(
      {
        'https://example.com': mockResponse({ status: 0, ok: false, body: '', error: 'Request timed out' }),
      },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.detail === 'Request timed out'));
  });

  it('should not treat a markdown response with non-2xx status as negotiated', async () => {
    const ctx = mockContext(
      {
        'https://example.com': mockResponse({
          status: 500,
          ok: false,
          body: MARKDOWN_BODY,
          headers: { 'content-type': 'text/markdown' },
        }),
      },
      { html: HTML_PAGE },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
  });

  it('should clamp score within [0,100]', async () => {
    const ctx = mockContext({ 'https://example.com': negotiatingServer() }, { html: HTML_PAGE });
    const result = await check(ctx);
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});

describe('content-negotiation: extended reporting', () => {
  const MARKDOWN = '---\ntitle: Acme\ncanonical_url: https://example.com/\nlast_updated: 2026-09-01\n---\n\n# Acme\n\nContent.';
  const MD_HEADERS = { 'content-type': 'text/markdown', vary: 'Accept' };

  function negotiating(extraHeaders = {}, body = MARKDOWN) {
    return mockContext(
      {
        'https://example.com': (url, fetchOptions) => {
          const accept = fetchOptions?.headers?.Accept ?? '';
          if (accept.includes('text/markdown')) {
            return mockResponse({ body, headers: { ...MD_HEADERS, ...extraHeaders }, url });
          }
          return mockResponse({ body: '<html><body>HTML</body></html>', headers: { 'content-type': 'text/html' }, url });
        },
      },
      { html: '<html><body>' + 'x'.repeat(2000) + '</body></html>' },
    );
  }

  it('should prefer the origin-reported token counts over a byte ratio', async () => {
    const result = await check(negotiating({ 'x-markdown-tokens': '500', 'x-original-tokens': '4000' }));
    const finding = result.findings.find((f) => f.message.includes('tokens against'));
    assert.ok(finding);
    assert.ok(finding.message.includes('88% saved'));
    assert.ok(finding.detail.includes('x-markdown-tokens'));
  });

  it('should fall back to comparing sizes when no token counts are given', async () => {
    const result = await check(negotiating());
    assert.ok(result.findings.some((f) => f.message.includes('lighter than the HTML representation')));
  });

  it('should warn when the origin reports no saving', async () => {
    const result = await check(negotiating({ 'x-markdown-tokens': '4000', 'x-original-tokens': '4000' }));
    const finding = result.findings.find((f) => f.message.includes('tokens against'));
    assert.equal(finding.status, 'warn');
  });

  it('should report the frontmatter fields that make a quotation attributable', async () => {
    const result = await check(negotiating());
    const finding = result.findings.find((f) => f.message.includes('frontmatter carries'));
    assert.ok(finding);
    assert.ok(finding.message.includes('title'));
    assert.ok(finding.message.includes('canonical_url'));
    assert.ok(finding.message.includes('last_updated'));
  });

  it('should warn when the Markdown carries no frontmatter', async () => {
    const result = await check(negotiating({}, '# Acme\n\nContent.'));
    const finding = result.findings.find((f) => f.message.includes('no frontmatter'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('cannot attribute what it quotes'));
  });

  it('should warn about frontmatter with nothing attributable in it', async () => {
    const result = await check(negotiating({}, '---\nlayout: docs\n---\n\n# Acme'));
    assert.ok(result.findings.some((f) => f.message.includes('carries no title, canonical URL or date')));
  });

  it('should note a canonical Link header on the Markdown response', async () => {
    const result = await check(negotiating({ link: '<https://example.com/>; rel="canonical"' }));
    assert.ok(result.findings.some((f) => f.message.includes('canonical Link header')));
  });

  it('should detect user-agent negotiation when Accept negotiation fails', async () => {
    const ctx = mockContext(
      {
        'https://example.com': (url, fetchOptions) => {
          const ua = fetchOptions?.headers?.['User-Agent'] ?? '';
          if (ua.includes('Claude-Code')) {
            return mockResponse({ body: MARKDOWN, headers: { 'content-type': 'text/markdown' }, url });
          }
          return mockResponse({ body: '<html></html>', headers: { 'content-type': 'text/html' }, url });
        },
      },
      { html: '<html></html>' },
    );
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('recognised agent user agent'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('whose user agent you have never seen'));
  });

  it('should detect a .md suffix URL when negotiation fails', async () => {
    const ctx = mockContext(
      {
        '/index.md': mockResponse({ body: MARKDOWN, headers: { 'content-type': 'text/markdown' } }),
        'https://example.com': mockResponse({ body: '<html></html>', headers: { 'content-type': 'text/html' } }),
      },
      { html: '<html></html>' },
    );
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('suffix URL /index.md'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('second request'));
  });
});
