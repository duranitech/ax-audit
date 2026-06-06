import { getGrade } from '../scorer.js';
import type { AuditReport, BaselineDiff, BatchAuditReport, CheckResult, FindingStatus } from '../types.js';

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
  lines.push(`### ${check.name} — ${check.score}/100${delta(deltaValue)}`);
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

  // Summary table.
  out.push('| Check | Score |');
  out.push('| --- | --- |');
  for (const c of report.results) {
    out.push(`| ${c.name} | ${c.score}/100${delta(deltaByCheck.get(c.id))} |`);
  }
  out.push('');

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
