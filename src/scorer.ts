import { CHECK_WEIGHTS, GRADES } from './constants.js';
import { clampScore } from './checks/utils.js';
import type { CheckResult, CheckMeta, Grade } from './types.js';

export function calculateOverallScore(results: CheckResult[], metas: CheckMeta[]): number {
  const weightMap: Record<string, number> = {};
  let totalWeight = 0;

  for (const m of metas) {
    weightMap[m.id] = m.weight ?? CHECK_WEIGHTS[m.id] ?? 10;
    totalWeight += weightMap[m.id];
  }

  // All selected checks are informational (weight 0) — e.g. `--checks content-negotiation`.
  // Fall back to a plain average instead of dividing by zero.
  if (totalWeight === 0) {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, r) => acc + r.score, 0);
    return clampScore(Math.round(sum / results.length));
  }

  let weightedSum = 0;
  for (const r of results) {
    const weight = weightMap[r.id] ?? 0;
    weightedSum += (r.score / 100) * weight;
  }

  return clampScore(Math.round((weightedSum / totalWeight) * 100));
}

export function getGrade(score: number): Grade {
  for (const grade of GRADES) {
    if (score >= grade.min) return grade;
  }
  return GRADES[GRADES.length - 1];
}
