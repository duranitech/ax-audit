import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasApiSurface,
  hasMcpSurface,
  hasAgentSurface,
  hasDocsSurface,
  forcedBy,
  profileFrom,
} from '../../dist/checks/surface.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('surface detection: profiles', () => {
  it('should default to automatic detection', () => {
    assert.equal(profileFrom(mockContext()), 'auto');
  });

  it('should force one surface, or all of them', () => {
    assert.equal(forcedBy('api', 'api'), true);
    assert.equal(forcedBy('api', 'mcp'), false);
    assert.equal(forcedBy('all', 'commerce'), true);
    assert.equal(forcedBy('auto', 'api'), false);
  });
});

describe('surface detection: API', () => {
  it('should find an API from a description at a conventional path', async () => {
    const ctx = mockContext({ '/openapi.json': mockResponse({ body: '{"openapi":"3.1.0"}' }) });
    const e = await hasApiSurface(ctx);
    assert.equal(e.found, true);
    assert.ok(e.reason.includes('/openapi.json'));
  });

  it('should find an API from navigation into a developer area', async () => {
    for (const href of ['/api', '/developers', '/api-docs', '/reference']) {
      const ctx = mockContext({}, { html: `<a href="${href}">Link</a>` });
      assert.equal((await hasApiSurface(ctx)).found, true, href);
    }
  });

  it('should find an API from a service-desc relation', async () => {
    const ctx = mockContext({}, { html: '<link rel="service-desc" href="/spec.json">' });
    assert.equal((await hasApiSurface(ctx)).found, true);
  });

  it('should find an API from a subdomain reference', async () => {
    const ctx = mockContext({}, { html: '<p>Base URL: api.example.com</p>' });
    assert.equal((await hasApiSurface(ctx)).found, true);
  });

  it('should find nothing on a brochure site', async () => {
    const ctx = mockContext({}, { html: '<html><body><h1>A bakery</h1><a href="/about">About</a></body></html>' });
    assert.equal((await hasApiSurface(ctx)).found, false);
  });

  it('should be forced by the profile', async () => {
    const ctx = { ...mockContext(), profile: 'api' };
    const e = await hasApiSurface(ctx);
    assert.equal(e.found, true);
    assert.equal(e.reason, '--profile api');
  });
});

describe('surface detection: MCP and agent', () => {
  it('should find an MCP server from a server card', async () => {
    const ctx = mockContext({ '/mcp/server-card': mockResponse({ body: '{"name":"com.example/x"}' }) });
    assert.equal((await hasMcpSurface(ctx)).found, true);
  });

  it('should find an MCP server from an AI catalog entry', async () => {
    const ctx = mockContext({
      '/.well-known/ai-catalog.json': mockResponse({
        body: JSON.stringify({ entries: [{ type: 'application/mcp-server-card+json', url: '/x' }] }),
      }),
    });
    const e = await hasMcpSurface(ctx);
    assert.equal(e.found, true);
    assert.ok(e.reason.includes('AI catalog'));
  });

  it('should find an MCP server from navigation', async () => {
    const ctx = mockContext({}, { html: '<a href="/mcp">Endpoint</a>' });
    assert.equal((await hasMcpSurface(ctx)).found, true);
  });

  it('should treat an MCP server as an agent surface', async () => {
    const ctx = mockContext({}, { html: '<a href="/mcp">Endpoint</a>' });
    const e = await hasAgentSurface(ctx);
    assert.equal(e.found, true);
    assert.ok(e.reason.includes('MCP surface'));
  });

  it('should treat an API as an agent surface', async () => {
    const ctx = mockContext({}, { html: '<a href="/developers">Developers</a>' });
    const e = await hasAgentSurface(ctx);
    assert.equal(e.found, true);
    assert.ok(e.reason.includes('API surface'));
  });

  it('should find nothing agent-facing on a brochure site', async () => {
    const ctx = mockContext({}, { html: '<html><body><h1>A bakery</h1></body></html>' });
    assert.equal((await hasAgentSurface(ctx)).found, false);
    assert.equal((await hasMcpSurface(ctx)).found, false);
  });
});

describe('surface detection: docs', () => {
  it('should find documentation from navigation', async () => {
    const ctx = mockContext({}, { html: '<a href="/docs/start">Docs</a>' });
    assert.equal((await hasDocsSurface(ctx)).found, true);
  });

  it('should find documentation from llms.txt', async () => {
    const ctx = mockContext({ '/llms.txt': mockResponse({ body: '# Site' }) });
    assert.equal((await hasDocsSurface(ctx)).found, true);
  });

  it('should find nothing on a site with no documentation', async () => {
    const ctx = mockContext({}, { html: '<html><body><h1>A bakery</h1></body></html>' });
    assert.equal((await hasDocsSurface(ctx)).found, false);
  });
});
