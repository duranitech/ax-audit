import { Command } from 'commander';
import { audit, batchAudit } from './orchestrator.js';
import { report, reportBatch } from './reporter/index.js';
import { VERSION } from './constants.js';
import { checks as allChecks } from './checks/index.js';
import { allSelectableIds } from './check-ids.js';
import { saveBaseline, loadBaseline, diffBaseline } from './baseline.js';
import type { AuditReport, BaselineDiff, OutputFormat } from './types.js';

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

      const checks = options.checks ? options.checks.split(',').map((s) => s.trim()) : undefined;

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

      const baseOptions = {
        checks,
        timeout: parseInt(options.timeout, 10),
        retries,
        verbose: options.verbose,
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
