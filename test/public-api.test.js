import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../dist/index.js';
import { checks } from '../dist/checks/index.js';

/**
 * The package's public surface, held against itself.
 *
 * 4.1 exports the reference tables a consumer needs to *describe* an
 * audit rather than only run one. Before that, every consumer
 * transcribed them by hand and wrote its own test to catch the day they
 * went stale — a duplication this package caused by admitting only one
 * entry point. Now that they are exported, two things have to stay true:
 * they have to keep being reachable, and they have to keep covering
 * every check that ships.
 */
describe('public API', () => {
  const EXPECTED = [
    'audit',
    'batchAudit',
    'calculateOverallScore',
    'categoryScore',
    'getGrade',
    'checks',
    'saveBaseline',
    'loadBaseline',
    'diffBaseline',
    'toBaselineData',
    'renderMarkdown',
    'renderBatchMarkdown',
    'renderHtml',
    'renderBatchHtml',
    'VERSION',
    'CHECK_WEIGHTS',
    'CHECK_CATEGORIES',
    'AI_CRAWLERS',
    'ALL_AI_CRAWLERS',
    'CORE_AI_CRAWLERS',
    'LEGACY_AI_CRAWLERS',
    'CRAWLER_META',
    'crawlerInfo',
    'crawlerPurpose',
    'legacyCrawlerNote',
    'CONTENT_SIGNALS',
    'GRADES',
  ];

  it('should export everything it promises', () => {
    for (const name of EXPECTED) {
      assert.ok(name in api, `${name} is no longer exported — a consumer's build breaks`);
    }
  });

  /**
   * The other direction. Anything reachable is something somebody will
   * import and then be entitled to keep, so a new name arrives here
   * deliberately rather than by leaking out of a refactor.
   */
  it('should export nothing it did not mean to', () => {
    const extra = Object.keys(api).filter((name) => !EXPECTED.includes(name));
    assert.deepEqual(extra, [], 'add it to EXPECTED, or stop exporting it');
  });
});

describe('reference tables', () => {
  const ids = checks.map((c) => c.meta.id);

  it('should weigh every check that ships', () => {
    const unweighed = ids.filter((id) => api.CHECK_WEIGHTS[id] === undefined);
    assert.deepEqual(unweighed, [], 'a check absent from CHECK_WEIGHTS scores nothing, silently');
  });

  it('should weigh nothing that does not ship', () => {
    const orphans = Object.keys(api.CHECK_WEIGHTS).filter((id) => !ids.includes(id));
    assert.deepEqual(orphans, [], 'a weight for a retired check misleads anything that prints the table');
  });

  /**
   * `buildResult` falls back to this map when a check declares no
   * `meta.category`, which most do not. A missing entry means a result
   * with no category at all, and a report that groups by category
   * silently drops the check.
   */
  it('should categorise every check that ships', () => {
    const uncategorised = ids.filter((id) => api.CHECK_CATEGORIES[id] === undefined);
    assert.deepEqual(uncategorised, []);
  });

  it('should categorise nothing that does not ship', () => {
    const orphans = Object.keys(api.CHECK_CATEGORIES).filter((id) => !ids.includes(id));
    assert.deepEqual(orphans, []);
  });

  it('should give a check that declares its own category the same one', () => {
    // Two sources for one fact are allowed to disagree, and if they do,
    // which one a consumer reads depends on whether it went through a
    // result or through the table.
    for (const { meta } of checks) {
      if (meta.category === undefined) continue;
      assert.equal(
        meta.category,
        api.CHECK_CATEGORIES[meta.id],
        `${meta.id} declares ${meta.category} and the table says ${api.CHECK_CATEGORIES[meta.id]}`
      );
    }
  });

  it('should place every crawler token in exactly one purpose', () => {
    const seen = new Map();
    for (const [purpose, tokens] of Object.entries(api.AI_CRAWLERS)) {
      for (const token of tokens) {
        assert.ok(!seen.has(token), `${token} is both ${seen.get(token)} and ${purpose}`);
        seen.set(token, purpose);
      }
    }
    assert.equal(seen.size, api.ALL_AI_CRAWLERS.length);
  });

  it('should agree with CRAWLER_META about what each crawler is for', () => {
    for (const [token, info] of Object.entries(api.CRAWLER_META)) {
      assert.equal(
        api.crawlerPurpose(token),
        info.purpose,
        `${token} is listed under a different purpose than its metadata claims`
      );
    }
  });

  it('should never call a live crawler legacy', () => {
    const live = Object.keys(api.LEGACY_AI_CRAWLERS).filter((token) =>
      api.ALL_AI_CRAWLERS.includes(token)
    );
    assert.deepEqual(live, [], 'a token cannot be both recognised and retired');
  });
});
