import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { hasCommerceSignals } from '../../dist/checks/commerce-discovery.js';
import { mockContext, mockResponse } from '../helpers.js';

const SCHEMA_URL = 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json';
const PROFILE = {
  ucp: {
    version: '2026-08-25',
    services: {
      'dev.ucp.shopping': { rest: { endpoint: 'https://example.com/ucp', schema: SCHEMA_URL } },
    },
    payment_handlers: [{ name: 'com.google.pay', version: '1' }],
  },
  keys: [{ kty: 'EC', crv: 'P-256', kid: 'k1', x: 'a', y: 'b' }],
};

const SHOP_HTML =
  '<html><body><script type="application/ld+json">{"@type":"Product","name":"Widget"}</script><a href="/cart">Cart</a></body></html>';

function ctx({ profile = PROFILE, path = '/.well-known/ucp', routes = {}, html = SHOP_HTML } = {}) {
  return mockContext(
    {
      ...(profile !== null ? { [path]: mockResponse({ body: JSON.stringify(profile) }) } : {}),
      [SCHEMA_URL]: mockResponse({ body: '{"openapi":"3.1.0"}' }),
      ...routes,
    },
    { html },
  );
}

describe('commerce-discovery: applicability', () => {
  it('should detect Product structured data, cart links and price tags', () => {
    assert.equal(hasCommerceSignals(SHOP_HTML).found, true);
    assert.ok(hasCommerceSignals(SHOP_HTML).evidence.includes('Product or storefront structured data'));
    assert.equal(hasCommerceSignals('<a href="/checkout">Buy</a>').found, true);
    assert.equal(hasCommerceSignals('<meta property="product:price:amount" content="9.99">').found, true);
  });

  it('should not read a lone Offer as a storefront', () => {
    // A SaaS landing page routinely prices its plans this way. That is a price
    // statement, not a catalog an agent can transact against.
    const saas =
      '<html><body><script type="application/ld+json">{"@type":"SoftwareApplication","offers":{"@type":"Offer","price":"20"}}</script></body></html>';
    assert.equal(hasCommerceSignals(saas).found, false);
  });

  it('should read an Offer alongside a cart as a storefront', () => {
    const shop =
      '<html><body><script type="application/ld+json">{"@type":"Offer","price":"20"}</script><a href="/cart">Cart</a></body></html>';
    const signals = hasCommerceSignals(shop);
    assert.equal(signals.found, true);
    assert.ok(signals.evidence.includes('Offer structured data'));
  });

  it('should report N/A for a site that sells nothing', async () => {
    const result = await check(mockContext({}, { html: '<html><body><h1>A blog</h1></body></html>' }));
    assert.equal(result.applicable, false);
    assert.ok(result.findings[0].message.includes('does not apply to this site'));
  });

  it('should apply when the page shows commerce signals', async () => {
    const result = await check(mockContext({}, { html: SHOP_HTML }));
    assert.notEqual(result.applicable, false);
    const finding = result.findings.find((f) => f.message.includes('publishes no agent-readable commerce profile'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('defines no manifest'), 'the report should say ACP is not discoverable by design');
  });
});

describe('commerce-discovery: profile validation', () => {
  it('should score a complete profile 100', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('UCP version 2026-08-25')));
    assert.ok(result.findings.some((f) => f.message.includes('com.google.pay')));
  });

  it('should accept the .json variant of the path', async () => {
    const result = await check(ctx({ path: '/.well-known/ucp.json' }));
    assert.equal(result.score, 100);
  });

  it('should fail a profile behind authentication', async () => {
    const result = await check(
      ctx({ profile: null, routes: { '/.well-known/ucp': mockResponse({ status: 401, ok: false, body: '' }) } }),
    );
    assert.equal(result.score, 0);
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding.hint.includes('before it has any credentials'));
  });

  it('should fail an unparseable profile', async () => {
    const result = await check(ctx({ profile: null, routes: { '/.well-known/ucp': mockResponse({ body: '{' }) } }));
    assert.equal(result.score, 10);
  });

  it('should fail a profile with no ucp object', async () => {
    const result = await check(ctx({ profile: { version: '2026-08-25' } }));
    assert.equal(result.score, 20);
    assert.ok(result.findings.some((f) => f.message.includes('no "ucp" object')));
  });

  it('should reject a semantic version where a spec date belongs', async () => {
    const result = await check(ctx({ profile: { ...PROFILE, ucp: { ...PROFILE.ucp, version: '1.0.0' } } }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('is not a specification date')));
  });

  it('should fail a profile with no services', async () => {
    const result = await check(ctx({ profile: { ...PROFILE, ucp: { ...PROFILE.ucp, services: {} } } }));
    assert.equal(result.score, 75);
    assert.ok(result.findings.some((f) => f.message.includes('declares no services')));
  });

  it('should warn about a service name that is not reverse-DNS', async () => {
    const profile = { ...PROFILE, ucp: { ...PROFILE.ucp, services: { shopping: { rest: { schema: SCHEMA_URL } } } } };
    const result = await check(ctx({ profile }));
    assert.ok(result.findings.some((f) => f.message.includes('not in reverse-DNS form')));
  });

  it('should fail when a declared schema URL is dead', async () => {
    const result = await check(ctx({ routes: { [SCHEMA_URL]: mockResponse({ status: 404, ok: false, body: '' }) } }));
    const finding = result.findings.find((f) => f.message.includes('cannot be fetched'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('starts and cannot finish'));
    assert.equal(result.score, 80);
  });

  it('should find schema URLs nested under any transport shape', async () => {
    const profile = {
      ucp: {
        version: '2026-08-25',
        services: { 'dev.ucp.shopping': [{ transport: 'mcp', schema: SCHEMA_URL }] },
        payment_handlers: [{ name: 'com.google.pay' }],
      },
      keys: PROFILE.keys,
    };
    const result = await check(ctx({ profile }));
    assert.equal(result.score, 100);
  });

  it('should warn when there is no way to pay', async () => {
    const profile = { ...PROFILE, ucp: { ...PROFILE.ucp, payment_handlers: [] } };
    const result = await check(ctx({ profile }));
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.hint?.includes('cannot complete a purchase')));
  });

  it('should accept the nested payment.handlers shape', async () => {
    const ucp = { ...PROFILE.ucp, payment_handlers: undefined, payment: { handlers: [{ name: 'com.google.pay' }] } };
    const result = await check(ctx({ profile: { ...PROFILE, ucp } }));
    assert.equal(result.score, 100);
  });

  it('should warn when no signing keys are published', async () => {
    const result = await check(ctx({ profile: { ucp: PROFILE.ucp } }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.hint?.includes('Money is moving')));
  });
});
