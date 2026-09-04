import { getGrade } from '../scorer.js';
import { CHECK_CATEGORIES } from '../constants.js';
import type {
  AuditReport,
  BaselineDiff,
  BatchAuditReport,
  CheckCategory,
  CheckResult,
  FindingStatus,
} from '../types.js';

const CATEGORY_ORDER: CheckCategory[] = ['content', 'discovery', 'access', 'policy', 'protocols'];

const CATEGORY_LABEL: Record<CheckCategory, string> = {
  content: 'Content',
  discovery: 'Discovery',
  access: 'Access',
  policy: 'Policy',
  protocols: 'Protocols',
};

function categoryOf(check: CheckResult): CheckCategory {
  return check.category ?? CHECK_CATEGORIES[check.id] ?? 'discovery';
}

/** Score cell text: N/A checks state so rather than showing a misleading 0. */
function scoreCell(check: CheckResult, deltaValue?: number): string {
  return check.applicable === false ? 'n/a' : `${check.score}/100${delta(deltaValue)}`;
}

const STATUS_EMOJI: Record<FindingStatus, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
};

function delta(value: number | undefined): string {
  if (value === undefined || value === 0) return '';
  return value > 0 ? ` ▲${value}` : ` ▼${Math.abs(value)}`;
}

function checkSection(check: CheckResult, deltaValue?: number): string {
  const lines: string[] = [];
  lines.push(`### ${check.name} — ${scoreCell(check, deltaValue)}`);
  lines.push('');
  for (const f of check.findings) {
    let line = `- ${STATUS_EMOJI[f.status]} ${f.message}`;
    if (f.detail) line += ` — ${f.detail}`;
    lines.push(line);
    if (f.hint && f.status !== 'pass') lines.push(`  - _${f.hint}_`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Render a single audit report as a Markdown document (ideal for CI / PR comments). */
export function renderMarkdown(report: AuditReport, diff?: BaselineDiff): string {
  const grade = getGrade(report.overallScore);
  const deltaByCheck = new Map(diff?.checks.map((c) => [c.id, c.delta]));

  const out: string[] = [];
  out.push(`## AX Audit — ${report.url}`);
  out.push('');
  out.push(`**${report.overallScore}/100 · ${grade.label}**${delta(diff?.overallDelta)}`);
  out.push('');
  out.push(`<sub>${report.timestamp} · ${report.duration}ms</sub>`);
  out.push('');

  if (diff?.scoringModelChanged) {
    out.push(
      '> **Baseline predates this scoring model.** Deltas below measure the model change as much as the site, and ' +
        'regression gating is suspended. Re-save with `--save-baseline` to resume it.',
    );
    out.push('');
  }

  // Summary table, grouped by category so a reader sees which area is weak.
  out.push('| Area | Check | Score |');
  out.push('| --- | --- | --- |');
  for (const category of CATEGORY_ORDER) {
    const checks = report.results.filter((c) => categoryOf(c) === category);
    for (const [i, c] of checks.entries()) {
      const area = i === 0 ? `**${CATEGORY_LABEL[category]}**` : '';
      out.push(`| ${area} | ${c.name} | ${scoreCell(c, deltaByCheck.get(c.id))} |`);
    }
  }
  out.push('');

  const notApplicable = report.results.filter((c) => c.applicable === false);
  if (notApplicable.length > 0) {
    out.push(
      `<sub>${notApplicable.length} check(s) marked n/a — the site has no such surface, so they are excluded from the score rather than counted as failures.</sub>`,
    );
    out.push('');
  }

  for (const c of report.results) {
    out.push(checkSection(c, deltaByCheck.get(c.id)));
  }

  return out.join('\n').trimEnd() + '\n';
}

export function reportMarkdown(report: AuditReport, diff?: BaselineDiff): void {
  console.log(renderMarkdown(report, diff));
}

/** Render a batch audit as Markdown: a summary table followed by each report. */
export function renderBatchMarkdown(batch: BatchAuditReport): string {
  const out: string[] = [];
  out.push('# AX Audit — Batch Report');
  out.push('');
  out.push('| URL | Score | Grade |');
  out.push('| --- | --- | --- |');
  for (const r of batch.reports) {
    out.push(`| ${r.url} | ${r.overallScore}/100 | ${getGrade(r.overallScore).label} |`);
  }
  out.push('');
  out.push(
    `**${batch.summary.total} URLs · ${batch.summary.passed} passed · ${batch.summary.failed} failed · ${batch.summary.averageScore}/100 avg (${batch.summary.grade.label})**`,
  );
  out.push('');
  for (const r of batch.reports) {
    out.push('---');
    out.push('');
    out.push(renderMarkdown(r));
  }
  return out.join('\n').trimEnd() + '\n';
}

export function reportBatchMarkdown(batch: BatchAuditReport): void {
  console.log(renderBatchMarkdown(batch));
}
