import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { USER_AGENT } from '../dist/constants.js';
import { guideUrl } from '../dist/guide-urls.js';

/**
 * Ownership lives in a handful of constants and a lot of prose. A stray old URL
 * in one hint string is easy to add and hard to notice, and it ships: guide URLs
 * appear in every finding, and the user agent reaches the logs of every site
 * audited. These tests fail the build rather than letting one slip through.
 */
const OWNER = {
  domain: 'axrush.com',
  org: 'axrush',
  contact: 'info@axrush.com',
};

/** Domains and handles that must not reappear anywhere in the project. */
const RETIRED = [/lucioduran/i, /lucio\s+duran/i];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|md|json)$/.test(entry.name) ? [path] : [];
  });
}

describe('ownership: shipped identity', () => {
  it('should build guide URLs on the current domain', () => {
    assert.equal(guideUrl('robots-txt'), `https://${OWNER.domain}/guides/robots-txt`);
    assert.equal(guideUrl('robots-txt', 'missing-crawlers'), `https://${OWNER.domain}/guides/robots-txt#missing-crawlers`);
  });

  it('should identify the current repository in the user agent', () => {
    // This string reaches the logs of every site audited.
    assert.match(USER_AGENT, /^ax-audit\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/axrush\/ax-audit\)$/);
  });

  it('should declare the company as author and owner in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    assert.match(pkg.author, /AX Rush/);
    assert.equal(pkg.homepage, `https://${OWNER.domain}`);
    assert.ok(pkg.repository.url.includes(`github.com/${OWNER.org}/`));
    assert.ok(pkg.bugs.url.includes(`github.com/${OWNER.org}/`));
  });

  it('should assign copyright to the company', () => {
    assert.match(readFileSync('LICENSE', 'utf-8'), /Copyright \d{4} AX Rush/);
  });

  it('should route security reports to the company mailbox', () => {
    assert.ok(readFileSync('SECURITY.md', 'utf-8').includes(OWNER.contact));
  });
});

describe('ownership: no retired identity anywhere', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('docs'), 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'CHANGELOG.md', 'package.json'];

  for (const file of files) {
    it(`should carry no retired domain or name in ${file}`, () => {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of RETIRED) {
        const match = content.match(pattern);
        assert.equal(match, null, `${file} still contains "${match?.[0]}"`);
      }
    });
  }
});
