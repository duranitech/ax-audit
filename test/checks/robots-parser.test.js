import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRobotsTxt,
  parseUserAgents,
  toBotEntries,
  collectLicenses,
  intentBlocked,
  parseContentSignalValue,
  parseContentUsageValue,
  parseRobotsLicenseDirectives,
} from '../../dist/checks/robots-parser.js';

describe('robots-parser: grouping (RFC 9309)', () => {
  it('should collapse consecutive User-agent lines into one group', () => {
    const r = parseRobotsTxt('User-agent: GPTBot\nUser-agent: ClaudeBot\nAllow: /');
    assert.equal(r.groups.length, 1);
    assert.deepEqual(r.groups[0].userAgents, ['GPTBot', 'ClaudeBot']);
    assert.deepEqual(r.groups[0].allow, ['/']);
  });

  it('should start a new group when User-agent follows a rule line', () => {
    const r = parseRobotsTxt('User-agent: GPTBot\nAllow: /\nUser-agent: CCBot\nDisallow: /');
    assert.equal(r.groups.length, 2);
    assert.deepEqual(r.groups[1].userAgents, ['CCBot']);
    assert.deepEqual(r.groups[1].disallow, ['/']);
  });

  it('should treat every group directive as closing the User-agent run', () => {
    for (const directive of ['Disallow: /x', 'Allow: /', 'Crawl-delay: 1', 'Content-Signal: search=yes', 'License: https://e.com/l.xml']) {
      const r = parseRobotsTxt(`User-agent: A\n${directive}\nUser-agent: B\nAllow: /`);
      assert.equal(r.groups.length, 2, `"${directive}" should close the group`);
    }
  });

  it('should strip trailing comments and ignore comment-only lines', () => {
    const r = parseRobotsTxt('# header\nUser-agent: GPTBot # the OpenAI trainer\nDisallow: / # everything');
    assert.deepEqual(r.groups[0].userAgents, ['GPTBot']);
    assert.deepEqual(r.groups[0].disallow, ['/']);
  });

  it('should collect Sitemap and Agentmap as global directives', () => {
    const r = parseRobotsTxt(
      'Sitemap: https://e.com/sitemap.xml\nAgentmap: https://e.com/.well-known/ai-catalog.json\nUser-agent: *\nAllow: /',
    );
    assert.deepEqual(r.sitemaps, ['https://e.com/sitemap.xml']);
    assert.deepEqual(r.agentmaps, ['https://e.com/.well-known/ai-catalog.json']);
    assert.equal(r.groups.length, 1);
  });

  it('should ignore a User-agent line with an empty value', () => {
    const r = parseRobotsTxt('User-agent:\nAllow: /');
    assert.equal(r.groups.length, 0);
  });

  it('should not crash on an empty or whitespace-only document', () => {
    assert.deepEqual(parseRobotsTxt('').groups, []);
    assert.equal(parseRobotsTxt('   \n\n  ').ruleLineCount, 0);
  });

  it('should detect the Cloudflare managed-content block', () => {
    const managed = '# BEGIN Cloudflare Managed content\nUser-agent: *\nContent-signal: search=yes\n# END Cloudflare Managed Content';
    assert.equal(parseRobotsTxt(managed).cloudflareManaged, true);
    assert.equal(parseRobotsTxt('User-agent: *\nAllow: /').cloudflareManaged, false);
  });

  it('should tolerate CRLF line endings', () => {
    const r = parseRobotsTxt('User-agent: GPTBot\r\nDisallow: /\r\n');
    assert.equal(r.groups[0].disallow[0], '/');
  });
});

describe('robots-parser: bot entries', () => {
  it('should mark a full Disallow as disallowed and restricted', () => {
    const [bot] = parseUserAgents('User-agent: CCBot\nDisallow: /');
    assert.equal(bot.disallowed, true);
    assert.equal(bot.hasRestrictions, true);
    assert.equal(bot.hasAllow, false);
  });

  it('should mark a path Disallow as restricted but not disallowed', () => {
    const [bot] = parseUserAgents('User-agent: GPTBot\nDisallow: /private/');
    assert.equal(bot.disallowed, false);
    assert.equal(bot.hasRestrictions, true);
  });

  it('should treat an empty Disallow value as no restriction (RFC 9309 "allow all")', () => {
    const [bot] = parseUserAgents('User-agent: GPTBot\nDisallow:');
    assert.equal(bot.disallowed, false);
    assert.equal(bot.hasRestrictions, false);
  });

  it('should merge a bot named in two groups, keeping the restriction', () => {
    const entries = parseUserAgents('User-agent: GPTBot\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].disallowed, true);
    assert.equal(entries[0].hasAllow, true);
  });

  it('should derive block intent from an explicit rule over the wildcard', () => {
    const entries = parseUserAgents('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /');
    assert.equal(intentBlocked(entries, 'GPTBot'), false);
    assert.equal(intentBlocked(entries, 'CCBot'), true, 'unlisted bots inherit the wildcard block');
  });

  it('should match crawler names case-insensitively for block intent', () => {
    const entries = parseUserAgents('User-agent: gptbot\nDisallow: /');
    assert.equal(intentBlocked(entries, 'GPTBot'), true);
  });

  it('should report no block intent when robots.txt has no wildcard group', () => {
    assert.equal(intentBlocked(parseUserAgents('User-agent: GPTBot\nAllow: /'), 'CCBot'), false);
  });

  it('should expose the same shape via toBotEntries', () => {
    const parsed = parseRobotsTxt('User-agent: GPTBot\nDisallow: /');
    assert.deepEqual(toBotEntries(parsed), parseUserAgents('User-agent: GPTBot\nDisallow: /'));
  });
});

describe('robots-parser: Content-Signal', () => {
  it('should accept the three policy signals', () => {
    const p = parseContentSignalValue('search=yes, ai-input=no, ai-train=no');
    assert.deepEqual(p.valid, ['search=yes', 'ai-input=no', 'ai-train=no']);
    assert.equal(p.malformed.length + p.unknown.length + p.invalidValue.length, 0);
  });

  it('should accept the use= field added in 2026', () => {
    for (const v of ['immediate', 'reference', 'full']) {
      assert.deepEqual(parseContentSignalValue(`use=${v}`).valid, [`use=${v}`]);
    }
  });

  it('should reject an out-of-vocabulary use= value', () => {
    const p = parseContentSignalValue('use=partial');
    assert.deepEqual(p.invalidValue, ['use=partial']);
    assert.equal(p.valid.length, 0);
  });

  it('should reject a non yes/no value on a boolean signal', () => {
    const p = parseContentSignalValue('ai-train=maybe');
    assert.deepEqual(p.invalidValue, ['ai-train=maybe']);
  });

  it('should report unknown signal names separately from malformed segments', () => {
    const p = parseContentSignalValue('search=yes, ai-remix=no, garbage');
    assert.deepEqual(p.valid, ['search=yes']);
    assert.deepEqual(p.unknown, ['ai-remix=no']);
    assert.deepEqual(p.malformed, ['garbage']);
  });

  it('should be case-insensitive and whitespace-tolerant', () => {
    const p = parseContentSignalValue('  Search = YES ,AI-Train=No ');
    assert.deepEqual(p.valid, ['search=yes', 'ai-train=no']);
  });

  it('should attach signals to the group they were declared in', () => {
    const r = parseRobotsTxt('User-agent: *\nContent-signal: search=yes, ai-train=no\nAllow: /');
    assert.deepEqual(r.groups[0].contentSignals, ['search=yes, ai-train=no']);
    assert.equal(r.orphanContentSignals.length, 0);
  });

  it('should record a Content-Signal declared before any group as an orphan', () => {
    const r = parseRobotsTxt('Content-Signal: search=yes\nUser-agent: *\nAllow: /');
    assert.deepEqual(r.orphanContentSignals, ['search=yes']);
    assert.equal(r.groups[0].contentSignals.length, 0);
  });
});

describe('robots-parser: Content-Usage (AIPREF)', () => {
  it('should parse the bare dictionary form', () => {
    const p = parseContentUsageValue('train-ai=n, search=y');
    assert.equal(p.path, null);
    assert.deepEqual(p.valid, ['train-ai=n', 'search=y']);
  });

  it('should parse the path-scoped form', () => {
    const p = parseContentUsageValue('/ai-ok/ train-ai=y');
    assert.equal(p.path, '/ai-ok/');
    assert.deepEqual(p.valid, ['train-ai=y']);
  });

  it('should reject values outside y/n', () => {
    const p = parseContentUsageValue('train-ai=no');
    assert.deepEqual(p.invalidValue, ['train-ai=no']);
    assert.equal(p.valid.length, 0);
  });

  it('should flag Content Signals tokens used under Content-Usage', () => {
    const p = parseContentUsageValue('ai-train=n');
    assert.deepEqual(p.crossVocabulary, ['ai-train=n']);
    assert.equal(p.unknown.length, 0, 'a foreign token is a vocabulary mix-up, not an unknown extension');
  });

  it('should separate unknown extension tokens from cross-vocabulary ones', () => {
    const p = parseContentUsageValue('train-ai=n, remix=y');
    assert.deepEqual(p.valid, ['train-ai=n']);
    assert.deepEqual(p.unknown, ['remix=y']);
  });

  it('should keep parameters from breaking a member', () => {
    const p = parseContentUsageValue('train-ai=n;allow=n');
    assert.deepEqual(p.valid, ['train-ai=n']);
  });

  it('should surface malformed dictionary segments', () => {
    const p = parseContentUsageValue('train-ai=n, 9bad=y');
    assert.deepEqual(p.valid, ['train-ai=n']);
    assert.deepEqual(p.malformed, ['9bad=y']);
  });

  it('should not mistake a leading token for a path', () => {
    const p = parseContentUsageValue('train-ai=n');
    assert.equal(p.path, null);
  });

  it('should attach usage rules to their group', () => {
    const r = parseRobotsTxt('User-agent: *\nContent-Usage: train-ai=n\nAllow: /');
    assert.deepEqual(r.groups[0].contentUsage, ['train-ai=n']);
  });
});

describe('robots-parser: RSL License directives', () => {
  it('should collect a global License directive', () => {
    assert.deepEqual(parseRobotsLicenseDirectives('License: https://e.com/l.xml\nUser-agent: *\nAllow: /'), [
      'https://e.com/l.xml',
    ]);
  });

  it('should collect a group-scoped License directive', () => {
    const r = parseRobotsTxt('User-agent: *\nLicense: https://e.com/g.xml\nAllow: /');
    assert.deepEqual(r.licenses, []);
    assert.deepEqual(r.groups[0].licenses, ['https://e.com/g.xml']);
    assert.deepEqual(collectLicenses(r), ['https://e.com/g.xml']);
  });

  it('should collect global and group-scoped directives together', () => {
    const text = 'License: https://e.com/global.xml\nUser-agent: GPTBot\nLicense: https://e.com/gpt.xml\nAllow: /';
    assert.deepEqual(parseRobotsLicenseDirectives(text), ['https://e.com/global.xml', 'https://e.com/gpt.xml']);
  });

  it('should be case-insensitive on the directive name', () => {
    assert.deepEqual(parseRobotsLicenseDirectives('license: https://e.com/l.xml'), ['https://e.com/l.xml']);
  });

  it('should return an empty list when no License directive exists', () => {
    assert.deepEqual(parseRobotsLicenseDirectives('User-agent: *\nAllow: /'), []);
  });
});
