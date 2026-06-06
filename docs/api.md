# Programmatic API

Full TypeScript support; every public type is exported from the package root.

```typescript
import { audit, batchAudit } from 'ax-audit';
import type { AuditReport, BatchAuditReport } from 'ax-audit';
```

## `audit(options: AuditOptions): Promise<AuditReport>`

Runs all (or selected) checks against one URL. Checks execute in parallel via `Promise.allSettled`; a crashing check yields a score-0 result instead of failing the audit. All HTTP requests within a run share an in-memory cache keyed by URL + normalized request headers.

```typescript
const report = await audit({
  url: 'https://example.com',
  checks: ['llms-txt', 'content-negotiation'], // optional — default: all
  timeout: 10_000,                              // optional, ms per request
  retries: 2,                                   // optional, transient-failure retries
  verbose: false,                               // optional, logs to stderr
});

report.overallScore; // 0–100, weighted
report.grade.label;  // 'Excellent' | 'Good' | 'Fair' | 'Poor'
report.results;      // CheckResult[] — score, findings, duration per check
```

## `batchAudit(urls: string[], options?: BatchOptions): Promise<BatchAuditReport>`

Audits multiple URLs. `BatchOptions` extends `AuditOptions` (minus `url`) with `concurrency` (default 1 — sequential). Report order always matches input order regardless of concurrency.

```typescript
const batch = await batchAudit(urls, { concurrency: 4, retries: 2 });
batch.summary; // { total, passed, failed, averageScore, grade }
```

## Scoring

- `calculateOverallScore(results, metas): number` — weighted average; falls back to a plain average when all selected checks have weight 0, and returns 0 for empty input.
- `getGrade(score): Grade` — maps a score to `{ min, label, color }`.

## Baselines

- `toBaselineData(report): BaselineData` — minimal snapshot (overall + per-check scores).
- `saveBaseline(path, report): void` / `loadBaseline(path): BaselineData` — file persistence. `loadBaseline` throws on missing or invalid files.
- `diffBaseline(baseline, report): BaselineDiff` — per-check deltas plus `regressions` / `improvements` convenience arrays.

## Reporters

- `renderMarkdown(report, diff?): string` — Markdown document for a single report (summary table, findings with emoji, baseline deltas).
- `renderBatchMarkdown(batch): string` — batch summary table followed by every report.

Terminal and HTML rendering are CLI-internal; for custom output, consume the `AuditReport` JSON shape directly.

## Checks registry

`checks: CheckModule[]` exposes every check as `{ run(ctx), meta }`. You can run an individual check with a custom context:

```typescript
import { checks } from 'ax-audit';

const llms = checks.find((c) => c.meta.id === 'llms-txt')!;
const result = await llms.run({
  url: 'https://example.com',
  html: homepageHtml,
  headers: homepageHeaders,
  fetch: myFetchImpl, // (url, options?: FetchOptions) => Promise<FetchResponse>
});
```

`CheckContext.fetch` accepts an optional second argument `{ headers }`: custom headers merge case-insensitively over the defaults (a custom `Accept` or `User-Agent` replaces the default), and responses are cached per URL + normalized headers — mirroring HTTP `Vary` semantics.

## Exported types

`AuditOptions`, `BatchOptions`, `AuditReport`, `BatchAuditReport`, `CheckResult`, `CheckMeta`, `CheckContext`, `CheckModule`, `Finding`, `FindingStatus`, `FetchOptions`, `FetchResponse`, `Grade`, `OutputFormat`, `BaselineData`, `BaselineDiff`, `CheckDiff`.
