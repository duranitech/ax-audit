import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../dist/reporter/markdown.js';
import { renderHtml } from '../../dist/reporter/html.js';
import { calculateOverallScore } from '../../dist/scorer.js';
import { buildResult, notApplicable } from '../../dist/checks/utils.js';

const meta = (id, weight, category) => ({ id, name: id, description: `${id} check`, weight, category });

function report(results) {
  return {
    url: 'https://example.com',
    timestamp: '2026-09-04T00:00:00.000Z',
    overallScore: 80,
    grade: { min: 70, label: 'Good', color: 'yellow' },
    duration: 100,
    results,
  };
}

describe('scorer: not-applicable checks', () => {
  it('should exclude an N/A check from numerator and denominator', () => {
    const metas = [meta('a', 50), meta('b', 50)];
    const results = [
      { id: 'a', name: 'a', description: '', score: 100, findings: [], duration: 1 },
      { id: 'b', name: 'b', description: '', score: 0, findings: [], duration: 1, applicable: false },
    ];
    assert.equal(calculateOverallScore(results, metas), 100, 'a surface the site lacks must not read as a failure');
  });

  it('should score a failing applicable check normally', () => {
    const metas = [meta('a', 50), meta('b', 50)];
    const results = [
      { id: 'a', name: 'a', description: '', score: 100, findings: [], duration: 1 },
      { id: 'b', name: 'b', description: '', score: 0, findings: [], duration: 1 },
    ];
    assert.equal(calculateOverallScore(results, metas), 50);
  });

  it('should return 0 when every check is N/A', () => {
    const metas = [meta('a', 50)];
    const results = [{ id: 'a', name: 'a', description: '', score: 0, findings: [], duration: 1, applicable: false }];
    assert.equal(calculateOverallScore(results, metas), 0);
  });

  it('should still count a check whose meta produced no result', () => {
    const metas = [meta('a', 50), meta('missing', 50)];
    const results = [{ id: 'a', name: 'a', description: '', score: 100, findings: [], duration: 1 }];
    assert.equal(calculateOverallScore(results, metas), 50, 'a crashed check must not inflate the score');
  });

  it('should average weight-0 applicable checks and ignore N/A ones', () => {
    const metas = [meta('a', 0), meta('b', 0)];
    const results = [
      { id: 'a', name: 'a', description: '', score: 60, findings: [], duration: 1 },
      { id: 'b', name: 'b', description: '', score: 0, findings: [], duration: 1, applicable: false },
    ];
    assert.equal(calculateOverallScore(results, metas), 60);
  });
});

describe('buildResult / notApplicable', () => {
  it('should carry the category from meta onto the result', () => {
    const r = buildResult(meta('x', 5, 'access'), 90, [], performance.now());
    assert.equal(r.category, 'access');
    assert.equal(r.applicable, undefined, 'applicable is omitted when the check applies');
  });

  it('should mark an N/A result and keep its findings', () => {
    const findings = [{ status: 'pass', message: 'No API surface on this site' }];
    const r = notApplicable(meta('x', 5, 'protocols'), findings, performance.now());
    assert.equal(r.applicable, false);
    assert.deepEqual(r.findings, findings);
  });
});

describe('reporters: categories and N/A', () => {
  const results = [
    buildResult(meta('html-rendering', 9, 'content'), 90, [{ status: 'pass', message: 'Content present' }], 0),
    buildResult(meta('robots-txt', 11, 'discovery'), 70, [{ status: 'warn', message: 'Missing crawler' }], 0),
    notApplicable(meta('commerce-discovery', 0, 'protocols'), [{ status: 'pass', message: 'No commerce surface' }], 0),
  ];

  it('should group the Markdown summary table by area', () => {
    const md = renderMarkdown(report(results));
    assert.ok(md.includes('| Area | Check | Score |'));
    assert.ok(md.includes('**Content**'));
    assert.ok(md.includes('**Discovery**'));
    assert.ok(md.includes('**Protocols**'));
    assert.ok(md.indexOf('**Content**') < md.indexOf('**Discovery**'), 'content comes before discovery');
  });

  it('should render an N/A check as n/a rather than 0/100 in Markdown', () => {
    const md = renderMarkdown(report(results));
    assert.ok(md.includes('| commerce-discovery | n/a |'));
    assert.ok(!md.includes('| commerce-discovery | 0/100'));
    assert.ok(md.includes('excluded from the score rather than counted as failures'));
  });

  it('should not mention N/A when every check applies', () => {
    const md = renderMarkdown(report(results.slice(0, 2)));
    assert.ok(!md.includes('marked n/a'));
  });

  it('should group the HTML report by category and dim N/A checks', () => {
    const html = renderHtml(report(results));
    assert.ok(html.includes('<h2 class="category">Content</h2>'));
    assert.ok(html.includes('<h2 class="category">Protocols</h2>'));
    assert.ok(html.includes('check-na'));
    assert.ok(html.includes('>n/a '), 'the score badge should read n/a');
  });

  it('should omit an empty category heading', () => {
    const html = renderHtml(report([results[0]]));
    assert.ok(html.includes('<h2 class="category">Content</h2>'));
    assert.ok(!html.includes('<h2 class="category">Policy</h2>'));
  });
});
