import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/well-known-ai.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('well-known-ai', () => {
  it('should return score 0 when no files are present', async () => {
    const ctx = mockContext();
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings[0].message.includes('0/'));
  });

  it('should score proportionally when one file is present', async () => {
    const ctx = mockContext({
      '/.well-known/ai.txt': mockResponse({ body: 'User-Agent: *\nAllow: /\n' }),
    });
    const result = await check(ctx);
    assert.ok(result.score > 0);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('ai.txt present')));
  });

  it('should score 100 when every probe succeeds', async () => {
    const ctx = mockContext({
      '/.well-known/ai.txt': mockResponse({ body: 'User-Agent: *\nAllow: /\n' }),
      '/.well-known/genai.txt': mockResponse({ body: 'policy text' }),
      '/.well-known/ai-plugin.json': mockResponse({ body: JSON.stringify({ schema_version: 'v1', name_for_model: 'x' }) }),
      '/agents.json': mockResponse({ body: JSON.stringify({ name: 'My agent', operations: [] }) }),
      '/.well-known/nlweb.json': mockResponse({ body: JSON.stringify({}) }),
    });
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should find ai-plugin.json at the alternate root path but say nothing reads it', async () => {
    const ctx = mockContext({
      '/ai-plugin.json': mockResponse({ body: JSON.stringify({ schema_version: 'v1', name_for_model: 'acme' }) }),
    });
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('ai-plugin.json served at'));
    assert.ok(finding, 'the file is found');
    assert.equal(finding.status, 'warn', 'ChatGPT plugins shut down in April 2024');
    assert.ok(finding.detail.includes('2024-04-09'));
  });

  it('should warn when ai-plugin.json is not valid JSON', async () => {
    const ctx = mockContext({
      '/.well-known/ai-plugin.json': mockResponse({ body: 'not json{{{' }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('does not look valid')));
  });

  it('should warn when agents.json is JSON but has none of the expected fields', async () => {
    const ctx = mockContext({
      '/agents.json': mockResponse({ body: JSON.stringify({ unrelated: 1 }) }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('does not look valid')));
  });

  it('should treat empty bodies as not-present', async () => {
    const ctx = mockContext({
      '/.well-known/ai.txt': mockResponse({ body: '   \n  ' }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('ai.txt not found')));
  });

  it('should clamp score within [0,100]', async () => {
    const ctx = mockContext();
    const result = await check(ctx);
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});

describe('well-known-ai: honest standing', () => {
  it('should not fault a site for omitting a file that does not exist', async () => {
    const result = await check(mockContext());
    const finding = result.findings.find((f) => f.message.includes('nlweb.json'));
    assert.ok(finding);
    assert.equal(finding.status, 'pass', 'nlweb.json appears in no NLWeb release, document or commit');
    assert.ok(finding.detail.includes('does not exist'));
    assert.ok(finding.detail.includes('/ask'), 'the report should name what NLWeb actually exposes');
  });

  it('should treat the other retired formats the same way', async () => {
    const result = await check(mockContext());
    for (const [label, evidence] of [
      ['genai.txt', 'No specification'],
      ['ai-plugin.json', '2024-04-09'],
      ['agents.json', '2025-08-21'],
    ]) {
      const finding = result.findings.find((f) => f.message.includes(label));
      assert.ok(finding, `${label} should be reported`);
      assert.equal(finding.status, 'pass', `${label} is retired; omitting it is correct`);
      assert.ok(finding.detail.includes(evidence), `${label} should cite why`);
    }
  });

  it('should still warn about a genuinely open question', async () => {
    const result = await check(mockContext());
    const finding = result.findings.find((f) => f.message.includes('ai.txt not found'));
    assert.ok(finding);
    assert.equal(finding.status, 'warn');
    assert.ok(finding.hint.includes('Content-Signal'), 'the hint should point at what operators actually read');
  });

  it('should say the score is frozen and why', async () => {
    const result = await check(mockContext());
    assert.ok(result.findings[0].detail.includes('frozen for 3.x compatibility'));
    assert.ok(result.findings[0].detail.includes('4.0'));
  });

  it('should keep the pre-3.7 scoring formula exactly', async () => {
    assert.equal((await check(mockContext())).score, 0);
    const two = mockContext({
      '/.well-known/ai.txt': mockResponse({ body: 'User-Agent: *\nDisallow: *.jpg' }),
      '/.well-known/genai.txt': mockResponse({ body: 'policy: none' }),
    });
    assert.equal((await check(two)).score, 40, '2/5 must still score 40');
  });

  it('should report a Web Bot Auth key directory without scoring it', async () => {
    const ctx = mockContext({
      '/.well-known/http-message-signatures-directory': mockResponse({
        body: JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'abc' }] }),
        headers: { 'content-type': 'application/http-message-signatures-directory+json' },
      }),
    });
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('Web Bot Auth key directory published'));
    assert.ok(finding);
    assert.equal(finding.status, 'pass');
    assert.ok(finding.detail.includes('2026-09-01'));
    assert.equal(result.score, 0, 'reported files are never scored');
  });

  it('should flag a malformed key directory', async () => {
    const ctx = mockContext({
      '/.well-known/http-message-signatures-directory': mockResponse({ body: '{"not":"a jwks"}' }),
    });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('malformed')));
  });

  it('should report a TDMRep declaration and note its legal standing', async () => {
    const ctx = mockContext({
      '/.well-known/tdmrep.json': mockResponse({
        body: JSON.stringify([{ location: '/', 'tdm-reservation': 1, 'tdm-policy': 'https://example.com/tdm' }]),
      }),
    });
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('TDM Reservation Protocol published'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('EU GPAI Code of Practice'));
  });

  it('should reject a tdmrep.json that is not an array of locations', async () => {
    const ctx = mockContext({ '/.well-known/tdmrep.json': mockResponse({ body: '{"tdm-reservation":1}' }) });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('TDM Reservation Protocol')));
  });

  it('should report AGENTS.md when present', async () => {
    const ctx = mockContext({ '/AGENTS.md': mockResponse({ body: '# Agents\n\n## Install\nnpm i\n' }) });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('AGENTS.md published')));
  });

  it('should stay silent about current files that are absent', async () => {
    const result = await check(mockContext());
    for (const label of ['Web Bot Auth', 'TDM Reservation', 'AGENTS.md', 'OpenAI Apps']) {
      assert.ok(!result.findings.some((f) => f.message.includes(label)), `${label} should not be demanded`);
    }
  });
});
