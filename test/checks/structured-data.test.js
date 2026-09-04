import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/structured-data.js';
import { mockContext } from '../helpers.js';

describe('structured-data', () => {
  it('should return score 0 when no HTML available', async () => {
    const ctx = mockContext({}, { html: '' });
    const result = await check(ctx);
    assert.equal(result.score, 0);
  });

  it('should return score 0 when no JSON-LD blocks found', async () => {
    const ctx = mockContext({}, { html: '<html><head></head><body>No structured data</body></html>' });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some(f => f.status === 'fail' && f.message.includes('No JSON-LD')));
  });

  it('should score well with comprehensive JSON-LD', async () => {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Example Corp' },
        { '@type': 'WebSite', name: 'Example' },
        { '@type': 'BreadcrumbList', itemListElement: [] },
      ],
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.score >= 90);
  });

  it('should penalize missing @context', async () => {
    const jsonLd = { '@type': 'Organization', name: 'Test' };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('@context')));
  });

  it('should accept https://schema.org/ with trailing slash', async () => {
    const jsonLd = { '@context': 'https://schema.org/', '@type': 'Organization', name: 'Test' };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('@context')));
  });

  it('should accept http://schema.org', async () => {
    const jsonLd = { '@context': 'http://schema.org', '@type': 'Organization', name: 'Test' };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('@context')));
  });

  it('should penalize missing @graph', async () => {
    const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Test' };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('@graph')));
  });

  it('should detect key entity types in @graph', async () => {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Person', name: 'John' },
        { '@type': 'WebPage', name: 'Home' },
      ],
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('Person')));
  });

  it('should handle invalid JSON in blocks gracefully', async () => {
    const html = '<html><head><script type="application/ld+json">{invalid json</script></head></html>';
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('Invalid JSON')));
  });

  it('should return 10 when all JSON-LD blocks are invalid', async () => {
    const html = [
      '<html><head>',
      '<script type="application/ld+json">{bad</script>',
      '<script type="application/ld+json">{also bad</script>',
      '</head></html>',
    ].join('');
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.equal(result.score, 10);
  });

  it('should handle HTML entities in JSON-LD', async () => {
    const raw = '{"@context":"https://schema.org","@type":"Organization","name":"A &amp; B"}';
    const html = `<html><head><script type="application/ld+json">${raw}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('JSON-LD block')));
  });

  it('should accept @context as array with schema.org', async () => {
    const jsonLd = { '@context': ['https://schema.org', { '@language': 'en' }], '@type': 'Organization', name: 'Test' };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('@context')));
  });

  it('should accept @context as object with @vocab', async () => {
    const jsonLd = { '@context': { '@vocab': 'https://schema.org/' }, '@type': 'Organization', name: 'Test' };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('@context')));
  });

  it('should detect types in nested entities (author, publisher)', async () => {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Home',
      author: { '@type': 'Person', name: 'John' },
      publisher: { '@type': 'Organization', name: 'Corp' },
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('Person')));
    assert.ok(result.findings.some(f => f.status === 'pass' && f.message.includes('Organization')));
  });

  it('should detect multiple JSON-LD blocks', async () => {
    const block1 = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Test' });
    const block2 = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Test' });
    const html = `<html><head><script type="application/ld+json">${block1}</script><script type="application/ld+json">${block2}</script></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('2 JSON-LD block(s)')));
  });
});

describe('structured-data: provenance and freshness', () => {
  const ld = (data) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body><main>${'Real content here. '.repeat(30)}</main></body></html>`;

  const BASE = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How agents read the web',
    author: { '@type': 'Person', name: 'Ada Lovelace', sameAs: 'https://www.wikidata.org/wiki/Q7259' },
    publisher: { '@type': 'Organization', name: 'Acme' },
    dateModified: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10),
  };

  it('should report authorship and sameAs links', async () => {
    const result = await check(mockContext({}, { html: ld(BASE) }));
    assert.ok(result.findings.some((f) => f.message.includes('Authorship declared: Ada Lovelace')));
    const sameAs = result.findings.find((f) => f.message.includes('sameAs link(s)'));
    assert.ok(sameAs);
    assert.ok(sameAs.detail.includes('wikidata'));
  });

  it('should explain what sameAs is for when it is absent', async () => {
    const { author, ...rest } = BASE;
    void author;
    const result = await check(mockContext({}, { html: ld(rest) }));
    const finding = result.findings.find((f) => f.message === 'No sameAs links');
    assert.ok(finding);
    assert.ok(finding.hint.includes('turns a name into an entity'));
  });

  it('should warn when an author has no publisher', async () => {
    const { publisher, ...rest } = BASE;
    void publisher;
    const result = await check(mockContext({}, { html: ld(rest) }));
    assert.ok(result.findings.some((f) => f.message.includes('Author declared but no publisher')));
  });

  it('should note disambiguating organization detail', async () => {
    const data = { ...BASE, publisher: { '@type': 'Organization', name: 'Acme', legalAddress: 'x' } };
    const result = await check(mockContext({}, { html: ld(data) }));
    assert.ok(result.findings.some((f) => f.message.includes('disambiguating detail')));
  });

  it('should report a recent date as fresh', async () => {
    const result = await check(mockContext({}, { html: ld(BASE) }));
    const finding = result.findings.find((f) => f.message.includes('Content last dated'));
    assert.equal(finding.status, 'pass');
  });

  it('should warn about content over two years old', async () => {
    const old = { ...BASE, dateModified: '2020-01-01' };
    const result = await check(mockContext({}, { html: ld(old) }));
    const finding = result.findings.find((f) => f.message.includes('Content last dated'));
    assert.equal(finding.status, 'warn');
    assert.ok(finding.hint.includes('answering with stale facts'));
  });

  it('should warn about a future date', async () => {
    const future = { ...BASE, dateModified: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) };
    const result = await check(mockContext({}, { html: ld(future) }));
    assert.ok(result.findings.some((f) => f.message.includes('is in the future')));
  });

  it('should warn about an unparseable date', async () => {
    const bad = { ...BASE, dateModified: 'last Tuesday' };
    const result = await check(mockContext({}, { html: ld(bad) }));
    assert.ok(result.findings.some((f) => f.message.includes('not a parseable date')));
  });

  it('should warn when no date is declared at all', async () => {
    const { dateModified, ...rest } = BASE;
    void dateModified;
    const result = await check(mockContext({}, { html: ld(rest) }));
    const finding = result.findings.find((f) => f.message.includes('No dateModified or datePublished'));
    assert.ok(finding.hint.includes('cannot be weighed at all'));
  });

  it('should confirm markup that matches the visible text', async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(BASE)}</script></head><body><main><h1>How agents read the web</h1>${'Content. '.repeat(30)}</main></body></html>`;
    const result = await check(mockContext({}, { html }));
    assert.ok(result.findings.some((f) => f.message.includes('appear in the visible text')));
  });

  it('should flag markup describing a page that is not there', async () => {
    const result = await check(mockContext({}, { html: ld(BASE) }));
    const finding = result.findings.find((f) => f.message.includes('do not appear in the visible text'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('oldest form of spam'));
    assert.ok(finding.hint.includes('rendered by script'), 'the caveat about client rendering must be stated');
  });

  it('should keep every new finding informational in 3.x', async () => {
    // Same entity types and graph shape; only the freshness field differs, so
    // any score delta would have to come from the new findings. Dropping the
    // author or publisher would also drop key entity types, which 3.6 already
    // scored.
    const rich = await check(mockContext({}, { html: ld(BASE) }));
    const { dateModified, ...stripped } = BASE;
    void dateModified;
    const bare = await check(mockContext({}, { html: ld(stripped) }));
    assert.equal(rich.score, bare.score, 'provenance and freshness must not move the score in 3.x');
  });
});
