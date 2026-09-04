import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/api-discovery.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('openapi', () => {
  it('should return score 0 when openapi.json is not found', async () => {
    const ctx = mockContext();
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.equal(result.findings[0].status, 'fail');
  });

  it('should return score 10 for invalid JSON', async () => {
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: 'not json' }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 10);
  });

  it('should score 100 for a fully compliant OpenAPI spec', async () => {
    const data = {
      openapi: '3.1.0',
      info: { title: 'My API', description: 'An API that does things' },
      paths: { '/users': { get: {} }, '/items': { get: {} } },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({
      '/openapi.json': mockResponse({
        body: JSON.stringify(data),
        headers: { 'content-type': 'application/json' },
      }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should warn when /.well-known/openapi.json has wrong Content-Type', async () => {
    const data = {
      openapi: '3.1.0',
      info: { title: 'API', description: 'Desc' },
      paths: { '/a': {} },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({
      '/openapi.json': mockResponse({
        body: JSON.stringify(data),
        headers: { 'content-type': 'text/plain' },
      }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Content-Type')));
  });

  it('should penalize Swagger version', async () => {
    const data = {
      swagger: '2.0',
      info: { title: 'My API', description: 'Desc' },
      paths: { '/users': {} },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('Swagger')));
  });

  it('should penalize missing version field', async () => {
    const data = {
      info: { title: 'API', description: 'Desc' },
      paths: { '/a': {} },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'fail' && f.message.includes('version')));
  });

  it('should penalize missing info.title', async () => {
    const data = { openapi: '3.0.0', info: {}, paths: { '/a': {} } };
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('title')));
  });

  it('should penalize missing info.description', async () => {
    const data = { openapi: '3.0.0', info: { title: 'API' }, paths: { '/a': {} } };
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('description')));
  });

  it('should penalize no paths', async () => {
    const data = { openapi: '3.0.0', info: { title: 'API', description: 'D' }, paths: {} };
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('paths')));
  });

  it('should penalize no servers', async () => {
    const data = { openapi: '3.0.0', info: { title: 'API', description: 'D' }, paths: { '/a': {} } };
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('servers')));
  });

  it('should clamp score between 0 and 100', async () => {
    const data = {};
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: JSON.stringify(data) }),
    });
    const result = await check(ctx);
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  });
});

describe('api-discovery: discovery mechanisms', () => {
  const SPEC = {
    openapi: '3.1.0',
    info: { title: 'Acme API', description: 'Everything Acme can do for an agent.' },
    paths: { '/widgets': { get: { operationId: 'listWidgets' } } },
    servers: [{ url: 'https://api.example.com' }],
  };
  const JSON_HEADERS = { 'content-type': 'application/json' };
  const body = JSON.stringify(SPEC);

  it('should find a description at the conventional root path', async () => {
    const ctx = mockContext({ '/openapi.json': mockResponse({ body, headers: JSON_HEADERS }) });
    const result = await check(ctx);
    assert.equal(result.score, 100, 'a site doing it right at /openapi.json used to score zero');
    assert.ok(result.findings.some(f => f.message.includes('/openapi.json')));
  });

  it('should warn that a guessed path is not advertised anywhere', async () => {
    const ctx = mockContext({ '/openapi.json': mockResponse({ body, headers: JSON_HEADERS }) });
    const result = await check(ctx);
    const finding = result.findings.find(f => f.message.includes('only discoverable by guessing'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('service-desc'));
  });

  it('should follow a Link header rel=service-desc', async () => {
    const ctx = mockContext(
      { '/spec/v1.json': mockResponse({ body, headers: JSON_HEADERS }) },
      { headers: { link: '</spec/v1.json>; rel="service-desc"' } },
    );
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('Link header rel="service-desc"')));
    assert.ok(!result.findings.some(f => f.message.includes('guessing')));
  });

  it('should follow a <link rel="service-desc"> tag', async () => {
    const ctx = mockContext(
      { '/spec/v1.json': mockResponse({ body, headers: JSON_HEADERS }) },
      { html: '<html><head><link rel="service-desc" href="/spec/v1.json"></head></html>' },
    );
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('<link rel="service-desc">')));
  });

  it('should follow an RFC 9727 catalog to the description', async () => {
    const catalog = {
      linkset: [
        {
          anchor: 'https://api.example.com',
          'service-desc': [{ href: '/spec/v1.json', type: 'application/json' }],
          'service-doc': [{ href: '/docs', type: 'text/html' }],
        },
      ],
    };
    const ctx = mockContext({
      '/.well-known/api-catalog': mockResponse({
        body: JSON.stringify(catalog),
        headers: { 'content-type': 'application/linkset+json' },
      }),
      '/spec/v1.json': mockResponse({ body, headers: JSON_HEADERS }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(result.findings.some(f => f.message.includes('RFC 9727 API catalog lists 1 API')));
    assert.ok(result.findings.some(f => f.message.includes('/.well-known/api-catalog (RFC 9727)')));
  });

  it('should warn about a catalog entry with no service-doc', async () => {
    const catalog = { linkset: [{ anchor: 'https://api.example.com', 'service-desc': [{ href: '/spec/v1.json' }] }] };
    const ctx = mockContext({
      '/.well-known/api-catalog': mockResponse({
        body: JSON.stringify(catalog),
        headers: { 'content-type': 'application/linkset+json' },
      }),
      '/spec/v1.json': mockResponse({ body, headers: JSON_HEADERS }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('no service-doc link')));
  });

  it('should warn about a catalog entry with no anchor', async () => {
    const catalog = { linkset: [{ 'service-desc': [{ href: '/spec/v1.json' }], 'service-doc': [{ href: '/d' }] }] };
    const ctx = mockContext({
      '/.well-known/api-catalog': mockResponse({
        body: JSON.stringify(catalog),
        headers: { 'content-type': 'application/linkset+json' },
      }),
      '/spec/v1.json': mockResponse({ body, headers: JSON_HEADERS }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('missing an anchor')));
  });

  it('should report an empty catalog without claiming a description exists', async () => {
    const ctx = mockContext({
      '/.well-known/api-catalog': mockResponse({
        body: JSON.stringify({ linkset: [] }),
        headers: { 'content-type': 'application/linkset+json' },
      }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some(f => f.message.includes('linkset is empty')));
  });

  it('should not accept an HTML page served at a conventional path', async () => {
    const ctx = mockContext({
      '/api-docs': mockResponse({ body: '<!doctype html><html><body>Swagger UI</body></html>', headers: { 'content-type': 'text/html' } }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 0, 'a Swagger UI page is not a machine-readable description');
  });

  it('should list every path it tried when nothing is found', async () => {
    const result = await check(mockContext());
    assert.ok(result.findings[0].detail.includes('/openapi.json'));
    assert.ok(result.findings[0].detail.includes('api-catalog'));
  });
});

describe('api-discovery: description quality', () => {
  const JSON_HEADERS = { 'content-type': 'application/json' };

  it('should report operationId coverage without deducting', async () => {
    const partial = {
      openapi: '3.1.0',
      info: { title: 'API', description: 'Desc' },
      paths: { '/a': { get: { operationId: 'getA' }, post: {} } },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({ '/openapi.json': mockResponse({ body: JSON.stringify(partial), headers: JSON_HEADERS }) });
    const result = await check(ctx);
    const finding = result.findings.find(f => f.message.includes('operations have an operationId'));
    assert.ok(finding);
    assert.ok(finding.message.includes('1/2'));
    assert.equal(result.score, 100, 'a new finding inside a weighted check must not deduct in 3.x');
  });

  it('should pass when every operation is named', async () => {
    const full = {
      openapi: '3.1.0',
      info: { title: 'API', description: 'Desc' },
      paths: { '/a': { get: { operationId: 'getA' } } },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({ '/openapi.json': mockResponse({ body: JSON.stringify(full), headers: JSON_HEADERS }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('All 1 operations have an operationId')));
  });

  it('should note $self on an OpenAPI 3.2 document', async () => {
    const spec = {
      openapi: '3.2.0',
      $self: 'https://api.example.com/openapi.json',
      info: { title: 'API', description: 'Desc' },
      paths: { '/a': { get: { operationId: 'getA' } } },
      servers: [{ url: 'https://api.example.com' }],
    };
    const ctx = mockContext({ '/openapi.json': mockResponse({ body: JSON.stringify(spec), headers: JSON_HEADERS }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('$self declared')));
  });

  it('should report declared authentication requirements', async () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'API', description: 'Desc' },
      paths: { '/a': { get: { operationId: 'getA' } } },
      servers: [{ url: 'https://api.example.com' }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    };
    const ctx = mockContext({ '/openapi.json': mockResponse({ body: JSON.stringify(spec), headers: JSON_HEADERS }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('Authentication requirements declared')));
  });

  it('should report a YAML description as partially validated', async () => {
    const yaml = [
      'openapi: 3.1.0',
      'info:',
      '  title: Acme API',
      '  description: Everything Acme can do.',
      'servers:',
      '  - url: https://api.example.com',
      'paths:',
      '  /widgets:',
      '    get:',
      '      operationId: listWidgets',
    ].join('\n');
    const ctx = mockContext({ '/openapi.yaml': mockResponse({ body: yaml, headers: { 'content-type': 'text/yaml' } }) });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    const finding = result.findings.find(f => f.message.includes('OpenAPI 3.1.0 (YAML)'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('not fully validated'), 'the report must say what it could not check');
  });

  it('should deduct on a YAML description missing paths', async () => {
    const yaml = ['openapi: 3.1.0', 'info:', '  title: Acme API', 'servers:', '  - url: https://api.example.com'].join('\n');
    const ctx = mockContext({ '/openapi.yaml': mockResponse({ body: yaml, headers: { 'content-type': 'text/yaml' } }) });
    const result = await check(ctx);
    assert.equal(result.score, 85);
  });

  it('should not apply a JSON Content-Type penalty to a YAML document', async () => {
    const yaml = [
      'openapi: 3.1.0',
      'info:',
      '  title: Acme API',
      'servers:',
      '  - url: https://api.example.com',
      'paths:',
      '  /a: {}',
    ].join('\n');
    const ctx = mockContext({ '/openapi.yaml': mockResponse({ body: yaml, headers: { 'content-type': 'application/yaml' } }) });
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });
});
