import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { checks as allChecks } from './checks/index.js';
import { allIdsFor } from './check-ids.js';
import type { AuditReport, BaselineData, BaselineDiff, CheckDiff } from './types.js';

/**
 * Extract a minimal, stable snapshot from an AuditReport suitable for
 * persistence and future comparison.
 */
/** Scoring model this build produces. Bumped whenever weights or the scoring rules change. */
export const BASELINE_SCHEMA_VERSION = 2;

export function toBaselineData(report: AuditReport): BaselineData {
  const checks: Record<string, number> = {};
  const notApplicable: string[] = [];

  for (const r of report.results) {
    checks[r.id] = r.score;
    if (r.applicable === false) notApplicable.push(r.id);
  }

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    url: report.url,
    timestamp: report.timestamp,
    overallScore: report.overallScore,
    checks,
    ...(notApplicable.length > 0 ? { notApplicable } : {}),
  };
}

/**
 * Persist a baseline to disk as pretty-printed JSON.
 * Creates intermediate directories if they don't exist.
 */
export function saveBaseline(path: string, report: AuditReport): void {
  const data = toBaselineData(report);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Load a previously saved baseline from disk.
 * Throws with a clear message on missing file or invalid JSON.
 */
export function loadBaseline(path: string): BaselineData {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Baseline file not found: ${path}`, { cause: err });
    }
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause: unknown) {
    throw new Error(`Baseline file is not valid JSON: ${path}`, { cause });
  }

  if (!isBaselineData(data)) {
    throw new Error(`Baseline file has invalid structure (expected url, timestamp, overallScore, checks): ${path}`);
  }

  return data;
}

/**
 * Compare a current audit report against a stored baseline, producing
 * per-check deltas and overall regression/improvement lists.
 */
export function diffBaseline(baseline: BaselineData, report: AuditReport): BaselineDiff {
  // A baseline saved before a check was renamed still holds the former id, so
  // look each score up under every id that check answers to. Without this a
  // rename reads as one check removed (a full regression) and one added at
  // zero, which would fire `--fail-on-regression` on an unchanged site.
  const consumedIds = new Set<string>();

  const previousScoreFor = (id: string): number | undefined => {
    for (const candidate of idsForCheck(id)) {
      if (Object.hasOwn(baseline.checks, candidate)) {
        consumedIds.add(candidate);
        return baseline.checks[candidate];
      }
    }
    return undefined;
  };

  const wasNotApplicable = new Set(baseline.notApplicable ?? []);

  const checks: CheckDiff[] = report.results.map((r) => {
    const previous = previousScoreFor(r.id) ?? 0;
    const isNotApplicable = r.applicable === false;
    // A check that is N/A on one side has no comparable score, so its delta
    // reflects a change in what the site offers rather than in its quality.
    const applicabilityChanged = isNotApplicable !== wasNotApplicable.has(r.id);

    return {
      id: r.id,
      name: r.name,
      previous,
      current: r.score,
      delta: r.score - previous,
      ...(applicabilityChanged ? { applicabilityChanged: true } : {}),
    };
  });

  // Include checks that existed in the baseline but were removed from the current run
  for (const [id, score] of Object.entries(baseline.checks)) {
    if (!consumedIds.has(id) && !checks.some((c) => c.id === id)) {
      checks.push({
        id,
        name: id, // no human-readable name available for removed checks
        previous: score,
        current: 0,
        delta: -score,
      });
    }
  }

  const overallDelta = report.overallScore - baseline.overallScore;
  const scoringModelChanged = (baseline.schemaVersion ?? 1) !== BASELINE_SCHEMA_VERSION;

  return {
    ...(scoringModelChanged ? { scoringModelChanged: true } : {}),
    url: report.url,
    baselineTimestamp: baseline.timestamp,
    currentTimestamp: report.timestamp,
    overallPrevious: baseline.overallScore,
    overallCurrent: report.overallScore,
    overallDelta,
    checks,
    // A regression must be something the site did. A check that changed
    // applicability, or a baseline from a different scoring model, is neither.
    regressions: scoringModelChanged ? [] : checks.filter((c) => c.delta < 0 && !c.applicabilityChanged),
    improvements: checks.filter((c) => c.delta > 0 && !c.applicabilityChanged),
  };
}

/* ── Internal helpers ─────────────────────────────────────── */

/** Current id plus every former id a check answers to, for baseline lookup. */
function idsForCheck(id: string): string[] {
  const meta = allChecks.find((c) => c.meta.id === id)?.meta;
  return meta === undefined ? [id] : allIdsFor(meta);
}

function isBaselineData(value: unknown): value is BaselineData {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.url === 'string' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.overallScore === 'number' &&
    typeof obj.checks === 'object' &&
    obj.checks !== null &&
    !Array.isArray(obj.checks)
  );
}
