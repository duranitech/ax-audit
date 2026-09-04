import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { parseDirectives, analyseDataNosnippet } from '../../dist/checks/ai-directives.js';
import { mockContext, mockResponse } from '../helpers.js';

const PAGE = (head = '', body = '<main><h1>Docs</h1><p>Content.</p></main>') =>
  `<html><head><title>T</title>${head}</head><body>${body}</body></html>`;

const ALLOW_ALL = 'User-agent: *\nAllow: /';

function ctx({ html = PAGE(), headers = {}, robots = ALLOW_ALL } = {}) {
  return mockContext({ '/robots.txt': mockResponse({ body: robots }) }, { html, headers });
}

describe('ai-directives: parsing', () => {
  it('should read directives from a robots meta tag', () => {
    const d = parseDirectives(PAGE('<meta name="robots" content="noindex, nofollow">'), {});
    assert.ok(d.tokens.has('noindex'));
    assert.ok(d.tokens.has('nofollow'));
    assert.ok(d.sources[0].includes('robots'));
  });

  it('should read directives from crawler-specific meta tags', () => {
    const d = parseDirectives(PAGE('<meta name="bingbot" content="noarchive">'), {});
    assert.ok(d.tokens.has('noarchive'));
  });

  it('should read the X-Robots-Tag header', () => {
    const d = parseDirectives(PAGE(), { 'x-robots-tag': 'nosnippet' });
    assert.ok(d.tokens.has('nosnippet'));
    assert.ok(d.sources.some((s) => s.includes('X-Robots-Tag')));
  });

  it('should strip a user-agent scope from an X-Robots-Tag value', () => {
    const d = parseDirectives(PAGE(), { 'x-robots-tag': 'googlebot: noindex, bingbot: noarchive' });
    assert.ok(d.tokens.has('noindex'));
    assert.ok(d.tokens.has('noarchive'));
  });

  it('should parse max-snippet without mistaking its colon for a scope', () => {
    const d = parseDirectives(PAGE('<meta name="robots" content="max-snippet:120">'), {});
    assert.equal(d.maxSnippet, 120);
    assert.ok(d.tokens.has('max-snippet'));
  });

  it('should keep the strictest max-snippet when several are declared', () => {
    const d = parseDirectives(PAGE('<meta name="robots" content="max-snippet:200">'), { 'x-robots-tag': 'max-snippet:50' });
    assert.equal(d.maxSnippet, 50);
  });

  it('should treat max-snippet:-1 as unlimited rather than the strictest', () => {
    const d = parseDirectives(PAGE('<meta name="robots" content="max-snippet:-1">'), { 'x-robots-tag': 'max-snippet:100' });
    assert.equal(d.maxSnippet, 100, '-1 means no limit, so it never wins a minimum');
  });

  it('should lowercase and trim tokens', () => {
    const d = parseDirectives(PAGE('<meta name="robots" content="  NoSnippet ,  NOARCHIVE ">'), {});
    assert.ok(d.tokens.has('nosnippet'));
    assert.ok(d.tokens.has('noarchive'));
  });

  it('should return nothing for a page with no directives', () => {
    const d = parseDirectives(PAGE(), {});
    assert.equal(d.tokens.size, 0);
    assert.equal(d.maxSnippet, null);
    assert.deepEqual(d.sources, []);
  });
});

describe('ai-directives: data-nosnippet scope', () => {
  it('should count scoped regions', () => {
    const r = analyseDataNosnippet('<div data-nosnippet>cookies</div><span data-nosnippet>byline</span>');
    assert.equal(r.count, 2);
    assert.equal(r.coversMain, false);
  });

  it('should detect the attribute on main, article or body', () => {
    for (const tag of ['main', 'article', 'body']) {
      assert.equal(analyseDataNosnippet(`<${tag} data-nosnippet>text</${tag}>`).coversMain, true, tag);
    }
  });

  it('should find nothing on a page without the attribute', () => {
    assert.deepEqual(analyseDataNosnippet('<main>text</main>'), { count: 0, coversMain: false });
  });
});

describe('ai-directives: findings', () => {
  it('should pass a page with no restrictions', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('No directive restricts')));
  });

  it('should hard-fail a noindex homepage', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="noindex">') }));
    assert.equal(result.score, 0);
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding.hint.includes('invisible to every search-grounded assistant'));
  });

  it('should treat none as noindex', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="none">') }));
    assert.equal(result.score, 0);
  });

  it('should flag nosnippet as excluding the page from AI Overviews', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="nosnippet">') }));
    const finding = result.findings.find((f) => f.message.includes('AI Overviews and AI Mode'));
    assert.ok(finding);
    assert.equal(result.score, 70);
  });

  it('should treat max-snippet:0 the same as nosnippet', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="max-snippet:0">') }));
    assert.ok(result.findings.some((f) => f.message.includes('same effect as nosnippet')));
    assert.equal(result.score, 70);
  });

  it('should warn on a very short snippet limit but not on a generous one', async () => {
    const short = await check(ctx({ html: PAGE('<meta name="robots" content="max-snippet:40">') }));
    assert.ok(short.findings.some((f) => f.status === 'warn' && f.message.includes('max-snippet:40')));

    const generous = await check(ctx({ html: PAGE('<meta name="robots" content="max-snippet:300">') }));
    assert.ok(generous.findings.some((f) => f.status === 'pass' && f.message.includes('max-snippet:300')));
    assert.equal(generous.score, 100);
  });

  it('should report max-snippet:-1 as no limit', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="max-snippet:-1">') }));
    assert.ok(result.findings.some((f) => f.message.includes('no limit on snippet length')));
    assert.equal(result.score, 100);
  });

  it('should flag noarchive as excluding the page from Copilot grounding', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="noarchive">') }));
    const finding = result.findings.find((f) => f.message.includes('Copilot grounding'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('nocache is the lighter option'));
    assert.equal(result.score, 70);
  });

  it('should treat nocache as the lighter Copilot restriction', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="nocache">') }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('URL, title and snippet')));
  });

  it('should let noarchive supersede nocache rather than deducting twice', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="noarchive, nocache">') }));
    assert.equal(result.score, 70);
  });

  it('should warn when data-nosnippet wraps the main content', async () => {
    const result = await check(ctx({ html: PAGE('', '<main data-nosnippet><h1>Docs</h1></main>') }));
    assert.equal(result.score, 80);
    assert.ok(result.findings.some((f) => f.message.includes('wraps the page’s main content')));
  });

  it('should accept scoped data-nosnippet regions', async () => {
    const result = await check(ctx({ html: PAGE('', '<div data-nosnippet>cookies</div><main><h1>Docs</h1></main>') }));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('scoped exclusions')));
  });

  it('should report noai as a declared preference, not an enforcement', async () => {
    const result = await check(ctx({ html: PAGE('<meta name="robots" content="noai, noimageai">') }));
    const finding = result.findings.find((f) => f.message.includes('noai and noimageai declared'));
    assert.ok(finding);
    assert.equal(finding.status, 'pass');
    assert.ok(finding.detail.includes('No major AI operator documents honoring'));
    assert.equal(result.score, 100, 'a preference nobody honors should not cost points');
  });

  it('should read directives from the X-Robots-Tag header alone', async () => {
    const result = await check(ctx({ headers: { 'x-robots-tag': 'nosnippet' } }));
    assert.equal(result.score, 70);
  });

  it('should fail cleanly when the homepage HTML is unavailable', async () => {
    const result = await check(mockContext({}, { html: '' }));
    assert.equal(result.score, 0);
    assert.ok(result.findings[0].message.includes('HTML unavailable'));
  });
});

describe('ai-directives: the Google-Extended misconception', () => {
  const BLOCK_EXTENDED = 'User-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /';

  it('should explain that blocking Google-Extended does not leave AI Overviews', async () => {
    const result = await check(ctx({ robots: BLOCK_EXTENDED }));
    const finding = result.findings.find((f) => f.message.includes('still eligible for AI Overviews'));
    assert.ok(finding);
    assert.equal(finding.status, 'warn');
    assert.ok(finding.hint.includes('Gemini training'));
    assert.ok(finding.hint.includes('nosnippet'));
  });

  it('should stay quiet when the site also sets a snippet directive', async () => {
    const result = await check(ctx({ robots: BLOCK_EXTENDED, html: PAGE('<meta name="robots" content="nosnippet">') }));
    assert.ok(!result.findings.some((f) => f.message.includes('still eligible for AI Overviews')));
  });

  it('should stay quiet when Google-Extended is allowed', async () => {
    const result = await check(ctx());
    assert.ok(!result.findings.some((f) => f.message.includes('still eligible')));
  });

  it('should stay quiet when robots.txt is unreachable', async () => {
    const c = mockContext({}, { html: PAGE() });
    const result = await check(c);
    assert.ok(!result.findings.some((f) => f.message.includes('still eligible')));
  });
});
