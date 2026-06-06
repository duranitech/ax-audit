import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/robots-txt.js';
import { mockContext, mockResponse } from '../helpers.js';

describe('robots-txt', () => {
  it('should return score 0 when /robots.txt is not found', async () => {
    const ctx = mockContext();
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.equal(result.findings[0].status, 'fail');
  });

  it('should score well with all core crawlers configured', async () => {
    const body = [
      'User-agent: GPTBot',
      'Allow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      'User-agent: ChatGPT-User',
      'Allow: /',
      '',
      'User-agent: Claude-SearchBot',
      'Allow: /',
      '',
      'User-agent: Google-Extended',
      'Allow: /',
      '',
      'User-agent: PerplexityBot',
      'Allow: /',
      '',
      'User-agent: OAI-SearchBot',
      'Allow: /',
      '',
      'User-agent: CCBot',
      'Allow: /',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    assert.ok(result.score >= 80);
    assert.ok(result.findings.some(f => f.message.includes('All') && f.message.includes('core AI crawlers')));
  });

  it('should penalize missing core crawlers', async () => {
    const body = [
      'User-agent: GPTBot',
      'Allow: /',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    assert.ok(result.score < 100);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('core AI crawlers configured')));
  });

  it('should detect blocked crawlers', async () => {
    const body = [
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('explicitly blocked')));
  });

  it('should detect wildcard blocking unconfigured crawlers', async () => {
    const body = [
      'User-agent: *',
      'Disallow: /',
      '',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('wildcard')));
  });

  it('should handle multi-UA blocks correctly', async () => {
    const body = [
      'User-agent: GPTBot',
      'User-agent: ClaudeBot',
      'Disallow: /',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    // Both GPTBot and ClaudeBot should be blocked
    const blockedFinding = result.findings.find(f => f.message.includes('explicitly blocked'));
    assert.ok(blockedFinding);
    assert.ok(blockedFinding.detail.includes('GPTBot'));
    assert.ok(blockedFinding.detail.includes('ClaudeBot'));
  });

  it('should detect partial path restrictions', async () => {
    const body = [
      'User-agent: GPTBot',
      'Disallow: /private/',
      'Disallow: /api/',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.message.includes('partial path restrictions')));
  });

  it('should penalize missing Sitemap directive', async () => {
    const body = [
      'User-agent: GPTBot',
      'Allow: /',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('Sitemap')));
  });

  it('should skip comment lines', async () => {
    const body = [
      '# This is a comment',
      'User-agent: GPTBot',
      '# Another comment',
      'Allow: /',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');

    const ctx = mockContext({ '/robots.txt': mockResponse({ body }) });
    const result = await check(ctx);
    // Should still detect GPTBot
    assert.ok(result.findings.some(f => f.message.includes('core AI crawlers')));
  });

  it('should clamp score between 0 and 100', async () => {
    // Many blocked bots should not go below 0
    const lines = ['User-agent: *', 'Disallow: /'];
    const ctx = mockContext({ '/robots.txt': mockResponse({ body: lines.join('\n') }) });
    const result = await check(ctx);
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  });

  describe('content signals (Content Signals Policy)', () => {
    const FULL_CONFIG = [
      'User-agent: GPTBot', 'Allow: /', '',
      'User-agent: ClaudeBot', 'Allow: /', '',
      'User-agent: ChatGPT-User', 'Allow: /', '',
      'User-agent: Claude-SearchBot', 'Allow: /', '',
      'User-agent: Google-Extended', 'Allow: /', '',
      'User-agent: PerplexityBot', 'Allow: /', '',
      'User-agent: OAI-SearchBot', 'Allow: /', '',
      'User-agent: CCBot', 'Allow: /', '',
      'Sitemap: https://example.com/sitemap.xml',
    ];

    async function audit(bodyLines) {
      const ctx = mockContext({ '/robots.txt': mockResponse({ body: bodyLines.join('\n') }) });
      return check(ctx);
    }

    it('should report declared content signals as a pass finding', async () => {
      const result = await audit(['User-agent: *', 'Content-Signal: search=yes, ai-train=no', 'Allow: /', '', ...FULL_CONFIG]);
      const finding = result.findings.find(f => f.message.includes('Content signals declared'));
      assert.ok(finding);
      assert.equal(finding.status, 'pass');
      assert.ok(finding.message.includes('User-agent: *'));
      assert.ok(finding.message.includes('search=yes'));
      assert.ok(finding.message.includes('ai-train=no'));
    });

    it('should not change the score in 3.x (informational only)', async () => {
      const without = await audit(FULL_CONFIG);
      const withSignals = await audit(['User-agent: *', 'Content-Signal: search=yes, ai-train=no', 'Allow: /', '', ...FULL_CONFIG]);
      const withMalformed = await audit(['User-agent: *', 'Content-Signal: search=maybe', 'Allow: /', '', ...FULL_CONFIG]);
      assert.equal(withSignals.score, without.score);
      assert.equal(withMalformed.score, without.score);
    });

    it('should warn when no Content-Signal directive is present', async () => {
      const result = await audit(FULL_CONFIG);
      assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('No Content-Signal')));
    });

    it('should warn on malformed signal segments', async () => {
      const result = await audit(['User-agent: *', 'Content-Signal: search=maybe, ai-train', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('Malformed content signal'));
      assert.ok(finding);
      assert.equal(finding.status, 'warn');
      assert.ok(finding.detail.includes('search=maybe'));
      assert.ok(finding.detail.includes('ai-train'));
    });

    it('should warn on unknown signal names', async () => {
      const result = await audit(['User-agent: *', 'Content-Signal: search=yes, foo-bar=no', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('Unknown content signal'));
      assert.ok(finding);
      assert.equal(finding.status, 'warn');
      assert.ok(finding.detail.includes('foo-bar=no'));
      // The valid part is still reported.
      assert.ok(result.findings.some(f => f.message.includes('Content signals declared') && f.message.includes('search=yes')));
    });

    it('should attribute signals to every User-agent in a shared group', async () => {
      const result = await audit(['User-agent: GPTBot', 'User-agent: ClaudeBot', 'Content-Signal: ai-train=no', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('Content signals declared'));
      assert.ok(finding);
      assert.ok(finding.message.includes('GPTBot, ClaudeBot'));
    });

    it('should parse directive name and values case-insensitively', async () => {
      const result = await audit(['User-agent: *', 'content-signal: Search=YES, AI-Train=No', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('Content signals declared'));
      assert.ok(finding);
      assert.ok(finding.message.includes('search=yes'));
      assert.ok(finding.message.includes('ai-train=no'));
    });

    it('should warn when Content-Signal appears outside a User-agent group', async () => {
      const result = await audit(['Content-Signal: search=yes', '', 'User-agent: *', 'Allow: /']);
      assert.ok(result.findings.some(f => f.status === 'warn' && f.message.includes('outside a User-agent group')));
    });

    it('should report each group with its own signals', async () => {
      const result = await audit([
        'User-agent: GPTBot', 'Content-Signal: ai-train=no', 'Allow: /', '',
        'User-agent: *', 'Content-Signal: search=yes', 'Allow: /',
      ]);
      const declared = result.findings.filter(f => f.message.includes('Content signals declared'));
      assert.equal(declared.length, 2);
    });

    it('should not let a Content-Signal line leak the next User-agent into the previous group', async () => {
      // Content-Signal closes the group like any other directive.
      const result = await audit([
        'User-agent: GPTBot', 'Content-Signal: ai-train=no', '',
        'User-agent: ClaudeBot', 'Disallow: /',
      ]);
      const blocked = result.findings.find(f => f.message.includes('explicitly blocked'));
      assert.ok(blocked);
      assert.equal(blocked.detail, 'ClaudeBot');
    });
  });
});
