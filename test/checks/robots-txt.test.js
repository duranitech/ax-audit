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

  it('should score well with the pre-4.0 eight-crawler configuration', async () => {
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
    // 4.0 scores against twelve core crawlers, so the eight-crawler
    // configuration that used to be perfect now falls short by design.
    assert.ok(result.score >= 80);
    assert.ok(result.findings.some(f => f.message.includes('core AI crawlers configured')));
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
      const result = await audit(['User-agent: *', 'Content-Signal: ai-train', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('Malformed content signal'));
      assert.ok(finding);
      assert.equal(finding.status, 'warn');
      assert.ok(finding.detail.includes('ai-train'));
    });

    it('should separate a bad value on a known signal from a malformed segment', async () => {
      const result = await audit(['User-agent: *', 'Content-Signal: search=maybe, ai-train', 'Allow: /']);
      const badValue = result.findings.find(f => f.message.includes('out-of-vocabulary value'));
      assert.ok(badValue, 'search=maybe is a known signal with an unusable value');
      assert.ok(badValue.detail.includes('search=maybe'));
      assert.ok(!badValue.detail.includes('ai-train'));

      const malformed = result.findings.find(f => f.message.includes('Malformed content signal'));
      assert.ok(malformed, 'ai-train has no value at all');
      assert.ok(malformed.detail.includes('ai-train'));
    });

    it('should accept the use= field and reject an unknown use value', async () => {
      const ok = await audit(['User-agent: *', 'Content-signal: search=yes, ai-train=no, use=reference', 'Allow: /']);
      const declared = ok.findings.find(f => f.message.includes('Content signals declared'));
      assert.ok(declared);
      assert.ok(declared.message.includes('use=reference'));

      const bad = await audit(['User-agent: *', 'Content-Signal: use=partial', 'Allow: /']);
      const finding = bad.findings.find(f => f.message.includes('out-of-vocabulary value'));
      assert.ok(finding);
      assert.ok(finding.detail.includes('use=partial'));
    });

    it('should note when signals come from a Cloudflare-managed block', async () => {
      const result = await audit([
        '# BEGIN Cloudflare Managed content',
        'User-agent: *',
        'Content-signal: search=yes, ai-train=no',
        'Allow: /',
        '# END Cloudflare Managed Content',
      ]);
      assert.ok(result.findings.some(f => f.message.includes('Cloudflare-managed robots.txt block')));
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

  describe('AI usage preferences (IETF AIPREF Content-Usage)', () => {

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
    it('should stay silent when no Content-Usage directive exists', async () => {
      const result = await audit(FULL_CONFIG);
      assert.ok(
        !result.findings.some(f => f.message.includes('Content-Usage') || f.message.includes('usage preferences')),
        'an absent pre-last-call directive must not produce noise',
      );
    });

    it('should report declared usage preferences', async () => {
      const result = await audit(['User-agent: *', 'Content-Usage: train-ai=n, search=y', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('AI usage preferences declared'));
      assert.ok(finding);
      assert.equal(finding.status, 'pass');
      assert.ok(finding.message.includes('train-ai=n'));
      assert.ok(finding.message.includes('search=y'));
    });

    it('should report the path scope of a path-limited rule', async () => {
      const result = await audit(['User-agent: *', 'Content-Usage: /blog/ train-ai=y', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('AI usage preferences declared'));
      assert.ok(finding.message.includes('for /blog/'));
    });

    it('should flag Content Signals vocabulary used under Content-Usage', async () => {
      const result = await audit(['User-agent: *', 'Content-Usage: ai-train=no', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('Content Signals vocabulary'));
      assert.ok(finding, 'ai-train=no under Content-Usage is a silent no-op');
      assert.equal(finding.status, 'warn');
      assert.ok(finding.detail.includes('ai-train=no'));
      assert.ok(finding.hint.includes('train-ai=n'));
    });

    it('should flag values outside y/n', async () => {
      const result = await audit(['User-agent: *', 'Content-Usage: train-ai=yes', 'Allow: /']);
      const finding = result.findings.find(f => f.message.includes('outside the AIPREF vocabulary'));
      assert.ok(finding);
      assert.ok(finding.detail.includes('train-ai=yes'));
    });

    it('should flag unknown extension tokens', async () => {
      const result = await audit(['User-agent: *', 'Content-Usage: train-ai=n, remix=y', 'Allow: /']);
      assert.ok(result.findings.some(f => f.message.includes('Unknown Content-Usage token')));
      assert.ok(result.findings.some(f => f.message.includes('AI usage preferences declared')));
    });

    it('should warn when a rule sits outside a User-agent group', async () => {
      const result = await audit(['Content-Usage: train-ai=n', 'User-agent: *', 'Allow: /']);
      assert.ok(result.findings.some(f => f.message.includes('Content-Usage rule outside a User-agent group')));
    });

    it('should never change the robots-txt score', async () => {
      const withUsage = await audit([...FULL_CONFIG, 'User-agent: GPTBot', 'Content-Usage: train-ai=n']);
      const without = await audit(FULL_CONFIG);
      assert.equal(withUsage.score, without.score);
    });
  });
});

describe('robots-txt: 4.0 scoring against the current catalogue', () => {
  const CORE_12 = [
    'GPTBot', 'ClaudeBot', 'Meta-ExternalAgent', 'Google-Extended', 'Applebot-Extended',
    'Amazonbot', 'Bytespider', 'CCBot', 'OAI-SearchBot', 'Claude-SearchBot',
    'PerplexityBot', 'ChatGPT-User',
  ];
  const FULL = [...CORE_12.flatMap(bot => [`User-agent: ${bot}`, 'Allow: /', '']), 'Sitemap: https://example.com/sitemap.xml'];

  async function audit(bodyLines) {
    const ctx = mockContext({ '/robots.txt': mockResponse({ body: bodyLines.join('\n') }) });
    return check(ctx);
  }

  it('should score 100 only when the full current core set is configured', async () => {
    assert.equal((await audit(FULL)).score, 100);
  });

  it('should now deduct for the crawlers the 3.x freeze exempted', async () => {
    const eightOnly = [
      'GPTBot', 'ClaudeBot', 'ChatGPT-User', 'Claude-SearchBot',
      'Google-Extended', 'PerplexityBot', 'OAI-SearchBot', 'CCBot',
    ];
    const lines = [...eightOnly.flatMap(b => [`User-agent: ${b}`, 'Allow: /', '']), 'Sitemap: https://example.com/sitemap.xml'];
    const result = await audit(lines);
    // 4 of 12 missing → round(4/12 × 30) = 10.
    assert.equal(result.score, 90, 'the 3.x eight-crawler configuration no longer scores 100');
  });

  it('should name what each missing crawler costs', async () => {
    const lines = ['User-agent: GPTBot', 'Allow: /', 'Sitemap: https://example.com/sitemap.xml'];
    const result = await audit(lines);
    const finding = result.findings.find(f => f.message.includes('core AI crawlers configured'));
    assert.ok(finding.detail.includes('Meta-ExternalAgent'));
    assert.ok(finding.detail.includes('Meta AI'), 'each missing crawler should say what it costs');
  });

  it('should cost more to block a search crawler than a training one', async () => {
    const baseline = await audit(FULL);
    const blockedSearch = await audit([...FULL, '', 'User-agent: meta-webindexer', 'Disallow: /']);
    const blockedTraining = await audit([...FULL, '', 'User-agent: Timpibot', 'Disallow: /']);

    assert.equal(baseline.score - blockedSearch.score, 5, 'a blocked search crawler removes you from its answers');
    assert.equal(baseline.score - blockedTraining.score, 2, 'blocking a training crawler is a policy choice');
  });

  it('should score crawlers added in 3.7, now that the freeze is gone', async () => {
    const baseline = await audit(FULL);
    const withBlock = await audit([...FULL, '', 'User-agent: Amzn-SearchBot', 'Disallow: /']);
    assert.ok(withBlock.score < baseline.score);
  });

  it('should call out blocked search crawlers as a visibility cost', async () => {
    const result = await audit([...FULL, '', 'User-agent: PerplexityBot', 'Disallow: /']);
    const finding = result.findings.find(f => f.message.includes('assistant search crawler'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('Perplexity answers'));
  });

  it('should record blocked training crawlers as a deliberate choice, not a defect', async () => {
    const result = await audit([...FULL, '', 'User-agent: CCBot', 'Disallow: /']);
    const finding = result.findings.find(f => f.message.includes('training crawler(s) blocked'));
    assert.equal(finding.status, 'pass');
  });

  it('should warn when a blocked user-fetcher is documented as ignoring robots.txt', async () => {
    const result = await audit([...FULL, '', 'User-agent: Perplexity-User', 'Disallow: /']);
    const finding = result.findings.find(f => f.message.includes('user-triggered fetcher'));
    assert.ok(finding.hint.includes('edge'));
  });

  it('should flag rules targeting retired or fictional tokens without deducting', async () => {
    const result = await audit([...FULL, '', 'User-agent: GeminiBot', 'Disallow: /']);
    const finding = result.findings.find(f => f.message.includes('retired or non-existent crawler token'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('Google-Extended'), 'the fix for GeminiBot is Google-Extended');
    assert.equal(result.score, (await audit(FULL)).score, 'an inert rule is not a defect');
  });
});

