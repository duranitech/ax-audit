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
/**
 * Two identities, deliberately separate:
 *
 * - **Durani Technologies** owns the code. It holds the copyright, publishes
 *   the package, and hosts the repositories.
 * - **AX Rush** is the product. It owns the web presence, the guides every
 *   finding links to, and the support contact.
 *
 * Conflating them is the mistake worth guarding against: a repository URL
 * under the brand, or a copyright line naming the product rather than the
 * legal entity.
 */
const OWNER = { name: 'Durani Technologies', org: 'duranitech' };
const BRAND = { name: 'AX Rush', domain: 'axrush.com', contact: 'info@axrush.com' };

/** Domains and handles that must not reappear anywhere in the project. */
const RETIRED = [/lucioduran/i, /lucio\s+duran/i, /github\.com\/axrush/i];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|md|json)$/.test(entry.name) ? [path] : [];
  });
}

describe('ownership: shipped identity', () => {
  it('should build guide URLs on the product domain', () => {
    assert.equal(guideUrl('robots-txt'), `https://${BRAND.domain}/guides/robots-txt`);
    assert.equal(
      guideUrl('robots-txt', 'missing-crawlers'),
      `https://${BRAND.domain}/guides/robots-txt#missing-crawlers`,
    );
  });

  it('should identify the owning organisation in the user agent', () => {
    // This string reaches the logs of every site audited.
    assert.match(USER_AGENT, /^ax-audit\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/duranitech\/ax-audit\)$/);
  });

  it('should name the owning company as author, and the product as homepage', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    assert.match(pkg.author, new RegExp(OWNER.name));
    assert.equal(pkg.homepage, `https://${BRAND.domain}`);
  });

  it('should host repositories under the owning organisation, not the brand', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    for (const url of [pkg.repository.url, pkg.bugs.url]) {
      assert.ok(url.includes(`github.com/${OWNER.org}/`), `${url} should be under github.com/${OWNER.org}`);
      assert.ok(!url.includes(`github.com/${BRAND.domain.split('.')[0]}/`), 'the brand is not a GitHub organisation');
    }
  });

  it('should assign copyright to the legal entity, not the product', () => {
    const licence = readFileSync('LICENSE', 'utf-8');
    assert.match(licence, new RegExp(`Copyright \\d{4} ${OWNER.name}`));
    assert.ok(!/Copyright \d{4} AX Rush/.test(licence), 'a brand cannot hold a copyright');
  });

  it('should route security reports to the product mailbox', () => {
    assert.ok(readFileSync('SECURITY.md', 'utf-8').includes(BRAND.contact));
  });

  it('should credit both the product and the company in the README', () => {
    const readme = readFileSync('README.md', 'utf-8');
    assert.ok(readme.includes(BRAND.name), 'the product should be named');
    assert.ok(readme.includes(OWNER.name), 'the company that builds it should be named');
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
