import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { meta, detectGeneration } from '../../dist/checks/agent-card.js';
import { mockContext, mockResponse } from '../helpers.js';

const CANONICAL = '/.well-known/agent-card.json';
const LEGACY = '/.well-known/agent.json';
const JSON_HEADERS = { 'content-type': 'application/json' };

const CARD_V1 = {
  name: 'Acme Agent',
  description: 'Answers questions about Acme products.',
  version: '1.2.0',
  capabilities: { streaming: true, pushNotifications: false },
  supportedInterfaces: [{ url: 'https://example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'lookup', name: 'Lookup', description: 'Look up a product', tags: ['catalog'] }],
  provider: { organization: 'Acme', url: 'https://example.com' },
  documentationUrl: 'https://example.com/docs',
  iconUrl: 'https://example.com/icon.png',
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
};

const CARD_V03 = {
  name: 'Acme Agent',
  description: 'Answers questions about Acme products.',
  url: 'https://example.com/a2a',
  version: '0.9.0',
  protocolVersion: '0.3.0',
  capabilities: { streaming: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'lookup', name: 'Lookup', description: 'Look up a product', tags: [] }],
  provider: { organization: 'Acme', url: 'https://example.com' },
  documentationUrl: 'https://example.com/docs',
  iconUrl: 'https://example.com/icon.png',
};

function ctxFor(card, { path = CANONICAL, headers = JSON_HEADERS, body } = {}) {
  return mockContext({
    [path]: mockResponse({ body: body ?? JSON.stringify(card), headers }),
  });
}

describe('agent-card: identity and aliases', () => {
  it('should answer to its former id so CI flags and baselines keep working', () => {
    assert.equal(meta.id, 'agent-card');
    assert.ok(meta.aliases.includes('agent-json'));
  });
});

describe('agent-card: discovery', () => {
  it('should report N/A when the site is not agent-facing', async () => {
    const result = await check(mockContext());
    assert.equal(result.applicable, false, 'asking a brochure site for an Agent Card is noise');
    assert.equal(result.findings[0].status, 'pass');
    assert.ok(result.findings[0].detail.includes('--profile agent'));
  });

  it('should fail an agent-facing site with no card', async () => {
    const ctx = mockContext(
      { '/openapi.json': mockResponse({ body: '{"openapi":"3.1.0"}' }) },
      { html: '<html><body><a href="/api">API</a></body></html>' },
    );
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.notEqual(result.applicable, false);
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding.detail.includes('agent-facing'));
    assert.ok(finding.hint.includes('nothing tells an agent what'));
  });

  it('should apply when the profile forces it', async () => {
    const result = await check({ ...mockContext(), profile: 'agent' });
    assert.notEqual(result.applicable, false);
    assert.equal(result.score, 0);
  });

  it('should score a complete 1.0 card at the registered path 100', async () => {
    const result = await check(ctxFor(CARD_V1));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('A2A 1.0')));
  });

  it('should find a card at the pre-0.3 path and warn about it', async () => {
    const result = await check(ctxFor(CARD_V03, { path: LEGACY }));
    const finding = result.findings.find((f) => f.message.includes('pre-0.3 path'));
    assert.ok(finding, 'a card only at the old path is invisible to current clients');
    assert.equal(finding.status, 'warn');
    assert.ok(finding.hint.includes('agent-card.json'));
    assert.ok(result.score > 0, 'the card is still validated, not discarded');
  });

  it('should prefer the registered path when both exist', async () => {
    const ctx = mockContext({
      [CANONICAL]: mockResponse({ body: JSON.stringify(CARD_V1), headers: JSON_HEADERS }),
      [LEGACY]: mockResponse({ body: '{"broken":', headers: JSON_HEADERS }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
    assert.ok(!result.findings.some((f) => f.message.includes('pre-0.3 path')));
  });

  it('should ignore an empty body at the canonical path and fall through', async () => {
    const ctx = mockContext({
      [CANONICAL]: mockResponse({ body: '   ', headers: JSON_HEADERS }),
      [LEGACY]: mockResponse({ body: JSON.stringify(CARD_V03), headers: JSON_HEADERS }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('pre-0.3 path')));
  });

  it('should accept the registered A2A media type', async () => {
    const result = await check(ctxFor(CARD_V1, { headers: { 'content-type': 'application/a2a+json' } }));
    assert.equal(result.score, 100);
  });

  it('should deduct 5 for a wrong Content-Type', async () => {
    const result = await check(ctxFor(CARD_V1, { headers: { 'content-type': 'text/plain' } }));
    assert.equal(result.score, 95);
  });

  it('should score 10 for invalid JSON', async () => {
    const result = await check(ctxFor(null, { body: '{"name": ' }));
    assert.equal(result.score, 10);
    assert.ok(result.findings.some((f) => f.message === 'Invalid JSON'));
  });
});

describe('agent-card: generation detection', () => {
  it('should read supportedInterfaces as 1.0', () => {
    assert.equal(detectGeneration({ supportedInterfaces: [] }), 'v1');
  });

  it('should read a top-level url or protocolVersion as 0.3', () => {
    assert.equal(detectGeneration({ url: 'https://e.com/a2a' }), 'v0.3');
    assert.equal(detectGeneration({ protocolVersion: '0.3.0' }), 'v0.3');
  });

  it('should report an unrecognised shape rather than guessing', () => {
    assert.equal(detectGeneration({ name: 'x' }), 'unknown');
  });

  it('should fail a card matching neither generation', async () => {
    const result = await check(ctxFor({ name: 'Acme', description: 'x', skills: [] }));
    const finding = result.findings.find((f) => f.message.includes('neither A2A 1.0 nor 0.3'));
    assert.ok(finding);
    assert.equal(finding.status, 'fail');
  });
});

describe('agent-card: A2A 1.0 rules', () => {
  it('should require the 1.0 field set', async () => {
    const { supportedInterfaces, ...missing } = { ...CARD_V1 };
    void supportedInterfaces;
    const result = await check(ctxFor({ ...missing, supportedInterfaces: [] }));
    assert.ok(result.findings.some((f) => f.message.includes('supportedInterfaces[] is empty')));
  });

  it('should deduct 15 per missing required field', async () => {
    const card = { ...CARD_V1 };
    delete card.defaultOutputModes;
    const result = await check(ctxFor(card));
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('"defaultOutputModes" missing')));
  });

  it('should warn when an interface omits url, binding or version', async () => {
    const card = { ...CARD_V1, supportedInterfaces: [{ url: 'https://example.com/a2a' }] };
    const result = await check(ctxFor(card));
    const finding = result.findings.find((f) => f.message.includes('missing url, protocolBinding or protocolVersion'));
    assert.ok(finding);
    assert.equal(result.score, 90);
  });

  it('should warn on an unrecognised protocolBinding', async () => {
    const card = {
      ...CARD_V1,
      supportedInterfaces: [{ url: 'https://example.com/a2a', protocolBinding: 'SOAP', protocolVersion: '1.0' }],
    };
    const result = await check(ctxFor(card));
    const finding = result.findings.find((f) => f.message.includes('unrecognised protocolBinding'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('JSONRPC'));
    assert.equal(result.score, 95);
  });

  it('should accept every documented binding', async () => {
    for (const protocolBinding of ['JSONRPC', 'GRPC', 'HTTP+JSON']) {
      const card = {
        ...CARD_V1,
        supportedInterfaces: [{ url: 'https://example.com/a2a', protocolBinding, protocolVersion: '1.0' }],
      };
      const result = await check(ctxFor(card));
      assert.equal(result.score, 100, `${protocolBinding} should be accepted`);
    }
  });

  it('should warn when an interface points off-origin', async () => {
    const card = {
      ...CARD_V1,
      supportedInterfaces: [{ url: 'https://other.example.net/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    };
    const result = await check(ctxFor(card));
    assert.ok(result.findings.some((f) => f.message.includes('point to a different origin')));
    assert.equal(result.score, 95);
  });
});

describe('agent-card: A2A 0.3 rules', () => {
  it('should score a complete 0.3 card 100 at the registered path', async () => {
    const result = await check(ctxFor(CARD_V03));
    assert.equal(result.score, 100);
  });

  it('should explain what 1.0 changed', async () => {
    const result = await check(ctxFor(CARD_V03));
    const finding = result.findings.find((f) => f.message.includes('A2A 0.3'));
    assert.ok(finding.detail.includes('supportedInterfaces'));
  });

  it('should require protocolVersion on a 0.3 card', async () => {
    const card = { ...CARD_V03 };
    delete card.protocolVersion;
    const result = await check(ctxFor(card));
    // Removing protocolVersion leaves url, so the card is still 0.3-shaped.
    assert.ok(result.findings.some((f) => f.message.includes('"protocolVersion" missing')));
  });

  it('should warn when url points to another origin', async () => {
    const result = await check(ctxFor({ ...CARD_V03, url: 'https://other.example.net/a2a' }));
    assert.ok(result.findings.some((f) => f.message.includes('different origin')));
    assert.equal(result.score, 95);
  });

  it('should warn when url is relative', async () => {
    const result = await check(ctxFor({ ...CARD_V03, url: '/a2a' }));
    assert.ok(result.findings.some((f) => f.message.includes('not a valid absolute URL')));
  });
});

describe('agent-card: rules common to both generations', () => {
  it('should flag the removed authentication field', async () => {
    const result = await check(ctxFor({ ...CARD_V1, authentication: { schemes: ['bearer'] } }));
    const finding = result.findings.find((f) => f.message.includes('"authentication", removed'));
    assert.ok(finding, 'authentication was replaced by securitySchemes in 0.2.x');
    assert.ok(finding.hint.includes('securitySchemes'));
    assert.equal(result.score, 95);
  });

  it('should report skills missing id or description', async () => {
    const card = { ...CARD_V1, skills: [{ id: 'a', description: 'ok' }, { name: 'no id' }] };
    const result = await check(ctxFor(card));
    assert.ok(result.findings.some((f) => f.message.includes('missing id or description')));
    assert.equal(result.score, 95);
  });

  it('should deduct 10 for an empty skills array', async () => {
    const result = await check(ctxFor({ ...CARD_V1, skills: [] }));
    assert.equal(result.score, 90);
  });

  it('should report declared capability extensions with their URIs', async () => {
    const card = {
      ...CARD_V1,
      capabilities: { streaming: true, extensions: [{ uri: 'https://github.com/google-agentic-commerce/ap2/tree/v0.1' }] },
    };
    const result = await check(ctxFor(card));
    const finding = result.findings.find((f) => f.message.includes('capability extension'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('ap2'));
  });

  it('should report JWS signatures on the card', async () => {
    const result = await check(ctxFor({ ...CARD_V1, signatures: [{ protected: 'e30', signature: 'sig' }] }));
    assert.ok(result.findings.some((f) => f.message.includes('JWS signature')));
  });

  it('should deduct 5 when no descriptive fields are present', async () => {
    const card = { ...CARD_V1 };
    delete card.provider;
    delete card.documentationUrl;
    delete card.iconUrl;
    const result = await check(ctxFor(card));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('No optional descriptive fields')));
  });

  it('should clamp the score to [0,100]', async () => {
    const result = await check(ctxFor({ supportedInterfaces: [] }));
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});
