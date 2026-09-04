import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checks } from '../dist/checks/index.js';
import { CHECK_WEIGHTS, CHECK_CATEGORIES } from '../dist/constants.js';

const checksDoc = readFileSync('docs/checks.md', 'utf-8');
const readme = readFileSync('README.md', 'utf-8');
const ids = checks.map((c) => c.meta.id);

/**
 * Documentation that contradicts the code is worse than no documentation: a
 * reader trusts it and acts on it. These tests fail the build when the two
 * drift, which is the only way a reference this size stays true.
 */
describe('docs: checks reference matches the registered checks', () => {
  const documented = [...checksDoc.matchAll(/^### `([a-z-]+)`/gm)].map((m) => m[1]);

  it('should document every registered check', () => {
    assert.deepEqual(
      ids.filter((id) => !documented.includes(id)),
      [],
    );
  });

  it('should not document a check that no longer exists', () => {
    assert.deepEqual(
      documented.filter((id) => !ids.includes(id)),
      [],
    );
  });

  it('should state the current check count', () => {
    assert.ok(
      checksDoc.includes(`ax-audit runs ${ids.length} checks`),
      `docs/checks.md should say "${ids.length} checks"`,
    );
    assert.ok(readme.includes(`${ids.length} checks across five areas`), `README should say "${ids.length} checks"`);
  });
});

describe('docs: the weight table matches the code', () => {
  const totals = {};
  for (const c of checks) {
    const category = c.meta.category ?? CHECK_CATEGORIES[c.meta.id];
    totals[category] = (totals[category] ?? 0) + CHECK_WEIGHTS[c.meta.id];
  }

  it('should publish each area total accurately in the README', () => {
    for (const [category, weight] of Object.entries(totals)) {
      if (weight === 0) continue;
      assert.ok(
        readme.includes(`| ${weight}% |`),
        `README is missing the ${category} total of ${weight}%`,
      );
    }
  });

  it('should publish each per-check weight accurately in the checks reference', () => {
    for (const c of checks) {
      const weight = CHECK_WEIGHTS[c.meta.id];
      if (weight === 0) continue;
      assert.ok(
        checksDoc.includes(`${c.meta.id} ${weight}`),
        `docs/checks.md is missing "${c.meta.id} ${weight}" in the weight table`,
      );
    }
  });

  it('should not claim weights that sum to anything but 100', () => {
    assert.equal(
      Object.values(totals).reduce((a, b) => a + b, 0),
      100,
    );
  });
});

describe('docs: no references to retired paths or checks', () => {
  const RETIRED = [
    ['well-known-ai', /###\s+`well-known-ai`/],
    ['the pre-0.3 agent.json path as current', /Agent Card at `\/\.well-known\/agent\.json`/],
    ['mcp.json as a specification', /manifest at `\/\.well-known\/mcp\.json`/],
  ];

  for (const file of ['README.md', 'docs/checks.md', 'docs/concepts.md', 'docs/getting-started.md', 'docs/faq.md']) {
    const content = readFileSync(file, 'utf-8');
    for (const [label, pattern] of RETIRED) {
      it(`should not present ${label} in ${file}`, () => {
        assert.equal(pattern.test(content), false);
      });
    }
  }
});
