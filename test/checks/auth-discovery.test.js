import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { resourceMetadataFromChallenge } from '../../dist/checks/auth-discovery.js';
import { mockContext, mockResponse } from '../helpers.js';

const ISSUER = 'https://auth.example.com';
const RESOURCE_META = { resource: 'https://example.com/api', authorization_servers: [ISSUER] };
const SERVER_META = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  code_challenge_methods_supported: ['S256'],
  registration_endpoint: `${ISSUER}/register`,
};

// Declares a security scheme, so the API states that credentials exist
// somewhere — the case where OAuth discovery genuinely applies.
const OPENAPI = mockResponse({
  body: JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'API' },
    components: { securitySchemes: { oauth: { type: 'oauth2', flows: {} } } },
  }),
});

// Declares no scheme at all and pins it down with `security: []`: the
// machine-readable statement that every operation is anonymous.
const PUBLIC_OPENAPI = mockResponse({
  body: JSON.stringify({ openapi: '3.1.0', info: { title: 'API' }, security: [], paths: {} }),
});

function ctx({ resource = RESOURCE_META, server = SERVER_META, routes = {}, headers = {}, surface = true } = {}) {
  return mockContext(
    {
      ...(surface ? { '/openapi.json': OPENAPI } : {}),
      ...(resource !== null
        ? { '/.well-known/oauth-protected-resource': mockResponse({ body: JSON.stringify(resource) }) }
        : {}),
      ...(server !== null
        ? { 'auth.example.com/.well-known/oauth-authorization-server': mockResponse({ body: JSON.stringify(server) }) }
        : {}),
      ...routes,
    },
    { headers },
  );
}

describe('auth-discovery: WWW-Authenticate parsing', () => {
  it('should read resource_metadata out of a challenge', () => {
    const url = resourceMetadataFromChallenge('Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"');
    assert.equal(url, 'https://example.com/.well-known/oauth-protected-resource');
  });

  it('should return null when the parameter is absent', () => {
    assert.equal(resourceMetadataFromChallenge('Bearer realm="api"'), null);
  });
});

describe('auth-discovery: applicability', () => {
  it('should report N/A for a site with nothing to authorize', async () => {
    const result = await check(mockContext());
    assert.equal(result.applicable, false);
    assert.ok(result.findings[0].message.includes('does not apply'));
  });

  it('should apply when the site exposes an API description', async () => {
    const result = await check(ctx({ resource: null, server: null }));
    assert.notEqual(result.applicable, false);
    const finding = result.findings.find((f) => f.message.includes('publishes no OAuth metadata'));
    assert.ok(finding);
    assert.ok(finding.message.includes('an OpenAPI description'));
    assert.ok(finding.hint.includes('cannot read your documentation'));
  });

  it('should apply when an MCP server card names a remote that answers 401', async () => {
    const card = JSON.stringify({ name: 'com.example/x', remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp-remote' }] });
    const c = mockContext({
      '/mcp/server-card': mockResponse({ body: card }),
      '/mcp-remote': mockResponse({ status: 401, ok: false, body: 'Unauthorized' }),
    });
    const result = await check(c);
    assert.notEqual(result.applicable, false);
    assert.ok(result.findings.some((f) => f.message.includes('an MCP server card')));
  });

  it('should report N/A when the MCP remote serves anonymous callers', async () => {
    const card = JSON.stringify({ name: 'com.example/x', remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp-remote' }] });
    const c = mockContext({
      '/mcp/server-card': mockResponse({ body: card }),
      // 405 is what a streamable-http endpoint says to a bare GET when it
      // is not gating on credentials; the point is that it is not a 401.
      '/mcp-remote': mockResponse({ status: 405, ok: false, body: 'Method Not Allowed' }),
    });
    const result = await check(c);
    assert.equal(result.applicable, false);
    const finding = result.findings.find((f) => f.message.includes('serves anonymous callers'));
    assert.ok(finding, 'the N/A names the anonymous remote as the reason');
  });

  it('should report N/A for an MCP card with no remotes', async () => {
    const c = mockContext({ '/mcp/server-card': mockResponse({ body: '{"name":"com.example/x"}' }) });
    const result = await check(c);
    assert.equal(result.applicable, false);
  });

  it('should treat an unreadable MCP card as a surface', async () => {
    const c = mockContext({ '/mcp/server-card': mockResponse({ body: 'name: com.example/x' }) });
    const result = await check(c);
    assert.notEqual(result.applicable, false);
  });

  it('should report N/A when the only API description declares no authentication', async () => {
    const c = mockContext({ '/openapi.json': PUBLIC_OPENAPI });
    const result = await check(c);
    assert.equal(result.applicable, false);
    const finding = result.findings.find((f) => f.message.includes('declares no authentication'));
    assert.ok(finding, 'the N/A names the API as the reason');
    assert.ok(finding.detail.includes('/openapi.json'));
  });

  it('should report N/A for an OpenAPI with no security schemes even without security: []', async () => {
    const body = JSON.stringify({ openapi: '3.0.0', info: { title: 'API' }, paths: {} });
    const c = mockContext({ '/openapi.json': mockResponse({ body }) });
    const result = await check(c);
    assert.equal(result.applicable, false);
  });

  it('should apply when swagger 2 securityDefinitions declare a scheme', async () => {
    const body = JSON.stringify({ swagger: '2.0', securityDefinitions: { key: { type: 'apiKey' } } });
    const c = mockContext({ '/openapi.json': mockResponse({ body }) });
    const result = await check(c);
    assert.notEqual(result.applicable, false);
    assert.equal(result.score, 0);
  });

  it('should still apply when a public API sits beside an authenticated MCP server', async () => {
    const card = JSON.stringify({ name: 'com.example/x', remotes: [{ url: 'https://example.com/mcp-remote' }] });
    const c = mockContext({
      '/openapi.json': PUBLIC_OPENAPI,
      '/mcp/server-card': mockResponse({ body: card }),
      '/mcp-remote': mockResponse({ status: 401, ok: false, body: '' }),
    });
    const result = await check(c);
    assert.notEqual(result.applicable, false);
    assert.ok(result.findings.some((f) => f.message.includes('an MCP server card')));
  });

  it('should treat an unreadable API description as a surface', async () => {
    const c = mockContext({ '/openapi.json': mockResponse({ body: 'openapi: 3.1.0' }) });
    const result = await check(c);
    assert.notEqual(result.applicable, false);
  });
});

describe('auth-discovery: the metadata chain', () => {
  it('should score a complete chain 100', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Protected-resource metadata published')));
    assert.ok(result.findings.some((f) => f.message.includes('PKCE with S256 supported')));
    assert.ok(result.findings.some((f) => f.message.includes('Dynamic client registration supported')));
  });

  it('should follow a WWW-Authenticate challenge to the metadata', async () => {
    const result = await check(
      ctx({
        resource: null,
        routes: { '/auth/meta.json': mockResponse({ body: JSON.stringify(RESOURCE_META) }) },
        headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/auth/meta.json"' },
      }),
    );
    assert.ok(result.findings.some((f) => f.message.includes('WWW-Authenticate points at')));
    assert.equal(result.score, 100);
  });

  it('should fail metadata that names no authorization server', async () => {
    const result = await check(ctx({ resource: { resource: 'https://example.com/api' } }));
    assert.equal(result.score, 40);
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding.hint.includes('but not where to get one'));
  });

  it('should warn about a missing resource identifier', async () => {
    const result = await check(ctx({ resource: { authorization_servers: [ISSUER] } }));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('no "resource" identifier')));
  });

  it('should fail an authorization server with no discovery metadata', async () => {
    const result = await check(ctx({ server: null }));
    assert.equal(result.score, 70);
    const finding = result.findings.find((f) => f.message.includes('publishes no discovery metadata'));
    assert.ok(finding.hint.includes('The chain stops here'));
  });

  it('should accept OpenID configuration as the server metadata', async () => {
    const result = await check(
      ctx({
        server: null,
        routes: {
          'auth.example.com/.well-known/openid-configuration': mockResponse({ body: JSON.stringify(SERVER_META) }),
        },
      }),
    );
    assert.equal(result.score, 100);
  });

  it('should fail an invalid issuer URL', async () => {
    const result = await check(ctx({ resource: { resource: 'x', authorization_servers: ['not a url'] } }));
    assert.equal(result.score, 75);
    assert.ok(result.findings.some((f) => f.message.includes('is not a valid URL')));
  });

  it('should fail incomplete server metadata', async () => {
    const result = await check(ctx({ server: { issuer: ISSUER, code_challenge_methods_supported: ['S256'], registration_endpoint: 'x' } }));
    assert.equal(result.score, 70, 'two required endpoints missing');
    assert.ok(result.findings.some((f) => f.message.includes('missing "authorization_endpoint"')));
    assert.ok(result.findings.some((f) => f.message.includes('missing "token_endpoint"')));
  });

  it('should warn when PKCE with S256 is not advertised', async () => {
    const server = { ...SERVER_META, code_challenge_methods_supported: ['plain'] };
    const result = await check(ctx({ server }));
    assert.equal(result.score, 85);
    const finding = result.findings.find((f) => f.message.includes('does not advertise PKCE'));
    assert.ok(finding.hint.includes('Agents are public clients'));
  });

  it('should warn when there is no automated client registration', async () => {
    const server = { ...SERVER_META, registration_endpoint: undefined };
    const result = await check(ctx({ server }));
    assert.equal(result.score, 90);
    const finding = result.findings.find((f) => f.message.includes('No automated client registration'));
    assert.ok(finding.hint.includes('That is a queue, not an integration'));
  });

  it('should accept Client ID Metadata Documents instead of dynamic registration', async () => {
    const server = { ...SERVER_META, registration_endpoint: undefined, client_id_metadata_document_supported: true };
    const result = await check(ctx({ server }));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('Client ID Metadata Documents supported')));
  });
});
