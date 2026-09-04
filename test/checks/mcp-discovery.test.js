import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/mcp-discovery.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('mcp', () => {
  it('should report N/A when the site runs no MCP server', async () => {
    const result = await check(mockContext({}));
    assert.equal(result.applicable, false, 'a site with no MCP server has nothing to advertise');
    assert.ok(result.findings[0].detail.includes('--profile mcp'));
  });

  it('should fail a site that runs an MCP server nobody can find', async () => {
    const ctx = mockContext({}, { html: '<html><body><a href="/mcp">Our MCP endpoint</a></body></html>' });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.notEqual(result.applicable, false);
    const finding = result.findings.find(f => f.status === 'fail');
    assert.ok(finding.message.includes('present but not discoverable'));
    assert.ok(finding.hint.includes('told the URL by a human'));
  });

  it('should apply when the profile forces it', async () => {
    const result = await check({ ...mockContext({}), profile: 'mcp' });
    assert.notEqual(result.applicable, false);
  });

  it('should return score 10 for invalid JSON', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({ body: 'not json' }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 10);
  });

  it('should score well for a fully compliant mcp.json', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          name: 'My MCP Server',
          description: 'A test MCP server',
          protocolVersion: '2025-03-26',
          tools: [
            { name: 'search', description: 'Search the web' },
            { name: 'fetch', description: 'Fetch a URL' },
          ],
          resources: [{ uri: 'file:///data', name: 'Data' }],
          prompts: [{ name: 'summarize', description: 'Summarize text' }],
          authentication: { type: 'bearer' },
        }),
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should warn when /.well-known/mcp.json has wrong Content-Type', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          name: 'Test',
          description: 'Test',
          tools: [{ name: 't', description: 'd' }],
          resources: [{ uri: 'file:///x' }],
          protocolVersion: '2025-03-26',
        }),
        headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' },
      }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Content-Type')));
  });

  it('should penalize missing server name', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          description: 'A test server',
          tools: [{ name: 'test', description: 'Test tool' }],
          resources: [{ uri: 'file:///data' }],
          protocolVersion: '2025-03-26',
        }),
        headers: { 'access-control-allow-origin': '*' },
      }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.message.includes('Missing server name')));
  });

  it('should penalize empty tools array', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          name: 'Test',
          description: 'Test',
          tools: [],
          resources: [{ uri: 'file:///data' }],
          protocolVersion: '2025-03-26',
        }),
        headers: { 'access-control-allow-origin': '*' },
      }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.message.includes('empty')));
  });

  it('should penalize missing CORS headers', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          name: 'Test',
          description: 'Test',
          tools: [{ name: 'test', description: 'Test' }],
          resources: [{ uri: 'file:///data' }],
          protocolVersion: '2025-03-26',
        }),
      }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.message.includes('No CORS')));
  });

  it('should penalize missing protocol version', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          name: 'Test',
          description: 'Test',
          tools: [{ name: 'test', description: 'Test' }],
          resources: [{ uri: 'file:///data' }],
        }),
        headers: { 'access-control-allow-origin': '*' },
      }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.message.includes('No protocol version')));
  });

  it('should penalize tools without descriptions', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({
          name: 'Test',
          description: 'Test',
          tools: [{ name: 'test1' }, { name: 'test2' }],
          resources: [{ uri: 'file:///data' }],
          protocolVersion: '2025-03-26',
        }),
        headers: { 'access-control-allow-origin': '*' },
      }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.message.includes('No tools have descriptions')));
  });

  it('should clamp score between 0 and 100', async () => {
    const ctx = mockContext({
      '/.well-known/mcp.json': mockResponse({
        body: JSON.stringify({}),
      }),
    });
    const result = await check(ctx);
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});

describe('mcp-discovery: server cards', () => {
  const CARD = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: 'com.example/docs',
    version: '1.0.0',
    description: 'Documentation search for example.com',
    remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', supportedProtocolVersions: ['2026-07-28'] }],
    websiteUrl: 'https://example.com',
  };
  const CARD_HEADERS = { 'content-type': 'application/mcp-server-card+json', 'access-control-allow-origin': '*' };

  const cardCtx = (card = CARD, { path = '/.well-known/mcp/server-card.json', headers = CARD_HEADERS } = {}) =>
    mockContext({ [path]: mockResponse({ body: JSON.stringify(card), headers }) });

  it('should score a complete server card 100', async () => {
    const result = await check(cardCtx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('server-card.json')));
  });

  it('should find a card at the endpoint path recommended by the extension', async () => {
    const result = await check(cardCtx(CARD, { path: '/mcp/server-card' }));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('<endpoint>/server-card')));
  });

  it('should label the standing of the draft path it used', async () => {
    const result = await check(cardCtx());
    const finding = result.findings.find(f => f.message.includes('discoverable via'));
    assert.ok(finding.detail.includes('Vendor convention') || finding.detail.includes('Draft'));
  });

  it('should require the four server-card fields', async () => {
    const card = { ...CARD };
    delete card.version;
    const result = await check(cardCtx(card));
    assert.equal(result.score, 85);
    assert.ok(result.findings.some(f => f.status === 'fail' && f.message.includes('"version" missing')));
  });

  it('should warn when the name is not reverse-DNS', async () => {
    const result = await check(cardCtx({ ...CARD, name: 'docs' }));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some(f => f.message.includes('not in reverse-DNS form')));
  });

  it('should accept a github-style reverse-DNS name', async () => {
    const result = await check(cardCtx({ ...CARD, name: 'io.github.acme/weather' }));
    assert.equal(result.score, 100);
  });

  it('should require remotes so an agent knows where to connect', async () => {
    const card = { ...CARD };
    delete card.remotes;
    const result = await check(cardCtx(card));
    assert.equal(result.score, 85);
    assert.ok(result.findings.some(f => f.message.includes('no remotes[] declared')));
  });

  it('should reject an unrecognised transport type', async () => {
    const card = { ...CARD, remotes: [{ type: 'websocket', url: 'https://example.com/mcp', supportedProtocolVersions: ['2026-07-28'] }] };
    const result = await check(cardCtx(card));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some(f => f.message.includes('unrecognised transport type')));
  });

  it('should accept both documented transports', async () => {
    for (const type of ['streamable-http', 'sse']) {
      const card = { ...CARD, remotes: [{ type, url: 'https://example.com/mcp', supportedProtocolVersions: ['2026-07-28'] }] };
      assert.equal((await check(cardCtx(card))).score, 100, type);
    }
  });

  it('should fail a remote with no url', async () => {
    const card = { ...CARD, remotes: [{ type: 'streamable-http', supportedProtocolVersions: ['2026-07-28'] }] };
    const result = await check(cardCtx(card));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some(f => f.status === 'fail' && f.message.includes('missing a url')));
  });

  it('should recognise the current protocol revision', async () => {
    const result = await check(cardCtx());
    assert.ok(result.findings.some(f => f.message.includes('supports the current MCP revision (2026-07-28)')));
  });

  it('should warn when only pre-2025-06 revisions are supported', async () => {
    const card = { ...CARD, remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', supportedProtocolVersions: ['2024-11-05'] }] };
    const result = await check(cardCtx(card));
    assert.equal(result.score, 90);
    const finding = result.findings.find(f => f.message.includes('pre-2025-06'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('2026-07-28'));
  });

  it('should not warn when a stale revision is offered alongside a current one', async () => {
    const card = { ...CARD, remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', supportedProtocolVersions: ['2026-07-28', '2024-11-05'] }] };
    const result = await check(cardCtx(card));
    assert.equal(result.score, 100);
  });

  it('should warn on an invented protocol version', async () => {
    const card = { ...CARD, remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', supportedProtocolVersions: ['2027-01-01'] }] };
    const result = await check(cardCtx(card));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some(f => f.message.includes('unrecognised MCP protocol version')));
  });

  it('should deduct when supportedProtocolVersions is absent', async () => {
    const card = { ...CARD, remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }] };
    const result = await check(cardCtx(card));
    assert.equal(result.score, 90);
  });

  it('should warn about tools[] in a card, which the schema omits by design', async () => {
    const result = await check(cardCtx({ ...CARD, tools: [{ name: 'search' }] }));
    const finding = result.findings.find(f => f.message.includes('declares tools[]'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('tools/list'));
  });

  it('should deduct 10 without CORS on the card', async () => {
    const result = await check(cardCtx(CARD, { headers: { 'content-type': 'application/mcp-server-card+json' } }));
    assert.equal(result.score, 90);
  });

  it('should validate a multi-server document', async () => {
    const doc = { servers: [CARD, { ...CARD, name: 'com.example/search' }] };
    const result = await check(
      mockContext({ '/.well-known/mcp/server-cards.json': mockResponse({ body: JSON.stringify(doc), headers: CARD_HEADERS }) }),
    );
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('2 server cards declared')));
  });
});

describe('mcp-discovery: ai-catalog', () => {
  const CATALOG = {
    specVersion: '1.0',
    host: { displayName: 'Example', identifier: 'example.com' },
    entries: [
      {
        identifier: 'urn:air:example:mcp',
        type: 'application/mcp-server-card+json',
        displayName: 'Docs server',
        url: 'https://example.com/mcp/server-card',
      },
    ],
  };
  const catalogCtx = (catalog = CATALOG) =>
    mockContext({
      '/.well-known/ai-catalog.json': mockResponse({
        body: JSON.stringify(catalog),
        headers: { 'content-type': 'application/json' },
      }),
    });

  it('should discover an MCP server through the catalog', async () => {
    const result = await check(catalogCtx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('ai-catalog.json entry')));
  });

  it('should ignore a catalog with no MCP entries', async () => {
    const catalog = { ...CATALOG, entries: [{ identifier: 'x', type: 'application/a2a-agent-card+json', url: 'https://e.com/c' }] };
    const result = await check(catalogCtx(catalog));
    assert.equal(result.score, 0, 'an A2A-only catalog says nothing about MCP');
  });

  it('should warn when the catalog omits specVersion', async () => {
    const catalog = { ...CATALOG };
    delete catalog.specVersion;
    const result = await check(catalogCtx(catalog));
    assert.equal(result.score, 95);
  });

  it('should warn on an entry with neither url nor inline data', async () => {
    const catalog = { ...CATALOG, entries: [{ identifier: 'x', type: 'application/mcp-server-card+json' }] };
    const result = await check(catalogCtx(catalog));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some(f => f.message.includes('missing identifier or url/data')));
  });

  it('should warn on an unrecognised entry type', async () => {
    const catalog = { ...CATALOG, entries: [...CATALOG.entries, { identifier: 'y', type: 'application/unknown+json', url: 'https://e.com/x' }] };
    const result = await check(catalogCtx(catalog));
    assert.equal(result.score, 95);
  });
});

describe('mcp-discovery: legacy manifest handling', () => {
  const LEGACY = {
    name: 'Example',
    description: 'Example MCP server',
    tools: [{ name: 'search', description: 'Search docs' }],
    resources: [{ uri: 'doc://x' }],
    protocolVersion: '2024-11-05',
  };
  const legacyCtx = (headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }) =>
    mockContext({ '/.well-known/mcp.json': mockResponse({ body: JSON.stringify(LEGACY), headers }) });

  it('should score a legacy manifest exactly as 3.6 did', async () => {
    const result = await check(legacyCtx());
    assert.equal(result.score, 100, 'correcting the discovery model must not move an existing score');
  });

  it('should say the legacy path is not specified, without deducting for it', async () => {
    const result = await check(legacyCtx());
    const finding = result.findings.find(f => f.message.includes('not a specified discovery path'));
    assert.ok(finding);
    assert.equal(finding.status, 'warn');
    assert.ok(finding.hint.includes('server-card'));
    assert.equal(result.score, 100);
  });

  it('should prefer a server card and flag the manifest as a second source of truth', async () => {
    const card = {
      $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      name: 'com.example/docs',
      version: '1.0.0',
      description: 'Docs',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', supportedProtocolVersions: ['2026-07-28'] }],
    };
    const ctx = mockContext({
      '/.well-known/mcp/server-card.json': mockResponse({
        body: JSON.stringify(card),
        headers: { 'content-type': 'application/mcp-server-card+json', 'access-control-allow-origin': '*' },
      }),
      '/.well-known/mcp.json': mockResponse({ body: JSON.stringify(LEGACY), headers: { 'content-type': 'application/json' } }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('is also served, and is not a specified path')));
  });
});
