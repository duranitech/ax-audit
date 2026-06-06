import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/rsl.js';
import { mockContext, mockResponse } from '../helpers.js';

const VALID_RSL = `<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content url="/">
    <license>
      <permits type="usage">search ai-input</permits>
      <prohibits type="usage">ai-train</prohibits>
      <payment type="attribution">
        <standard>https://example.com/license-terms</standard>
      </payment>
    </license>
  </content>
</rsl>`;

const RSL_HEADERS = { 'content-type': 'application/rsl+xml' };

function rslRoutes({ robots, doc = VALID_RSL, docHeaders = RSL_HEADERS } = {}) {
  const routes = {};
  if (robots !== undefined) routes['/robots.txt'] = mockResponse({ body: robots });
  routes['/license.xml'] = mockResponse({ body: doc, headers: docHeaders });
  return routes;
}

const ROBOTS_WITH_LICENSE = 'License: https://example.com/license.xml\nUser-agent: *\nAllow: /';

describe('rsl', () => {
  it('should score 0 with a fail finding when no discovery mechanism exists', async () => {
    const ctx = mockContext({ '/robots.txt': mockResponse({ body: 'User-agent: *\nAllow: /' }) });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('No RSL license discovery')));
  });

  it('should score 100 for robots.txt discovery with a valid document', async () => {
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE }));
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('robots.txt License directive')));
    assert.ok(result.findings.some((f) => f.message.includes('License terms declared')));
  });

  it('should discover via Link header', async () => {
    const ctx = mockContext(rslRoutes({ robots: 'User-agent: *\nAllow: /' }), {
      headers: { link: '<https://example.com/license.xml>; rel="license"; type="application/rsl+xml"' },
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Link header')));
  });

  it('should discover via HTML link element', async () => {
    const ctx = mockContext(rslRoutes({ robots: 'User-agent: *\nAllow: /' }), {
      html: '<html><head><link rel="license" type="application/rsl+xml" href="https://example.com/license.xml"></head></html>',
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('HTML <link rel="license">')));
  });

  it('should ignore license links without the RSL media type (e.g. CC license links)', async () => {
    const ctx = mockContext(
      { '/robots.txt': mockResponse({ body: 'User-agent: *' }) },
      { html: '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">' },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
  });

  it('should warn when the robots.txt License directive is a relative URI', async () => {
    const ctx = mockContext(rslRoutes({ robots: 'License: /license.xml\nUser-agent: *' }));
    const result = await check(ctx);
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('absolute URI')));
  });

  it('should cap the score when the license document cannot be fetched', async () => {
    const ctx = mockContext({
      '/robots.txt': mockResponse({ body: 'License: https://example.com/missing.xml\nUser-agent: *' }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 25);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('could not be fetched')));
  });

  it('should deduct 5 for a wrong Content-Type', async () => {
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, docHeaders: { 'content-type': 'text/xml' } }));
    const result = await check(ctx);
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Content-Type')));
  });

  it('should fail hard when the root <rsl> element is missing', async () => {
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc: '<licenses><foo/></licenses>' }));
    const result = await check(ctx);
    assert.equal(result.score, 60);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('<rsl>')));
  });

  it('should warn on a wrong or missing namespace', async () => {
    const wrongNs = VALID_RSL.replace('https://rslstandard.org/rsl', 'https://example.com/other');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc: wrongNs }));
    const result = await check(ctx);
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('namespace')));
  });

  it('should warn when no <content> elements exist', async () => {
    const ctx = mockContext(
      rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc: '<rsl xmlns="https://rslstandard.org/rsl"></rsl>' }),
    );
    const result = await check(ctx);
    assert.equal(result.score, 80);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('No <content>')));
  });

  it('should warn when a <content> element lacks the required url attribute', async () => {
    const doc = VALID_RSL.replace('<content url="/">', '<content>');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('url attribute')));
  });

  it('should accept an empty url attribute (legal for pages linked via <link rel="license">)', async () => {
    const doc = VALID_RSL.replace('<content url="/">', '<content url="">');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should warn when <content> has no <license> elements', async () => {
    const doc = `<rsl xmlns="https://rslstandard.org/rsl"><content url="/"></content></rsl>`;
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('No <license>')));
  });

  it('should warn on permits tokens outside the usage vocabulary', async () => {
    const doc = VALID_RSL.replace('search ai-input', 'search ai-everything');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 95);
    const finding = result.findings.find((f) => f.message.includes('outside the RSL vocabulary'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('ai-everything'));
  });

  it('should warn on an invalid permits type attribute', async () => {
    const doc = VALID_RSL.replace('type="usage">search ai-input', 'type="purpose">search ai-input');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('invalid type attribute')));
  });

  it('should validate geo tokens as ISO 3166-1 alpha-2 codes', async () => {
    const doc = VALID_RSL.replace(
      '<permits type="usage">search ai-input</permits>',
      '<permits type="geo">US EU usa</permits>',
    );
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 95);
    const finding = result.findings.find((f) => f.message.includes('outside the RSL vocabulary'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('usa'));
  });

  it('should warn on an invalid payment type', async () => {
    const doc = VALID_RSL.replace('type="attribution"', 'type="donation"');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 95);
    const finding = result.findings.find((f) => f.message.includes('payment element'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('donation'));
  });

  it('should ignore directives and elements inside XML comments', async () => {
    const doc = VALID_RSL.replace('</rsl>', '<!-- <permits type="bogus">nope</permits> --></rsl>');
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE, doc }));
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should report multiple discovery mechanisms together', async () => {
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE }), {
      headers: { link: '<https://example.com/license.xml>; rel="license"; type="application/rsl+xml"' },
      html: '<link rel="license" type="application/rsl+xml" href="https://example.com/license.xml">',
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    const finding = result.findings.find((f) => f.message.includes('RSL license discovered'));
    assert.ok(finding.message.includes('robots.txt License directive'));
    assert.ok(finding.message.includes('Link header'));
    assert.ok(finding.message.includes('HTML <link rel="license">'));
  });

  it('should clamp score within [0,100]', async () => {
    const ctx = mockContext(rslRoutes({ robots: ROBOTS_WITH_LICENSE }));
    const result = await check(ctx);
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});
