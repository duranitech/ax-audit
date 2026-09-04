import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toBaselineData, saveBaseline, loadBaseline, diffBaseline } from '../dist/baseline.js';

/** Minimal AuditReport-like object for testing. */
function makeReport(overrides = {}) {
  return {
    url: 'https://example.com',
    timestamp: '2026-04-16T12:00:00.000Z',
    overallScore: 75,
    grade: { min: 70, label: 'Good', color: 'yellow' },
    results: [
      { id: 'llms-txt', name: 'LLMs.txt', description: '', score: 80, findings: [], duration: 10 },
      { id: 'robots-txt', name: 'Robots.txt', description: '', score: 70, findings: [], duration: 10 },
      { id: 'agent-json', name: 'Agent Card', description: '', score: 60, findings: [], duration: 10 },
    ],
    duration: 100,
    ...overrides,
  };
}

describe('baseline', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = join(tmpdir(), `ax-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('toBaselineData', () => {
    it('should extract url, timestamp, overallScore, and per-check scores', () => {
      const report = makeReport();
      const data = toBaselineData(report);

      assert.equal(data.url, 'https://example.com');
      assert.equal(data.timestamp, '2026-04-16T12:00:00.000Z');
      assert.equal(data.overallScore, 75);
      assert.deepEqual(data.checks, {
        'llms-txt': 80,
        'robots-txt': 70,
        'agent-json': 60,
      });
    });

    it('should not include findings, grade, or duration in the baseline', () => {
      const data = toBaselineData(makeReport());
      assert.equal('grade' in data, false);
      assert.equal('duration' in data, false);
      assert.equal('results' in data, false);
    });
  });

  describe('saveBaseline / loadBaseline', () => {
    it('should round-trip save and load correctly', () => {
      const path = join(tempDir, 'baseline.json');
      const report = makeReport();

      saveBaseline(path, report);
      const loaded = loadBaseline(path);

      assert.equal(loaded.url, 'https://example.com');
      assert.equal(loaded.overallScore, 75);
      assert.deepEqual(loaded.checks, { 'llms-txt': 80, 'robots-txt': 70, 'agent-json': 60 });
    });

    it('should create intermediate directories', () => {
      const path = join(tempDir, 'nested', 'deep', 'baseline.json');

      saveBaseline(path, makeReport());
      const loaded = loadBaseline(path);

      assert.equal(loaded.overallScore, 75);
    });

    it('should throw on missing file', () => {
      assert.throws(
        () => loadBaseline(join(tempDir, 'nonexistent.json')),
        { message: /Baseline file not found/ },
      );
    });

    it('should throw on invalid JSON', () => {
      const path = join(tempDir, 'bad.json');
      writeFileSync(path, '{not valid json!!!', 'utf-8');

      assert.throws(
        () => loadBaseline(path),
        { message: /not valid JSON/ },
      );
    });

    it('should throw on valid JSON with wrong structure', () => {
      const path = join(tempDir, 'wrong.json');
      writeFileSync(path, JSON.stringify({ foo: 'bar' }), 'utf-8');

      assert.throws(
        () => loadBaseline(path),
        { message: /invalid structure/ },
      );
    });

    it('should reject arrays as baseline data', () => {
      const path = join(tempDir, 'array.json');
      writeFileSync(path, JSON.stringify([1, 2, 3]), 'utf-8');

      assert.throws(
        () => loadBaseline(path),
        { message: /invalid structure/ },
      );
    });
  });

  describe('diffBaseline', () => {
    it('should compute correct deltas for unchanged scores', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 75,
        checks: { 'llms-txt': 80, 'robots-txt': 70, 'agent-json': 60 },
      };
      const report = makeReport();

      const diff = diffBaseline(baseline, report);

      assert.equal(diff.overallDelta, 0);
      assert.equal(diff.regressions.length, 0);
      assert.equal(diff.improvements.length, 0);
      for (const c of diff.checks) {
        assert.equal(c.delta, 0);
      }
    });

    it('should detect improvements', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 50,
        checks: { 'llms-txt': 60, 'robots-txt': 40, 'agent-json': 30 },
      };
      const report = makeReport(); // llms-txt: 80, robots-txt: 70, agent-json: 60

      const diff = diffBaseline(baseline, report);

      assert.equal(diff.overallDelta, 25);
      assert.equal(diff.improvements.length, 3);
      assert.equal(diff.regressions.length, 0);

      const llmsDiff = diff.checks.find((c) => c.id === 'llms-txt');
      assert.equal(llmsDiff.delta, 20);
      assert.equal(llmsDiff.previous, 60);
      assert.equal(llmsDiff.current, 80);
    });

    it('should detect regressions', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 90,
        checks: { 'llms-txt': 100, 'robots-txt': 90, 'agent-json': 80 },
      };
      const report = makeReport(); // llms-txt: 80, robots-txt: 70, agent-json: 60

      const diff = diffBaseline(baseline, report);

      assert.equal(diff.overallDelta, -15);
      assert.equal(diff.regressions.length, 3);
      assert.equal(diff.improvements.length, 0);

      const agentDiff = diff.checks.find((c) => c.id === 'agent-json');
      assert.equal(agentDiff.delta, -20);
    });

    it('should handle mixed improvements and regressions', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 70,
        checks: { 'llms-txt': 50, 'robots-txt': 90, 'agent-json': 60 },
      };
      const report = makeReport(); // llms-txt: 80, robots-txt: 70, agent-json: 60

      const diff = diffBaseline(baseline, report);

      assert.equal(diff.improvements.length, 1); // llms-txt improved
      assert.equal(diff.regressions.length, 1);  // robots-txt regressed
      assert.equal(diff.improvements[0].id, 'llms-txt');
      assert.equal(diff.regressions[0].id, 'robots-txt');
    });

    it('should handle checks present in baseline but not in current run', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 80,
        checks: { 'llms-txt': 80, 'robots-txt': 70, 'agent-json': 60, 'openapi': 90 },
      };
      const report = makeReport(); // no openapi check in results

      const diff = diffBaseline(baseline, report);

      const openapi = diff.checks.find((c) => c.id === 'openapi');
      assert.ok(openapi, 'removed check should appear in diff');
      assert.equal(openapi.previous, 90);
      assert.equal(openapi.current, 0);
      assert.equal(openapi.delta, -90);
    });

    it('should handle checks present in current run but not in baseline', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 70,
        checks: { 'llms-txt': 80 }, // only one check
      };
      const report = makeReport(); // has llms-txt, robots-txt, agent-json

      const diff = diffBaseline(baseline, report);

      const robotsDiff = diff.checks.find((c) => c.id === 'robots-txt');
      assert.ok(robotsDiff);
      assert.equal(robotsDiff.previous, 0); // not in baseline → treated as 0
      assert.equal(robotsDiff.current, 70);
      assert.equal(robotsDiff.delta, 70);
    });

    it('should populate timestamps correctly', () => {
      const baseline = {
        schemaVersion: 2,
        url: 'https://example.com',
        timestamp: '2026-04-15T12:00:00.000Z',
        overallScore: 75,
        checks: {},
      };
      const report = makeReport({ timestamp: '2026-04-16T12:00:00.000Z' });

      const diff = diffBaseline(baseline, report);

      assert.equal(diff.baselineTimestamp, '2026-04-15T12:00:00.000Z');
      assert.equal(diff.currentTimestamp, '2026-04-16T12:00:00.000Z');
      assert.equal(diff.url, 'https://example.com');
    });
  });
});

describe('baseline: scoring-model versioning', () => {
  const report = (results, overallScore = 80) => ({
    url: 'https://example.com',
    timestamp: '2026-09-04T00:00:00.000Z',
    overallScore,
    grade: { min: 70, label: 'Good', color: 'yellow' },
    duration: 10,
    results,
  });

  const check = (id, score, applicable) => ({
    id,
    name: id,
    description: '',
    score,
    findings: [],
    duration: 1,
    ...(applicable === false ? { applicable: false } : {}),
  });

  it('should stamp new baselines with the current schema version', () => {
    const data = toBaselineData(report([check('llms-txt', 90)]));
    assert.equal(data.schemaVersion, 2);
  });

  it('should record which checks were N/A', () => {
    const data = toBaselineData(report([check('llms-txt', 90), check('api-discovery', 0, false)]));
    assert.deepEqual(data.notApplicable, ['api-discovery']);
  });

  it('should omit the N/A list when everything applied', () => {
    const data = toBaselineData(report([check('llms-txt', 90)]));
    assert.equal(data.notApplicable, undefined);
  });

  it('should flag a comparison against a pre-4.0 baseline', () => {
    const old = { url: 'https://example.com', timestamp: 't', overallScore: 90, checks: { 'llms-txt': 90 } };
    const diff = diffBaseline(old, report([check('llms-txt', 50)]));
    assert.equal(diff.scoringModelChanged, true);
  });

  it('should suspend regression gating across a scoring-model change', () => {
    const old = { url: 'https://example.com', timestamp: 't', overallScore: 90, checks: { 'llms-txt': 90 } };
    const diff = diffBaseline(old, report([check('llms-txt', 50)]));
    assert.deepEqual(diff.regressions, [], 'a rescore is not something the site did');
    assert.equal(diff.checks[0].delta, -40, 'the delta is still shown');
  });

  it('should gate normally when the models match', () => {
    const current = {
      schemaVersion: 2,
      url: 'https://example.com',
      timestamp: 't',
      overallScore: 90,
      checks: { 'llms-txt': 90 },
    };
    const diff = diffBaseline(current, report([check('llms-txt', 50)]));
    assert.equal(diff.scoringModelChanged, undefined);
    assert.equal(diff.regressions.length, 1);
  });

  it('should not read a change of applicability as a regression', () => {
    const before = {
      schemaVersion: 2,
      url: 'https://example.com',
      timestamp: 't',
      overallScore: 90,
      checks: { 'api-discovery': 80 },
    };
    // The site removed its API, so the check now reports N/A at score 0.
    const diff = diffBaseline(before, report([check('api-discovery', 0, false)]));
    assert.equal(diff.checks[0].applicabilityChanged, true);
    assert.deepEqual(diff.regressions, [], 'losing a surface is a change of shape, not of quality');
  });

  it('should not read newly-applicable checks as improvements either', () => {
    const before = {
      schemaVersion: 2,
      url: 'https://example.com',
      timestamp: 't',
      overallScore: 90,
      checks: { 'api-discovery': 0 },
      notApplicable: ['api-discovery'],
    };
    const diff = diffBaseline(before, report([check('api-discovery', 70)]));
    assert.equal(diff.checks[0].applicabilityChanged, true);
    assert.deepEqual(diff.improvements, []);
  });

  it('should still compare a check that stayed applicable', () => {
    const before = {
      schemaVersion: 2,
      url: 'https://example.com',
      timestamp: 't',
      overallScore: 90,
      checks: { 'llms-txt': 90, 'api-discovery': 0 },
      notApplicable: ['api-discovery'],
    };
    const diff = diffBaseline(before, report([check('llms-txt', 70), check('api-discovery', 0, false)]));
    const llms = diff.checks.find((c) => c.id === 'llms-txt');
    assert.equal(llms.applicabilityChanged, undefined);
    assert.equal(diff.regressions.length, 1);
    assert.equal(diff.regressions[0].id, 'llms-txt');
  });
});
