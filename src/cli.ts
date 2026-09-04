import { Command } from 'commander';
import { audit, batchAudit } from './orchestrator.js';
import { report, reportBatch } from './reporter/index.js';
import { VERSION } from './constants.js';
import { checks as allChecks } from './checks/index.js';
import { allSelectableIds } from './check-ids.js';
import { saveBaseline, loadBaseline, diffBaseline } from './baseline.js';
import { calculateOverallScore } from './scorer.js';
import { CHECK_CATEGORIES } from './constants.js';
import type { AuditReport, BaselineDiff, CheckCategory, OutputFormat } from './types.js';

interface CliOptions {
  json?: boolean;
  output: string;
  checks?: string;
  timeout: string;
  retries: string;
  concurrency: string;
  verbose?: boolean;
  onlyFailures?: boolean;
  saveBaseline?: string;
  baseline?: string;
  failOnRegression?: string;
  profile?: string;
  category?: string;
  failOnCategory?: string;
}

/** Profiles that force conditional protocol checks applicable. */
const VALID_PROFILES = ['auto', 'api', 'mcp', 'agent', 'docs', 'commerce', 'all'] as const;

/** Report areas, usable with `--category` and `--fail-on-category`. */
const VALID_CATEGORIES: CheckCategory[] = ['content', 'discovery', 'access', 'policy', 'protocols'];

/**
 * Parse `--fail-on-category area:score` pairs into thresholds.
 *
 * An overall score hides a category that is entirely broken: a site can score
 * 80 while every access check fails, because the other four areas carry it.
 * Per-area gates let a team say "content may drift, but access must not".
 */
export function parseCategoryThresholds(raw: string): { thresholds: Map<CheckCategory, number>; error?: string } {
  const thresholds = new Map<CheckCategory, number>();

  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;
    const [name, value] = trimmed.split(':');
    const category = (name ?? '').trim().toLowerCase() as CheckCategory;

    if (!VALID_CATEGORIES.includes(category)) {
      return { thresholds, error: `Unknown category "${name}". Valid: ${VALID_CATEGORIES.join(', ')}` };
    }
    const score = Number((value ?? '').trim());
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return { thresholds, error: `Threshold for "${category}" must be an integer between 0 and 100` };
    }
    thresholds.set(category, score);
  }

  if (thresholds.size === 0) {
    return { thresholds, error: 'Expected at least one area:score pair, for example access:70' };
  }
  return { thresholds };
}

/** Score of one report area, over the checks in it that apply. */
export function categoryScore(report: AuditReport, category: CheckCategory): number | null {
  const metas = new Map(allChecks.map((c) => [c.meta.id, c.meta]));
  const inCategory = report.results.filter((r) => {
    if (r.applicable === false) return false;
    const meta = metas.get(r.id);
    return (meta?.category ?? CHECK_CATEGORIES[r.id]) === category;
  });
  if (inCategory.length === 0) return null;

  const metasFor = inCategory.map((r) => metas.get(r.id)).filter((m): m is NonNullable<typeof m> => m !== undefined);
  return calculateOverallScore(inCategory, metasFor);
}

export function cli(argv: string[]): void {
  const program = new Command();

  program
    .name('ax-audit')
    .description('Audit websites for AI Agent Experience (AX) readiness. Lighthouse for AI Agents.')
    .version(VERSION, '-v, --version')
    .argument('<urls...>', 'One or more URLs to audit (e.g., https://example.com)')
    .option('--json', 'Output results as JSON')
    .option('--output <format>', 'Output format: terminal, json, html, markdown', 'terminal')
    .option('--checks <list>', 'Comma-separated list of checks to run')
    .option('--timeout <ms>', 'Per-request timeout in milliseconds', '10000')
    .option('--retries <n>', 'Retry attempts for transient fetch failures (timeouts, 5xx)', '2')
    .option('--concurrency <n>', 'Max URLs to audit in parallel (batch mode)', '1')
    .option('--verbose', 'Show detailed request and check execution logs')
    .option('--only-failures', 'Only show checks/findings with failures or warnings')
    .option('--save-baseline <path>', 'Save audit result as a baseline JSON file for future comparison')
    .option('--baseline <path>', 'Compare against a previously saved baseline and show score deltas')
    .option(
      '--fail-on-regression <points>',
      'Exit with code 1 if any check regresses by more than N points (requires --baseline)',
    )
    .option(
      '--profile <name>',
      `Audit as though the site had a surface it does not yet expose: ${VALID_PROFILES.join(', ')}`,
      'auto',
    )
    .option('--category <list>', `Only run checks in these areas: ${VALID_CATEGORIES.join(', ')}`)
    .option(
      '--fail-on-category <pairs>',
      'Exit with code 1 when an area scores below its threshold, e.g. access:70,content:80',
    )
    .action(async (urls: string[], options: CliOptions) => {
      for (const url of urls) {
        try {
          new URL(url);
        } catch {
          console.error(`Error: Invalid URL "${url}". Provide a full URL like https://example.com`);
          process.exit(1);
        }
      }

      if (options.failOnRegression && !options.baseline) {
        console.error('Error: --fail-on-regression requires --baseline');
        process.exit(1);
      }

      const format = (options.json ? 'json' : options.output) as OutputFormat;
      const validFormats: OutputFormat[] = ['terminal', 'json', 'html', 'markdown'];
      if (!validFormats.includes(format)) {
        console.error(`Error: Unknown output format "${format}". Valid: ${validFormats.join(', ')}`);
        process.exit(1);
      }

      const profile = (options.profile ?? 'auto') as (typeof VALID_PROFILES)[number];
      if (!VALID_PROFILES.includes(profile)) {
        console.error(`Error: Unknown profile "${options.profile}". Valid: ${VALID_PROFILES.join(', ')}`);
        process.exit(1);
      }

      let checks = options.checks ? options.checks.split(',').map((s) => s.trim()) : undefined;

      if (options.category) {
        const wanted = options.category.split(',').map((c) => c.trim().toLowerCase()) as CheckCategory[];
        const unknown = wanted.filter((c) => !VALID_CATEGORIES.includes(c));
        if (unknown.length > 0) {
          console.error(`Error: Unknown categor(y|ies): ${unknown.join(', ')}. Valid: ${VALID_CATEGORIES.join(', ')}`);
          process.exit(1);
        }
        const inCategory = allChecks
          .filter((c) => wanted.includes(c.meta.category ?? CHECK_CATEGORIES[c.meta.id]))
          .map((c) => c.meta.id);
        // `--category` narrows an explicit `--checks` selection rather than replacing it.
        checks = checks === undefined ? inCategory : checks.filter((id) => inCategory.includes(id));
        if (checks.length === 0) {
          console.error('Error: No checks match the requested category and check selection');
          process.exit(1);
        }
      }

      if (checks) {
        // Former ids stay valid so CI invocations survive a rename.
        const selectable = allSelectableIds().map((id) => id.toLowerCase());
        const invalid = checks.filter((id) => !selectable.includes(id.toLowerCase()));
        if (invalid.length > 0) {
          console.error(`Error: Unknown check(s): ${invalid.join(', ')}`);
          console.error(`Available checks: ${allChecks.map((c) => c.meta.id).join(', ')}`);
          process.exit(1);
        }
      }

      const retries = parseInt(options.retries, 10);
      if (isNaN(retries) || retries < 0) {
        console.error('Error: --retries must be a non-negative integer');
        process.exit(1);
      }

      const concurrency = parseInt(options.concurrency, 10);
      if (isNaN(concurrency) || concurrency < 1) {
        console.error('Error: --concurrency must be a positive integer');
        process.exit(1);
      }

      let categoryThresholds: Map<CheckCategory, number> | undefined;
      if (options.failOnCategory) {
        const parsed = parseCategoryThresholds(options.failOnCategory);
        if (parsed.error) {
          console.error(`Error: --fail-on-category: ${parsed.error}`);
          process.exit(1);
        }
        categoryThresholds = parsed.thresholds;
      }

      const baseOptions = {
        checks,
        timeout: parseInt(options.timeout, 10),
        retries,
        verbose: options.verbose,
        profile,
      };

      // Load baseline if requested (fail fast before running the audit)
      let baseline: ReturnType<typeof loadBaseline> | undefined;
      if (options.baseline) {
        try {
          baseline = loadBaseline(options.baseline);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${message}`);
          process.exit(2);
        }
      }

      const regressionThreshold = options.failOnRegression ? parseInt(options.failOnRegression, 10) : undefined;

      if (regressionThreshold !== undefined && (isNaN(regressionThreshold) || regressionThreshold < 0)) {
        console.error('Error: --fail-on-regression must be a non-negative integer');
        process.exit(1);
      }

      try {
        if (urls.length === 1) {
          const result = await audit({ ...baseOptions, url: urls[0] });

          // Build diff if baseline was provided
          let diff: BaselineDiff | undefined;
          if (baseline) {
            diff = diffBaseline(baseline, result);
          }

          // Save baseline if requested
          if (options.saveBaseline) {
            saveBaseline(options.saveBaseline, result);
          }

          const output = applyOnlyFailures(result, options.onlyFailures);
          report(output, format, diff);

          // Determine exit code
          if (diff && regressionThreshold !== undefined) {
            const worstRegression = diff.regressions.reduce((max, c) => Math.max(max, Math.abs(c.delta)), 0);
            if (worstRegression > regressionThreshold) {
              process.exit(1);
            }
          }

          if (categoryThresholds && failsCategoryGate(result, categoryThresholds)) {
            process.exit(1);
          }

          process.exit(result.overallScore >= 70 ? 0 : 1);
        } else {
          // Batch mode — baseline comparison is not supported for batch (would need per-URL baselines)
          if (baseline) {
            console.error(
              'Error: --baseline is not supported with multiple URLs. Run single-URL audits for baseline comparison.',
            );
            process.exit(1);
          }

          const batch = await batchAudit(urls, { ...baseOptions, concurrency });
          if (options.onlyFailures) {
            batch.reports = batch.reports.map((r) => applyOnlyFailures(r, true));
          }
          reportBatch(batch, format);
          if (categoryThresholds && batch.reports.some((r) => failsCategoryGate(r, categoryThresholds))) {
            process.exit(1);
          }
          process.exit(batch.summary.failed === 0 ? 0 : 1);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Fatal: ${message}`);
        process.exit(2);
      }
    });

  program.parse(argv);
}

/**
 * Report each area against its threshold and say whether the gate failed.
 *
 * Printed to stderr rather than the report, so it survives `--output json`
 * being piped somewhere and reads correctly in CI logs.
 */
function failsCategoryGate(result: AuditReport, thresholds: Map<CheckCategory, number>): boolean {
  let failed = false;

  for (const [category, threshold] of thresholds) {
    const score = categoryScore(result, category);
    if (score === null) {
      console.error(`  ${category}: n/a (no applicable checks) — threshold ${threshold} not evaluated`);
      continue;
    }
    if (score < threshold) {
      console.error(`  ${category}: ${score} is below the threshold of ${threshold}`);
      failed = true;
    } else {
      console.error(`  ${category}: ${score} meets the threshold of ${threshold}`);
    }
  }

  return failed;
}

function applyOnlyFailures(result: AuditReport, onlyFailures?: boolean): AuditReport {
  if (!onlyFailures) return result;
  return {
    ...result,
    results: result.results
      .map((c) => ({
        ...c,
        findings: c.findings.filter((f) => f.status !== 'pass'),
      }))
      .filter((c) => c.findings.length > 0),
  };
}
