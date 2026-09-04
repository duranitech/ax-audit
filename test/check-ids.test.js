import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCheckId, allIdsFor, allSelectableIds, isSelected, buildAliasMap } from '../dist/check-ids.js';
import { checks } from '../dist/checks/index.js';
import { diffBaseline } from '../dist/baseline.js';

const metas = checks.map((c) => c.meta);

describe('check ids: alias resolution', () => {
  it('should resolve a former id to the current one', () => {
    assert.equal(resolveCheckId('agent-json'), 'agent-card');
  });

  it('should return a current id unchanged', () => {
    assert.equal(resolveCheckId('agent-card'), 'agent-card');
    assert.equal(resolveCheckId('llms-txt'), 'llms-txt');
  });

  it('should resolve case-insensitively', () => {
    assert.equal(resolveCheckId('Agent-JSON'), 'agent-card');
  });

  it('should return an unknown id unchanged so callers can report what was typed', () => {
    assert.equal(resolveCheckId('not-a-check'), 'not-a-check');
  });

  it('should list current id first among a check\'s ids', () => {
    const meta = metas.find((m) => m.id === 'agent-card');
    assert.deepEqual(allIdsFor(meta), ['agent-card', 'agent-json']);
  });

  it('should include aliases among selectable ids', () => {
    const ids = allSelectableIds();
    assert.ok(ids.includes('agent-card'));
    assert.ok(ids.includes('agent-json'));
  });

  it('should never map an alias to more than one check', () => {
    const map = buildAliasMap(metas);
    const currentIds = new Set(metas.map((m) => m.id));
    for (const [alias, target] of map) {
      assert.ok(currentIds.has(target), `alias ${alias} points at unknown check ${target}`);
      assert.ok(!currentIds.has(alias), `${alias} is both a current id and an alias`);
    }
  });

  it('should select a check by its current id or any alias', () => {
    const meta = metas.find((m) => m.id === 'agent-card');
    assert.equal(isSelected(meta, ['agent-card']), true);
    assert.equal(isSelected(meta, ['agent-json']), true);
    assert.equal(isSelected(meta, ['AGENT-JSON']), true);
    assert.equal(isSelected(meta, ['mcp']), false);
  });
});

describe('check ids: baseline compatibility across renames', () => {
  const report = (id, score) => ({
    url: 'https://example.com',
    timestamp: '2026-09-04T00:00:00.000Z',
    overallScore: score,
    grade: { min: 90, label: 'Excellent', color: 'green' },
    duration: 10,
    results: [{ id, name: 'Agent Card (A2A)', description: '', score, findings: [], duration: 1 }],
  });

  it('should match a baseline saved under the former id', () => {
    const baseline = {
      url: 'https://example.com',
      timestamp: '2026-06-01T00:00:00.000Z',
      overallScore: 95,
      checks: { 'agent-json': 95 },
    };
    const diff = diffBaseline(baseline, report('agent-card', 95));
    assert.equal(diff.checks.length, 1, 'a rename must not read as one check removed and one added');
    assert.equal(diff.checks[0].previous, 95);
    assert.equal(diff.checks[0].delta, 0);
    assert.equal(diff.regressions.length, 0, 'a rename must not fire --fail-on-regression');
  });

  it('should still detect a real regression under the former id', () => {
    const baseline = {
      url: 'https://example.com',
      timestamp: '2026-06-01T00:00:00.000Z',
      overallScore: 95,
      checks: { 'agent-json': 95 },
    };
    const diff = diffBaseline(baseline, report('agent-card', 70));
    assert.equal(diff.regressions.length, 1);
    assert.equal(diff.regressions[0].delta, -25);
  });

  it('should prefer the current id when a baseline holds both', () => {
    const baseline = {
      url: 'https://example.com',
      timestamp: '2026-06-01T00:00:00.000Z',
      overallScore: 95,
      checks: { 'agent-card': 80, 'agent-json': 95 },
    };
    const diff = diffBaseline(baseline, report('agent-card', 80));
    const entry = diff.checks.find((c) => c.id === 'agent-card');
    assert.equal(entry.previous, 80);
  });

  it('should still report a genuinely removed check', () => {
    const baseline = {
      url: 'https://example.com',
      timestamp: '2026-06-01T00:00:00.000Z',
      overallScore: 95,
      checks: { 'agent-card': 95, 'retired-check': 60 },
    };
    const diff = diffBaseline(baseline, report('agent-card', 95));
    const removed = diff.checks.find((c) => c.id === 'retired-check');
    assert.ok(removed);
    assert.equal(removed.delta, -60);
  });
});
