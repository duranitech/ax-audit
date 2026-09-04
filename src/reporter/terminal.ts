import chalk from 'chalk';
import { getGrade } from '../scorer.js';
import { CHECK_CATEGORIES } from '../constants.js';
import type {
  AuditReport,
  BaselineDiff,
  BatchAuditReport,
  CheckCategory,
  CheckDiff,
  CheckResult,
  FindingStatus,
  Grade,
} from '../types.js';

/** Display order and headings for grouped output. */
const CATEGORY_ORDER: CheckCategory[] = ['content', 'discovery', 'access', 'policy', 'protocols'];

const CATEGORY_HEADING: Record<CheckCategory, string> = {
  content: 'Content — is there substance an agent can read?',
  discovery: 'Discovery — can an agent find your machine-readable files?',
  access: 'Access — can an agent actually retrieve them?',
  policy: 'Policy — what usage rights do you declare?',
  protocols: 'Protocols — what can an agent call?',
};

function categoryOf(check: CheckResult): CheckCategory {
  return check.category ?? CHECK_CATEGORIES[check.id] ?? 'discovery';
}

const STATUS_ICONS: Record<FindingStatus, string> = {
  pass: chalk.green('  PASS '),
  warn: chalk.yellow('  WARN '),
  fail: chalk.red('  FAIL '),
};

function gradeColor(grade: Grade) {
  switch (grade.color) {
    case 'green':
      return chalk.green;
    case 'yellow':
      return chalk.yellow;
    case 'orange':
      return chalk.hex('#FFA500');
    default:
      return chalk.red;
  }
}

function formatDelta(delta: number): string {
  if (delta === 0) return chalk.dim('  ─');
  if (delta > 0) return chalk.green(`  \u25B2${delta}`);
  return chalk.red(`  \u25BC${Math.abs(delta)}`);
}

export function reportTerminal(report: AuditReport, diff?: BaselineDiff): void {
  const grade = getGrade(report.overallScore);
  const colorFn = gradeColor(grade);

  console.log();
  console.log(chalk.bold('  AX Audit Report'));
  console.log(chalk.dim(`  ${report.url}`));
  console.log(chalk.dim(`  ${report.timestamp}  (${report.duration}ms)`));
  if (diff) {
    console.log(chalk.dim(`  Baseline: ${diff.baselineTimestamp}`));
    if (diff.scoringModelChanged) {
      console.log(
        chalk.yellow('  Baseline predates this scoring model — deltas measure the model change as much as the site.'),
      );
      console.log(chalk.dim('  Regression gating is suspended. Re-save with --save-baseline to resume it.'));
    }
  }
  console.log();

  const barWidth = 40;
  const filled = Math.round((report.overallScore / 100) * barWidth);
  const empty = barWidth - filled;
  const scoreLine = `  ${colorFn('\u2588'.repeat(filled))}${chalk.gray('\u2591'.repeat(empty))}  ${colorFn.bold(report.overallScore + '/100')}  ${colorFn(grade.label)}`;
  console.log(diff ? scoreLine + formatDelta(diff.overallDelta) : scoreLine);
  console.log();

  // Build a lookup for per-check diffs
  const checkDiffs = new Map<string, CheckDiff>();
  if (diff) {
    for (const cd of diff.checks) {
      checkDiffs.set(cd.id, cd);
    }
  }

  // Group by category so a reader sees which *area* is weak, not a flat list of
  // twenty scores. Categories with no checks in this run are skipped.
  const byCategory = new Map<CheckCategory, CheckResult[]>();
  for (const check of report.results) {
    const category = categoryOf(check);
    byCategory.set(category, [...(byCategory.get(category) ?? []), check]);
  }

  const ordered = CATEGORY_ORDER.filter((c) => byCategory.has(c)).flatMap((category) => [
    { heading: CATEGORY_HEADING[category] },
    ...byCategory.get(category)!.map((check) => ({ check })),
  ]);

  for (const entry of ordered) {
    if ('heading' in entry) {
      console.log(chalk.dim(`  ── ${entry.heading}`));
      console.log();
      continue;
    }
    const check = entry.check;
    const cd = checkDiffs.get(check.id);
    const header =
      chalk.bold(`  ${check.name}`) +
      (check.applicable === false ? chalk.dim(' (n/a)') : chalk.dim(` (${check.score}/100)`));
    console.log(cd ? header + formatDelta(cd.delta) : header);

    for (const finding of check.findings) {
      console.log(`${STATUS_ICONS[finding.status]} ${finding.message}`);
      if (finding.detail) {
        console.log(chalk.dim(`         ${finding.detail}`));
      }
      if (finding.hint) {
        console.log(chalk.dim.italic(`         \uD83D\uDCA1 ${finding.hint}`));
      }
      if (finding.learnMoreUrl) {
        console.log(chalk.cyan(`         \u2192 ${finding.learnMoreUrl}`));
      }
    }
    console.log();
  }

  // Diff summary section
  if (diff && (diff.regressions.length > 0 || diff.improvements.length > 0)) {
    console.log(chalk.dim('  ──────────────────────────────────────'));
    console.log();

    if (diff.regressions.length > 0) {
      console.log(chalk.red.bold('  Regressions'));
      for (const r of diff.regressions) {
        console.log(chalk.red(`    ${r.name}: ${r.previous} \u2192 ${r.current} (\u25BC${Math.abs(r.delta)})`));
      }
      console.log();
    }

    if (diff.improvements.length > 0) {
      console.log(chalk.green.bold('  Improvements'));
      for (const imp of diff.improvements) {
        console.log(chalk.green(`    ${imp.name}: ${imp.previous} \u2192 ${imp.current} (\u25B2${imp.delta})`));
      }
      console.log();
    }
  }

  if (report.overallScore < 100) {
    console.log(chalk.dim('  ──────────────────────────────────────'));
    console.log();
    console.log(`  Generate missing files: ${chalk.cyan('npx ax-init')}`);
    console.log();
  }

  console.log(chalk.dim('  Powered by ax-audit \u2014 Lighthouse for AI Agents'));
  console.log();
}

export function reportBatchTerminal(batch: BatchAuditReport): void {
  for (const r of batch.reports) {
    reportTerminal(r);
  }

  const { summary } = batch;
  const grade = summary.grade;
  const colorFn = gradeColor(grade);

  console.log(chalk.bold('  ═══ Batch Summary ═══'));
  console.log();

  const colUrl = 40;
  const colScore = 10;
  const colGrade = 12;
  console.log(chalk.dim('  ' + 'URL'.padEnd(colUrl) + 'Score'.padStart(colScore) + 'Grade'.padStart(colGrade)));
  console.log(chalk.dim('  ' + '─'.repeat(colUrl + colScore + colGrade)));

  for (const r of batch.reports) {
    const rGrade = getGrade(r.overallScore);
    const rColor = gradeColor(rGrade);
    const shortUrl = r.url.length > colUrl - 2 ? r.url.slice(0, colUrl - 5) + '...' : r.url;
    console.log(
      '  ' +
        shortUrl.padEnd(colUrl) +
        rColor.bold(`${r.overallScore}/100`.padStart(colScore)) +
        rColor(rGrade.label.padStart(colGrade)),
    );
  }

  console.log();
  console.log(
    `  ${summary.total} URLs audited: ${chalk.green(`${summary.passed} passed`)}` +
      (summary.failed > 0 ? `, ${chalk.red(`${summary.failed} failed`)}` : ''),
  );

  const barWidth = 40;
  const filled = Math.round((summary.averageScore / 100) * barWidth);
  const empty = barWidth - filled;
  console.log(
    `  ${colorFn('\u2588'.repeat(filled))}${chalk.gray('\u2591'.repeat(empty))}  ${colorFn.bold(summary.averageScore + '/100')} avg  ${colorFn(grade.label)}`,
  );
  console.log(chalk.dim(`  Total duration: ${batch.duration}ms`));
  console.log();
}
