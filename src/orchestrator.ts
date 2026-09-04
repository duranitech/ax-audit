import { createFetcher } from './fetcher.js';
import { checks as allChecks } from './checks/index.js';
import { calculateOverallScore, getGrade } from './scorer.js';
import { isSelected } from './check-ids.js';
import type { AuditOptions, AuditReport, BatchAuditReport, BatchOptions, CheckContext, CheckResult } from './types.js';

export async function audit(options: AuditOptions): Promise<AuditReport> {
  const startTime = performance.now();
  const verbose = options.verbose ?? false;
  const log = verbose ? (msg: string) => console.error(`  [verbose] ${msg}`) : () => {};
  const fetcher = createFetcher({ timeout: options.timeout ?? 10000, verbose, retries: options.retries ?? 2 });

  const homepage = await fetcher.fetch(options.url);

  const ctx: CheckContext = {
    url: options.url.replace(/\/$/, ''),
    fetch: fetcher.fetch,
    html: homepage.body,
    headers: homepage.headers,
  };

  // Selection matches a check's current id or any former one, so a `--checks`
  // flag written before a rename keeps working.
  const checksToRun = options.checks ? allChecks.filter((c) => isSelected(c.meta, options.checks!)) : allChecks;

  log(`running ${checksToRun.length} check(s): ${checksToRun.map((c) => c.meta.id).join(', ')}`);

  const settled = await Promise.allSettled(checksToRun.map((c) => c.run(ctx)));

  const results: CheckResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') {
      log(`${checksToRun[i].meta.id}: score=${s.value.score} (${s.value.duration}ms)`);
      return s.value;
    }
    log(`${checksToRun[i].meta.id}: CRASHED — ${s.reason?.message || 'Unknown error'}`);
    return {
      id: checksToRun[i].meta.id,
      name: checksToRun[i].meta.name,
      description: checksToRun[i].meta.description,
      score: 0,
      findings: [{ status: 'fail' as const, message: `Check crashed: ${s.reason?.message || 'Unknown error'}` }],
      duration: 0,
    };
  });

  const overallScore = calculateOverallScore(
    results,
    checksToRun.map((c) => c.meta),
  );
  const grade = getGrade(overallScore);

  return {
    url: options.url,
    timestamp: new Date().toISOString(),
    overallScore,
    grade,
    results,
    duration: Math.round(performance.now() - startTime),
  };
}

export async function batchAudit(urls: string[], options: BatchOptions = {}): Promise<BatchAuditReport> {
  const startTime = performance.now();
  const concurrency = Math.max(1, options.concurrency ?? 1);

  // Preserve input order in the output while running up to `concurrency` audits
  // in parallel via a shared index-based work queue.
  const reports: AuditReport[] = new Array(urls.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < urls.length) {
      const i = next++;
      reports[i] = await audit({ ...options, url: urls[i] });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  const scores = reports.map((r) => r.overallScore);
  const averageScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return {
    reports,
    summary: {
      total: reports.length,
      passed: reports.filter((r) => r.overallScore >= 70).length,
      failed: reports.filter((r) => r.overallScore < 70).length,
      averageScore,
      grade: getGrade(averageScore),
    },
    duration: Math.round(performance.now() - startTime),
  };
}
