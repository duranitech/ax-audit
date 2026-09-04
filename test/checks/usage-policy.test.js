import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { fromContentSignal, fromContentUsage, fromRsl } from '../../dist/checks/usage-policy.js';
import { mockContext, mockResponse } from '../helpers.js';

const RSL_DOC = (permits = 'search ai-input', prohibits = 'ai-train') => `<?xml version="1.0"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content url="/">
    <license>
      <permits type="usage">${permits}</permits>
      <prohibits type="usage">${prohibits}</prohibits>
    </license>
  </content>
</rsl>`;

function ctx({ robots = 'User-agent: *\nAllow: /', html = '<html><head></head><body></body></html>', headers = {}, routes = {} } = {}) {
  return mockContext({ '/robots.txt': mockResponse({ body: robots }), ...routes }, { html, headers });
}

describe('usage-policy: normalising each vocabulary', () => {
  it('should map Content Signals onto the three dimensions', () => {
    const d = fromContentSignal('search=yes, ai-input=yes, ai-train=no', 'x');
    assert.equal(d.index, 'allow');
    assert.equal(d.ground, 'allow');
    assert.equal(d.train, 'deny');
  });

  it('should map AIPREF and leave grounding unstated, since it has no such category', () => {
    const d = fromContentUsage('train-ai=n, search=y', 'x');
    assert.equal(d.train, 'deny');
    assert.equal(d.index, 'allow');
    assert.equal(d.ground, 'unstated');
  });

  it('should ignore a Content Signals token written under Content-Usage', () => {
    const d = fromContentUsage('ai-train=no', 'x');
    assert.equal(d.train, 'unstated', 'the wrong vocabulary states nothing at all');
  });

  it('should map RSL permits and prohibits', () => {
    const d = fromRsl(RSL_DOC(), 'x');
    assert.equal(d.index, 'allow');
    assert.equal(d.ground, 'allow');
    assert.equal(d.train, 'deny');
  });

  it('should expand the RSL ai-all and all tokens', () => {
    const aiAll = fromRsl(RSL_DOC('', 'ai-all'), 'x');
    assert.equal(aiAll.train, 'deny');
    assert.equal(aiAll.ground, 'deny');
    assert.equal(aiAll.index, 'unstated', 'ai-all covers AI uses, not search indexing');

    const all = fromRsl(RSL_DOC('all', ''), 'x');
    assert.equal(all.train, 'allow');
    assert.equal(all.ground, 'allow');
    assert.equal(all.index, 'allow');
  });

  it('should ignore RSL permits scoped to user or geo rather than usage', () => {
    const doc = RSL_DOC().replace('type="usage">search ai-input', 'type="user">commercial');
    assert.equal(fromRsl(doc, 'x').index, 'unstated');
  });

  it('should ignore RSL elements inside XML comments', () => {
    const doc = RSL_DOC().replace('</rsl>', '<!-- <permits type="usage">ai-train</permits> --></rsl>');
    assert.equal(fromRsl(doc, 'x').train, 'deny', 'the commented permit must not flip the prohibition');
  });
});

describe('usage-policy: collection', () => {
  it('should report when nothing is declared', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 40);
    const finding = result.findings.find((f) => f.message.includes('No machine-readable usage policy'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('Absence is neutral, not permission'));
  });

  it('should find Content-Signal in robots.txt', async () => {
    const result = await check(ctx({ robots: 'User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /' }));
    assert.ok(result.findings.some((f) => f.message.includes('1 usage declaration')));
    assert.equal(result.score, 100);
  });

  it('should find the Content-Usage response header', async () => {
    const result = await check(ctx({ headers: { 'content-usage': 'train-ai=n' } }));
    const finding = result.findings.find((f) => f.message.includes('usage declaration'));
    assert.ok(finding.detail.includes('Content-Usage response header'));
  });

  it('should flag a bad vocabulary in the Content-Usage header', async () => {
    const result = await check(ctx({ headers: { 'content-usage': 'ai-train=no' } }));
    assert.ok(result.findings.some((f) => f.message.includes('outside the AIPREF vocabulary')));
  });

  it('should find the Cloudflare content-signal response header', async () => {
    const result = await check(ctx({ headers: { 'content-signal': 'ai-train=yes, search=yes, ai-input=yes' } }));
    assert.ok(result.findings.some((f) => f.detail?.includes('content-signal response header')));
  });

  it('should find an RSL licence through robots.txt', async () => {
    const result = await check(
      ctx({
        robots: 'License: https://example.com/license.xml\nUser-agent: *\nAllow: /',
        routes: { '/license.xml': mockResponse({ body: RSL_DOC(), headers: { 'content-type': 'application/rsl+xml' } }) },
      }),
    );
    assert.ok(result.findings.some((f) => f.detail?.includes('RSL licence')));
  });

  it('should find an RSL licence through an HTML link', async () => {
    const result = await check(
      ctx({
        html: '<html><head><link rel="license" type="application/rsl+xml" href="/license.xml"></head></html>',
        routes: { '/license.xml': mockResponse({ body: RSL_DOC() }) },
      }),
    );
    assert.ok(result.findings.some((f) => f.detail?.includes('RSL licence')));
  });

  it('should read a TDM reservation from the well-known file', async () => {
    const result = await check(
      ctx({
        routes: {
          '/.well-known/tdmrep.json': mockResponse({
            body: JSON.stringify([{ location: '/', 'tdm-reservation': 1 }]),
          }),
        },
      }),
    );
    assert.ok(result.findings.some((f) => f.detail?.includes('tdmrep.json')));
    assert.ok(result.findings.some((f) => f.message.includes('training on your content is denied')));
  });

  it('should let a meta tag take precedence over the header and the file', async () => {
    const result = await check(
      ctx({
        html: '<html><head><meta name="tdm-reservation" content="0"></head></html>',
        headers: { 'tdm-reservation': '1' },
        routes: { '/.well-known/tdmrep.json': mockResponse({ body: JSON.stringify([{ location: '/', 'tdm-reservation': 1 }]) }) },
      }),
    );
    const finding = result.findings.find((f) => f.message.includes('usage declaration'));
    assert.ok(finding.detail.includes('<meta name="tdm-reservation">'));
    assert.ok(!finding.detail.includes('tdmrep.json'));
  });

  it('should read a noai meta directive as a training denial', async () => {
    const result = await check(ctx({ html: '<html><head><meta name="robots" content="noai"></head></html>' }));
    assert.ok(result.findings.some((f) => f.detail?.includes('noai')));
    assert.ok(result.findings.some((f) => f.message.includes('training on your content is denied')));
  });
});

describe('usage-policy: consistency', () => {
  it('should flag a contradiction between robots.txt and an RSL licence', async () => {
    const result = await check(
      ctx({
        robots: 'License: https://example.com/license.xml\nUser-agent: *\nContent-Signal: ai-train=yes\nAllow: /',
        routes: { '/license.xml': mockResponse({ body: RSL_DOC('search', 'ai-train') }) },
      }),
    );
    const finding = result.findings.find((f) => f.message.includes('disagree about training'));
    assert.ok(finding, 'a site cannot both permit and prohibit training');
    assert.equal(finding.status, 'fail');
    assert.ok(finding.detail.includes('Permitted by'));
    assert.ok(finding.detail.includes('Denied by'));
    assert.equal(result.score, 75);
  });

  it('should flag a contradiction between a Content-Signal and a TDM reservation', async () => {
    const result = await check(
      ctx({
        robots: 'User-agent: *\nContent-Signal: ai-train=yes\nAllow: /',
        routes: { '/.well-known/tdmrep.json': mockResponse({ body: JSON.stringify([{ location: '/', 'tdm-reservation': 1 }]) }) },
      }),
    );
    assert.ok(result.findings.some((f) => f.message.includes('disagree about training')));
  });

  it('should deduct once per contradicting dimension', async () => {
    const result = await check(
      ctx({
        robots: 'License: https://example.com/license.xml\nUser-agent: *\nContent-Signal: ai-train=yes, search=yes\nAllow: /',
        routes: { '/license.xml': mockResponse({ body: RSL_DOC('', 'ai-train search') }) },
      }),
    );
    assert.equal(result.score, 50, 'two dimensions disagree');
  });

  it('should confirm agreement across mechanisms', async () => {
    const result = await check(
      ctx({
        robots: 'License: https://example.com/license.xml\nUser-agent: *\nContent-Signal: ai-train=no, search=yes, ai-input=yes\nAllow: /',
        routes: { '/license.xml': mockResponse({ body: RSL_DOC('search ai-input', 'ai-train') }) },
      }),
    );
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Consistent across 2 declaration(s)')));
  });

  it('should not treat an unstated dimension as a contradiction', async () => {
    const result = await check(ctx({ robots: 'User-agent: *\nContent-Usage: train-ai=n\nAllow: /' }));
    assert.equal(result.score, 100);
    assert.ok(!result.findings.some((f) => f.status === 'fail'));
  });

  it('should note the dimensions nothing covers', async () => {
    const result = await check(ctx({ robots: 'User-agent: *\nContent-Usage: train-ai=n\nAllow: /' }));
    const finding = result.findings.find((f) => f.message.includes('No declaration covers'));
    assert.ok(finding);
    assert.ok(finding.message.includes('grounding'));
    assert.ok(finding.detail.includes('AIPREF has no category for it yet'));
  });

  it('should always state which mechanisms are actually enforced', async () => {
    const result = await check(ctx({ robots: 'User-agent: *\nContent-Signal: ai-train=no\nAllow: /' }));
    const finding = result.findings.find((f) => f.message.includes('Enforcement note'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('legal'));
    assert.ok(finding.detail.includes('EU AI Act'));
  });
});
