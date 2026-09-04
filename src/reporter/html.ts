import { getGrade } from '../scorer.js';
import { CHECK_CATEGORIES } from '../constants.js';
import type {
  AuditReport,
  BaselineDiff,
  BatchAuditReport,
  CheckDiff,
  CheckResult,
  Finding,
  FindingStatus,
  Grade,
  CheckCategory,
} from '../types.js';

function gradeHslColor(grade: Grade): string {
  switch (grade.color) {
    case 'green':
      return 'hsl(140, 70%, 45%)';
    case 'yellow':
      return 'hsl(45, 90%, 48%)';
    case 'orange':
      return 'hsl(25, 90%, 50%)';
    default:
      return 'hsl(0, 80%, 50%)';
  }
}

function statusIcon(status: FindingStatus): string {
  switch (status) {
    case 'pass':
      return '<span class="icon pass">&#10003;</span>';
    case 'warn':
      return '<span class="icon warn">&#9888;</span>';
    case 'fail':
      return '<span class="icon fail">&#10007;</span>';
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderGauge(score: number, size: number = 160): string {
  const grade = getGrade(score);
  const color = gradeHslColor(grade);
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  return `
    <div class="gauge" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="var(--gauge-bg)" stroke-width="8"/>
        <circle cx="60" cy="60" r="54" fill="none" stroke="${color}" stroke-width="8"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
          stroke-linecap="round" transform="rotate(-90 60 60)"
          style="transition: stroke-dashoffset 1s ease"/>
      </svg>
      <div class="gauge-text">
        <span class="gauge-score" style="color:${color}">${score}</span>
        <span class="gauge-label">${grade.label}</span>
      </div>
    </div>`;
}

function renderFinding(f: Finding): string {
  return `
    <div class="finding ${f.status}">
      ${statusIcon(f.status)}
      <div class="finding-content">
        <span class="finding-msg">${escapeHtml(f.message)}</span>
        ${f.detail ? `<span class="finding-detail">${escapeHtml(f.detail)}</span>` : ''}
        ${f.hint ? `<span class="finding-hint">\uD83D\uDCA1 ${escapeHtml(f.hint)}</span>` : ''}
        ${f.learnMoreUrl ? `<a class="finding-learn-more" href="${escapeHtml(f.learnMoreUrl)}" target="_blank" rel="noopener">\u2192 Learn more</a>` : ''}
      </div>
    </div>`;
}

function renderDeltaBadge(delta: number): string {
  if (delta === 0) return '<span class="delta delta-neutral">&mdash;</span>';
  if (delta > 0) return `<span class="delta delta-up">&#9650;${delta}</span>`;
  return `<span class="delta delta-down">&#9660;${Math.abs(delta)}</span>`;
}

function renderCheck(check: CheckResult, checkDiff?: CheckDiff): string {
  const notApplicable = check.applicable === false;
  const grade = getGrade(check.score);
  const color = notApplicable ? 'var(--muted)' : gradeHslColor(grade);
  const diffHtml = checkDiff && !notApplicable ? renderDeltaBadge(checkDiff.delta) : '';
  const scoreLabel = notApplicable ? 'n/a' : `${check.score}/100`;

  return `
    <details class="check${notApplicable ? ' check-na' : ''}"${notApplicable ? '' : ' open'}>
      <summary>
        <div class="check-header">
          <span class="check-name">${escapeHtml(check.name)}</span>
          <span class="check-score" style="color:${color}">${scoreLabel} ${diffHtml}</span>
        </div>
        <div class="check-desc">${escapeHtml(check.description)}</div>
      </summary>
      <div class="check-findings">
        ${check.findings.map(renderFinding).join('')}
      </div>
    </details>`;
}

/** Group checks under category headings so a reader sees which area is weak. */
function renderCheckGroups(results: CheckResult[], checkDiffs: Map<string, CheckDiff>): string {
  const order: CheckCategory[] = ['content', 'discovery', 'access', 'policy', 'protocols'];
  const heading: Record<CheckCategory, string> = {
    content: 'Content',
    discovery: 'Discovery',
    access: 'Access',
    policy: 'Policy',
    protocols: 'Protocols',
  };
  const categoryOf = (c: CheckResult): CheckCategory => c.category ?? CHECK_CATEGORIES[c.id] ?? 'discovery';

  return order
    .map((category) => {
      const checks = results.filter((c) => categoryOf(c) === category);
      if (checks.length === 0) return '';
      return `
      <h2 class="category">${heading[category]}</h2>
      ${checks.map((c) => renderCheck(c, checkDiffs.get(c.id))).join('')}`;
    })
    .join('');
}

function renderDiffSummary(diff: BaselineDiff): string {
  if (diff.regressions.length === 0 && diff.improvements.length === 0) return '';

  const rows: string[] = [];

  if (diff.regressions.length > 0) {
    rows.push('<h3>Regressions</h3>');
    for (const r of diff.regressions) {
      rows.push(
        `<div class="diff-row diff-regression">${escapeHtml(r.name)}: ${r.previous} &rarr; ${r.current} <span class="delta delta-down">&#9660;${Math.abs(r.delta)}</span></div>`,
      );
    }
  }

  if (diff.improvements.length > 0) {
    rows.push('<h3>Improvements</h3>');
    for (const imp of diff.improvements) {
      rows.push(
        `<div class="diff-row diff-improvement">${escapeHtml(imp.name)}: ${imp.previous} &rarr; ${imp.current} <span class="delta delta-up">&#9650;${imp.delta}</span></div>`,
      );
    }
  }

  return `<div class="diff-summary">${rows.join('')}</div>`;
}

function renderSingleReport(report: AuditReport, diff?: BaselineDiff): string {
  const checkDiffs = new Map<string, CheckDiff>();
  if (diff) {
    for (const cd of diff.checks) {
      checkDiffs.set(cd.id, cd);
    }
  }

  const baselineInfo = diff
    ? `<div class="meta-row"><span>Baseline: ${escapeHtml(diff.baselineTimestamp)}</span><span>Overall: ${diff.overallPrevious} &rarr; ${diff.overallCurrent} ${renderDeltaBadge(diff.overallDelta)}</span></div>`
    : '';

  return `
    <div class="report">
      <div class="report-header">
        ${renderGauge(report.overallScore)}
        <div class="report-meta">
          <h2><a href="${escapeHtml(report.url)}" target="_blank" rel="noopener">${escapeHtml(report.url)}</a></h2>
          <div class="meta-row">
            <span>${report.timestamp}</span>
            <span>${report.duration}ms</span>
          </div>
          ${baselineInfo}
        </div>
      </div>
      ${diff ? renderDiffSummary(diff) : ''}
      <div class="checks">
        ${renderCheckGroups(report.results, checkDiffs)}
      </div>
    </div>`;
}

function renderBatchSummary(batch: BatchAuditReport): string {
  const rows = batch.reports
    .map((r) => {
      const grade = getGrade(r.overallScore);
      const color = gradeHslColor(grade);
      const passed = r.overallScore >= 70;
      return `
      <tr>
        <td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a></td>
        <td style="color:${color};font-weight:600">${r.overallScore}/100</td>
        <td style="color:${color}">${grade.label}</td>
        <td><span class="badge ${passed ? 'badge-pass' : 'badge-fail'}">${passed ? 'PASS' : 'FAIL'}</span></td>
      </tr>`;
    })
    .join('');

  const { summary } = batch;
  const avgGrade = getGrade(summary.averageScore);
  const avgColor = gradeHslColor(avgGrade);

  return `
    <div class="batch-summary">
      <h2>Batch Summary</h2>
      <div class="batch-stats">
        ${renderGauge(summary.averageScore, 120)}
        <div class="batch-info">
          <div class="stat"><span class="stat-value">${summary.total}</span><span class="stat-label">URLs</span></div>
          <div class="stat"><span class="stat-value" style="color:hsl(140,70%,45%)">${summary.passed}</span><span class="stat-label">Passed</span></div>
          ${summary.failed > 0 ? `<div class="stat"><span class="stat-value" style="color:hsl(0,80%,50%)">${summary.failed}</span><span class="stat-label">Failed</span></div>` : ''}
          <div class="stat"><span class="stat-value">${batch.duration}ms</span><span class="stat-label">Total</span></div>
        </div>
      </div>
      <table class="summary-table">
        <thead><tr><th>URL</th><th>Score</th><th>Grade</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td><strong>Average</strong></td>
          <td style="color:${avgColor};font-weight:600">${summary.averageScore}/100</td>
          <td style="color:${avgColor}">${avgGrade.label}</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>`;
}

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  --bg: #fff;
  --bg-card: #f8f9fa;
  --bg-finding: #fff;
  --text: #1a1a2e;
  --text-secondary: #666;
  --border: #e0e0e0;
  --gauge-bg: #e9ecef;
  --shadow: rgba(0,0,0,0.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --bg-card: #161b22;
    --bg-finding: #1c2128;
    --text: #e6edf3;
    --text-secondary: #8b949e;
    --border: #30363d;
    --gauge-bg: #21262d;
    --shadow: rgba(0,0,0,0.3);
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
}
h1 {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}
.header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.header svg { width: 32px; height: 32px; }
.header-sub { color: var(--text-secondary); font-size: 0.85rem; }
.report { margin-bottom: 2.5rem; }
.report-header {
  display: flex;
  align-items: center;
  gap: 2rem;
  margin-bottom: 1.5rem;
}
.report-meta { flex: 1; }
.report-meta h2 { font-size: 1.1rem; margin-bottom: 0.25rem; }
.report-meta a { color: var(--text); text-decoration: none; }
.report-meta a:hover { text-decoration: underline; }
.meta-row {
  display: flex;
  gap: 1.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.gauge {
  position: relative;
  flex-shrink: 0;
}
.gauge svg { width: 100%; height: 100%; }
.gauge-text {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}
.gauge-score { font-size: 2rem; font-weight: 700; display: block; line-height: 1; }
.gauge-label { font-size: 0.75rem; color: var(--text-secondary); }
.checks { display: flex; flex-direction: column; gap: 0.75rem; }
.check {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.check summary {
  padding: 0.75rem 1rem;
  cursor: pointer;
  list-style: none;
}
.check summary::-webkit-details-marker { display: none; }
.check summary::before {
  content: '\\25B6';
  display: inline-block;
  font-size: 0.65rem;
  margin-right: 0.5rem;
  transition: transform 0.2s;
  color: var(--text-secondary);
}
.check[open] summary::before { transform: rotate(90deg); }
.check-header {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  width: calc(100% - 1.5rem);
  justify-content: space-between;
}
.category { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 2rem 0 0.75rem; }
.check-na { opacity: 0.62; }
.check-name { font-weight: 600; }
.check-score { font-weight: 700; font-size: 0.9rem; }
.check-desc { color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.15rem; padding-left: 1.15rem; }
.check-findings { padding: 0 1rem 0.75rem 1rem; }
.finding {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.25rem;
  background: var(--bg-finding);
}
.finding-content { display: flex; flex-direction: column; }
.finding-msg { font-size: 0.85rem; }
.finding-detail { font-size: 0.75rem; color: var(--text-secondary); }
.finding-hint { font-size: 0.75rem; color: var(--text-secondary); font-style: italic; margin-top: 2px; display: block; padding: 4px 8px; background: var(--gauge-bg); border-radius: 4px; }
.finding-learn-more { font-size: 0.75rem; color: hsl(200, 80%, 50%); text-decoration: none; margin-top: 2px; display: inline-block; }
.finding-learn-more:hover { text-decoration: underline; }
.icon { font-weight: 700; font-size: 0.85rem; flex-shrink: 0; width: 1.2rem; text-align: center; }
.icon.pass { color: hsl(140, 70%, 45%); }
.icon.warn { color: hsl(45, 90%, 48%); }
.icon.fail { color: hsl(0, 80%, 50%); }
.batch-summary {
  margin-bottom: 2.5rem;
  padding: 1.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.batch-summary h2 { font-size: 1.2rem; margin-bottom: 1rem; }
.batch-stats {
  display: flex;
  align-items: center;
  gap: 2rem;
  margin-bottom: 1.5rem;
}
.batch-info { display: flex; gap: 1.5rem; }
.stat { display: flex; flex-direction: column; align-items: center; }
.stat-value { font-size: 1.5rem; font-weight: 700; }
.stat-label { font-size: 0.75rem; color: var(--text-secondary); }
.summary-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.summary-table th,
.summary-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
.summary-table th { color: var(--text-secondary); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
.summary-table a { color: var(--text); text-decoration: none; }
.summary-table a:hover { text-decoration: underline; }
.summary-table tfoot td { border-bottom: none; border-top: 2px solid var(--border); }
.badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.badge-pass { background: hsl(140, 70%, 90%); color: hsl(140, 70%, 30%); }
.badge-fail { background: hsl(0, 80%, 92%); color: hsl(0, 80%, 35%); }
@media (prefers-color-scheme: dark) {
  .badge-pass { background: hsl(140, 40%, 18%); color: hsl(140, 70%, 60%); }
  .badge-fail { background: hsl(0, 40%, 18%); color: hsl(0, 70%, 60%); }
}
.footer {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-align: center;
}
.footer a { color: var(--text-secondary); }
.delta { font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem; }
.delta-up { color: hsl(140, 70%, 45%); }
.delta-down { color: hsl(0, 80%, 50%); }
.delta-neutral { color: var(--text-secondary); }
.diff-summary {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.diff-summary h3 { font-size: 0.9rem; margin-bottom: 0.5rem; }
.diff-row { font-size: 0.85rem; padding: 0.25rem 0; }
.diff-regression { color: hsl(0, 80%, 50%); }
.diff-improvement { color: hsl(140, 70%, 45%); }
@media (prefers-color-scheme: dark) {
  .diff-regression { color: hsl(0, 70%, 60%); }
  .diff-improvement { color: hsl(140, 70%, 60%); }
}
@media (max-width: 600px) {
  body { padding: 1rem; }
  .report-header { flex-direction: column; align-items: flex-start; gap: 1rem; }
  .batch-stats { flex-direction: column; }
}
</style>
</head>
<body>
<div class="header">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
  </svg>
  <div>
    <h1>AX Audit Report</h1>
    <div class="header-sub">Lighthouse for AI Agents</div>
  </div>
</div>
${body}
<div class="footer">
  Generated by <a href="https://github.com/axrush/ax-audit" target="_blank" rel="noopener">ax-audit</a> &mdash; Lighthouse for AI Agents
</div>
</body>
</html>`;
}

/**
 * Render a single audit report as a self-contained HTML document.
 *
 * Separated from `reportHtml` so callers can embed the report, write it to a
 * file, or assert on it in tests, matching `renderMarkdown`.
 */
export function renderHtml(report: AuditReport, diff?: BaselineDiff): string {
  return htmlShell(`AX Audit — ${report.url}`, renderSingleReport(report, diff));
}

/** Render a batch audit as a self-contained HTML document. */
export function renderBatchHtml(batch: BatchAuditReport): string {
  const body = renderBatchSummary(batch) + batch.reports.map((r) => renderSingleReport(r)).join('');
  return htmlShell(`AX Audit — Batch Report (${batch.summary.total} URLs)`, body);
}

export function reportHtml(report: AuditReport, diff?: BaselineDiff): void {
  console.log(renderHtml(report, diff));
}

export function reportBatchHtml(batch: BatchAuditReport): void {
  console.log(renderBatchHtml(batch));
}
