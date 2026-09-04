import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOverallScore, categoryScore, getGrade } from '../dist/scorer.js';

describe('scorer', () => {
  describe('calculateOverallScore', () => {
    it('should return 100 when all checks score 100', () => {
      const results = [
        { id: 'a', name: 'A', description: '', score: 100, findings: [], duration: 0 },
        { id: 'b', name: 'B', description: '', score: 100, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'a', name: 'A', description: '', weight: 50 },
        { id: 'b', name: 'B', description: '', weight: 50 },
      ];
      assert.equal(calculateOverallScore(results, metas), 100);
    });

    it('should return 0 when all checks score 0', () => {
      const results = [
        { id: 'a', name: 'A', description: '', score: 0, findings: [], duration: 0 },
        { id: 'b', name: 'B', description: '', score: 0, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'a', name: 'A', description: '', weight: 50 },
        { id: 'b', name: 'B', description: '', weight: 50 },
      ];
      assert.equal(calculateOverallScore(results, metas), 0);
    });

    it('should calculate weighted average correctly', () => {
      const results = [
        { id: 'a', name: 'A', description: '', score: 100, findings: [], duration: 0 },
        { id: 'b', name: 'B', description: '', score: 0, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'a', name: 'A', description: '', weight: 75 },
        { id: 'b', name: 'B', description: '', weight: 25 },
      ];
      assert.equal(calculateOverallScore(results, metas), 75);
    });

    it('should handle equal weights', () => {
      const results = [
        { id: 'a', name: 'A', description: '', score: 80, findings: [], duration: 0 },
        { id: 'b', name: 'B', description: '', score: 60, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'a', name: 'A', description: '', weight: 10 },
        { id: 'b', name: 'B', description: '', weight: 10 },
      ];
      assert.equal(calculateOverallScore(results, metas), 70);
    });

    it('should ignore weight-0 (informational) checks in the weighted average', () => {
      const results = [
        { id: 'a', name: 'A', description: '', score: 80, findings: [], duration: 0 },
        { id: 'info', name: 'Info', description: '', score: 0, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'a', name: 'A', description: '', weight: 50 },
        { id: 'info', name: 'Info', description: '', weight: 0 },
      ];
      assert.equal(calculateOverallScore(results, metas), 80);
    });

    it('should fall back to a plain average when all selected checks have weight 0', () => {
      const results = [
        { id: 'info1', name: 'Info1', description: '', score: 100, findings: [], duration: 0 },
        { id: 'info2', name: 'Info2', description: '', score: 50, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'info1', name: 'Info1', description: '', weight: 0 },
        { id: 'info2', name: 'Info2', description: '', weight: 0 },
      ];
      assert.equal(calculateOverallScore(results, metas), 75);
    });

    it('should return 0 for empty inputs without dividing by zero', () => {
      assert.equal(calculateOverallScore([], []), 0);
    });

    it('should clamp result between 0 and 100', () => {
      const results = [
        { id: 'a', name: 'A', description: '', score: 150, findings: [], duration: 0 },
      ];
      const metas = [
        { id: 'a', name: 'A', description: '', weight: 10 },
      ];
      const score = calculateOverallScore(results, metas);
      assert.ok(score <= 100);
    });
  });

  describe('getGrade', () => {
    it('should return Excellent for score >= 90', () => {
      assert.equal(getGrade(90).label, 'Excellent');
      assert.equal(getGrade(100).label, 'Excellent');
      assert.equal(getGrade(95).label, 'Excellent');
    });

    it('should return Good for score 70-89', () => {
      assert.equal(getGrade(70).label, 'Good');
      assert.equal(getGrade(89).label, 'Good');
    });

    it('should return Fair for score 50-69', () => {
      assert.equal(getGrade(50).label, 'Fair');
      assert.equal(getGrade(69).label, 'Fair');
    });

    it('should return Poor for score < 50', () => {
      assert.equal(getGrade(0).label, 'Poor');
      assert.equal(getGrade(49).label, 'Poor');
    });
  });
});

/**
 * Moved here from the CLI tests when `categoryScore` moved out of
 * `cli.ts`. It was never a CLI concern: `--fail-on-category` is one
 * caller, and a report grouped by area is another.
 */
describe('scorer: per-area scoring', () => {
  const result = (id, score, extra = {}) => ({
    id,
    name: id,
    description: '',
    score,
    findings: [],
    duration: 1,
    ...extra,
  });

  it('should score one area over the checks in it', () => {
    const results = [
      result('tls-https', 100),
      result('agent-access', 0),
      result('llms-txt', 100),
    ];
    const access = categoryScore(results, 'access');
    assert.ok(access !== null && access < 100, 'a failing access check must pull the area down');
    assert.equal(categoryScore(results, 'discovery'), 100, 'a different area is unaffected');
  });

  it('should exclude N/A checks from an area score', () => {
    const results = [
      result('api-discovery', 0, { applicable: false }),
      result('agent-card', 100),
    ];
    assert.equal(categoryScore(results, 'protocols'), 100);
  });

  it('should return null for an area with nothing applicable', () => {
    const results = [result('api-discovery', 0, { applicable: false })];
    assert.equal(categoryScore(results, 'protocols'), null);
    assert.equal(categoryScore(results, 'content'), null);
  });

  it('should honour a check that declares its own category', () => {
    // The fallback table is consulted only when the meta does not say.
    assert.equal(categoryScore([result('html-rendering', 60)], 'content'), 60);
    assert.equal(categoryScore([result('html-rendering', 60)], 'access'), null);
  });
});
