import { CHECK_WEIGHTS, GRADES } from './constants.js';
import { clampScore } from './checks/utils.js';
import type { CheckResult, CheckMeta, Grade } from './types.js';

/**
 * Weighted average across the checks that ran and apply.
 *
 * A check that reports `applicable: false` is excluded from both the numerator
 * and the denominator. Scoring a commerce-protocol check as zero on a personal
 * blog would say the blog is badly built, when the honest answer is that the
 * question does not arise. That distinction is what makes a low score
 * actionable: everything counted against a site is something the site could
 * have done.
 */
export function calculateOverallScore(results: CheckResult[], metas: CheckMeta[]): number {
  const applicable = results.filter((r) => r.applicable !== false);
  const applicableIds = new Set(applicable.map((r) => r.id));

  const weightMap: Record<string, number> = {};
  let totalWeight = 0;

  for (const m of metas) {
    weightMap[m.id] = m.weight ?? CHECK_WEIGHTS[m.id] ?? 10;
    // A meta with no corresponding result (the check crashed before producing
    // one) still counts, so a broken check cannot inflate a score by shrinking
    // the denominator. Only an explicit not-applicable result is excluded.
    if (results.some((r) => r.id === m.id) && !applicableIds.has(m.id)) continue;
    totalWeight += weightMap[m.id];
  }

  // Every applicable check is informational (weight 0) — e.g. `--checks content-negotiation`.
  // Fall back to a plain average instead of dividing by zero.
  if (totalWeight === 0) {
    if (applicable.length === 0) return 0;
    const sum = applicable.reduce((acc, r) => acc + r.score, 0);
    return clampScore(Math.round(sum / applicable.length));
  }

  let weightedSum = 0;
  for (const r of applicable) {
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
