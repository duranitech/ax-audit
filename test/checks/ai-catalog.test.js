import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/ai-catalog.js';
import { mockContext, mockResponse } from '../helpers.js';

const CATALOG = {
  specVersion: '1.0',
  host: { displayName: 'Acme', identifier: 'example.com' },
  entries: [
    {
      identifier: 'urn:air:acme:mcp',
      type: 'application/mcp-server-card+json',
      displayName: 'Docs server',
      url: '/mcp/server-card',
    },
  ],
};

const CARD_HEADERS = { 'content-type': 'application/mcp-server-card+json' };
const JSON_HEADERS = { 'content-type': 'application/json' };

function ctx({ catalog = CATALOG, path = '/.well-known/ai-catalog.json', routes = {}, html = '', headers = {}, robots } = {}) {
  return mockContext(
    {
      ...(robots !== undefined ? { '/robots.txt': mockResponse({ body: robots }) } : {}),
      [path]: mockResponse({ body: JSON.stringify(catalog), headers: JSON_HEADERS }),
      '/mcp/server-card': mockResponse({ body: '{"name":"com.example/docs"}', headers: CARD_HEADERS }),
      ...routes,
    },
    { html, headers },
  );
}

describe('ai-catalog: discovery', () => {
  it('should warn without scoring when no catalog exists', async () => {
    const result = await check(mockContext());
    assert.equal(result.score, 0);
    const finding = result.findings[0];
    assert.equal(finding.status, 'warn', 'both specifications are drafts');
    assert.ok(finding.hint.includes('never affects your score'));
  });

  it('should find a catalog at the well-known path', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('via well-known path')));
  });

  it('should find an ARD document at its own path', async () => {
    const result = await check(ctx({ path: '/.well-known/ard.json' }));
    assert.equal(result.score, 100);
  });

  it('should follow a robots.txt Agentmap directive', async () => {
    const result = await check(
      ctx({ robots: 'Agentmap: https://example.com/catalog.json\nUser-agent: *\nAllow: /', path: '/catalog.json' }),
    );
    assert.ok(result.findings.some((f) => f.message.includes('robots.txt Agentmap')));
  });

  it('should follow a Link header rel=ai-catalog', async () => {
    const result = await check(
      ctx({ path: '/catalog.json', headers: { link: '</catalog.json>; rel="ai-catalog"' } }),
    );
    assert.ok(result.findings.some((f) => f.message.includes('Link header rel="ai-catalog"')));
  });

  it('should follow an HTML link, including the ard relation', async () => {
    const result = await check(ctx({ path: '/catalog.json', html: '<link rel="ard" href="/catalog.json">' }));
    assert.ok(result.findings.some((f) => f.message.includes('<link rel="ai-catalog">')));
  });

  it('should treat an HTML response as absence', async () => {
    const result = await check(
      mockContext({ '/.well-known/ai-catalog.json': mockResponse({ body: '<!doctype html><html></html>' }) }),
    );
    assert.equal(result.score, 0);
    assert.ok(result.findings[0].message.includes('No agent resource catalog found'));
  });
});

describe('ai-catalog: validation', () => {
  it('should fail invalid JSON with an explanation of why it matters', async () => {
    const result = await check(
      mockContext({ '/.well-known/ai-catalog.json': mockResponse({ body: '{"entries":', headers: JSON_HEADERS }) }),
    );
    assert.equal(result.score, 10);
    assert.ok(result.findings.some((f) => f.hint?.includes('fetched first')));
  });

  it('should warn about a missing specVersion and host', async () => {
    const result = await check(ctx({ catalog: { entries: CATALOG.entries } }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('no specVersion')));
    assert.ok(result.findings.some((f) => f.message.includes('no host')));
  });

  it('should warn about an empty catalog', async () => {
    const result = await check(ctx({ catalog: { ...CATALOG, entries: [] } }));
    assert.equal(result.score, 80);
    assert.ok(result.findings.some((f) => f.message.includes('no entries')));
  });

  it('should warn about an incomplete entry', async () => {
    const result = await check(ctx({ catalog: { ...CATALOG, entries: [{ displayName: 'Broken' }] } }));
    assert.ok(result.findings.some((f) => f.message.includes('missing identifier, type, or url/data')));
  });

  it('should accept an inline data entry with no url', async () => {
    const catalog = {
      ...CATALOG,
      entries: [{ identifier: 'x', type: 'application/a2a-agent-card+json', displayName: 'Inline', data: { name: 'a' } }],
    };
    const result = await check(ctx({ catalog }));
    assert.equal(result.score, 100);
  });

  it('should warn about an unrecognised entry type', async () => {
    const catalog = {
      ...CATALOG,
      entries: [{ identifier: 'x', type: 'application/unknown+json', displayName: 'X', url: '/mcp/server-card' }],
    };
    const result = await check(ctx({ catalog }));
    assert.ok(result.findings.some((f) => f.message.includes('unrecognised media type')));
  });
});

describe('ai-catalog: entries must resolve', () => {
  it('should confirm that referenced documents exist', async () => {
    const result = await check(ctx());
    assert.ok(result.findings.some((f) => f.message.includes('All 1 referenced document(s) resolve')));
  });

  it('should fail an entry pointing at a document that 404s', async () => {
    const result = await check(
      ctx({ routes: { '/mcp/server-card': mockResponse({ status: 404, ok: false, body: '' }) } }),
    );
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding);
    assert.ok(finding.message.includes('cannot be fetched'));
    assert.ok(finding.hint.includes('before it reads anything else'));
    assert.equal(result.score, 85);
  });

  it('should fall back to GET when the origin refuses HEAD', async () => {
    let sawHead = false;
    const c = mockContext({
      '/.well-known/ai-catalog.json': mockResponse({ body: JSON.stringify(CATALOG), headers: JSON_HEADERS }),
      '/mcp/server-card': (url, options) => {
        if (options?.method === 'HEAD') {
          sawHead = true;
          return mockResponse({ status: 405, ok: false, body: '' });
        }
        return mockResponse({ body: '{"name":"x"}', headers: CARD_HEADERS });
      },
    });
    const result = await check(c);
    assert.ok(sawHead);
    assert.equal(result.score, 100, 'a HEAD-refusing origin must not read as a dead entry');
  });

  it('should warn when a document is served with a different media type than declared', async () => {
    const result = await check(
      ctx({ routes: { '/mcp/server-card': mockResponse({ body: '{}', headers: { 'content-type': 'text/plain' } }) } }),
    );
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('different media type than declared')));
  });

  it('should accept application/json for a specific declared type', async () => {
    const result = await check(
      ctx({ routes: { '/mcp/server-card': mockResponse({ body: '{}', headers: JSON_HEADERS }) } }),
    );
    assert.equal(result.score, 100);
  });
});
