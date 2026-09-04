import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/meta-tags.js';
import { mockContext } from '../helpers.js';

const FULL_OG = [
  '<meta property="og:title" content="Example">',
  '<meta property="og:description" content="An example site for testing">',
  '<meta property="og:url" content="https://example.com">',
  '<meta property="og:type" content="website">',
  '<meta property="og:image" content="https://example.com/og.png">',
  '<meta property="og:site_name" content="Example">',
].join('\n');

const FULL_TWITTER = [
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title" content="Example">',
  '<meta name="twitter:description" content="An example site for testing">',
  '<meta name="twitter:image" content="https://example.com/twitter.png">',
].join('\n');

describe('meta-tags', () => {
  it('should return score 0 when no HTML available', async () => {
    const ctx = mockContext({}, { html: '' });
    const result = await check(ctx);
    assert.equal(result.score, 0);
  });

  it('should score 100 with full AI, social, and identity coverage', async () => {
    const html = [
      '<html><head>',
      '<meta name="ai:summary" content="A website">',
      '<meta name="ai:content_type" content="website">',
      '<meta name="ai:author" content="John">',
      '<meta name="ai:api" content="https://api.example.com">',
      '<meta name="ai:agent_card" content="https://example.com/agent.json">',
      '<link rel="alternate" href="/llms.txt" type="text/plain">',
      '<link rel="alternate" href="/agent.json" type="application/json">',
      '<link rel="me" href="https://twitter.com/example">',
      '<link rel="me" href="https://github.com/example">',
      FULL_OG,
      FULL_TWITTER,
      '</head></html>',
    ].join('\n');
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.equal(result.score, 100);
  });

  it('should penalize missing AI meta tags', async () => {
    const html = `<html><head>${FULL_OG}${FULL_TWITTER}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('AI meta tags')));
  });

  it('should pass with 3+ AI meta tags', async () => {
    const html = [
      '<html><head>',
      '<meta name="ai:summary" content="A site">',
      '<meta name="ai:content_type" content="website">',
      '<meta name="ai:author" content="John">',
      '<link rel="alternate" href="/llms.txt">',
      '<link rel="alternate" href="/agent.json">',
      '<link rel="me" href="https://example.com">',
      FULL_OG,
      FULL_TWITTER,
      '</head></html>',
    ].join('\n');
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('AI meta tags')));
  });

  it('should penalize missing rel="alternate" to llms.txt', async () => {
    const html = `<html><head>${FULL_OG}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('llms.txt')));
  });

  it('should penalize missing rel="alternate" to agent.json', async () => {
    const html = `<html><head>${FULL_OG}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('Agent Card')));
  });

  it('should penalize missing rel="me" links', async () => {
    const html = `<html><head>${FULL_OG}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('rel="me"')));
  });

  it('should penalize entirely missing OpenGraph tags', async () => {
    const html = '<html><head></head></html>';
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('No OpenGraph')));
  });

  it('should warn about specific missing OG required tags', async () => {
    const html = `<html><head><meta property="og:title" content="X"></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('OpenGraph required tags missing')));
  });

  it('should warn about missing OG recommended tags when required are present', async () => {
    const og = [
      '<meta property="og:title" content="Example">',
      '<meta property="og:description" content="An example site for testing">',
      '<meta property="og:url" content="https://example.com">',
      '<meta property="og:type" content="website">',
    ].join('');
    const html = `<html><head>${og}${FULL_TWITTER}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('OpenGraph recommended tags missing')));
  });

  it('should warn about entirely missing Twitter Card tags', async () => {
    const html = `<html><head>${FULL_OG}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('No Twitter Card')));
  });

  it('should warn about specific missing Twitter required tags', async () => {
    const html = `<html><head>${FULL_OG}<meta name="twitter:card" content="summary"></head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('Twitter Card required tags missing')));
  });

  it('should detect alternate with attributes in any order', async () => {
    const html = `<html><head><link href="/llms.txt" rel="alternate" type="text/plain">${FULL_OG}${FULL_TWITTER}</head></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('llms.txt')));
  });

  it('should clamp score to 0 minimum', async () => {
    const html = '<html><head></head><body></body></html>';
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});
