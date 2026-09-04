# Programmatic API

Full TypeScript support; every public type is exported from the package root.

```typescript
import { audit, batchAudit } from 'ax-audit';
import type { AuditReport, BatchAuditReport } from 'ax-audit';
```

The package is ESM-only (`"type": "module"`), targets Node 18+ (built-in `fetch`), and ships type declarations at `dist/index.d.ts`.

## `audit(options): Promise<AuditReport>`

Runs all (or selected) checks against one URL.

```typescript
function audit(options: AuditOptions): Promise<AuditReport>;

interface AuditOptions {
  url: string;          // required, fully qualified (scheme included)
  checks?: string[];    // default: all. Unknown IDs are silently ignored here
                        // (the CLI validates them; the API does not)
  timeout?: number;     // ms per request, default 10000
  retries?: number;     // transient-failure retries, default 2
  verbose?: boolean;    // log to stderr, default false
}
```

Behavior:

- Checks execute in parallel via `Promise.allSettled`. A check that **throws** becomes a score-0 `CheckResult` whose findings contain the error — `audit` itself never rejects for a check failure.
- All HTTP requests in a run share an in-memory cache keyed on URL + normalized request headers (`Vary`-aware).
- The homepage is fetched once and passed to every check as `ctx.html` / `ctx.headers`.

```typescript
const report = await audit({ url: 'https://example.com' });
report.overallScore; // number 0–100, weighted
report.grade;        // { min, label, color }
report.results;      // CheckResult[]
report.duration;     // ms
```

`audit` **rejects** only for an unrecoverable setup error (e.g. an invalid `url` that can't be parsed). Network failure on the homepage fetch does not reject — it surfaces as failing checks.

## `batchAudit(urls, options?): Promise<BatchAuditReport>`

```typescript
function batchAudit(urls: string[], options?: BatchOptions): Promise<BatchAuditReport>;

interface BatchOptions extends Omit<AuditOptions, 'url'> {
  concurrency?: number; // max parallel audits, default 1 (sequential)
}
```

Report order always matches input order, regardless of `concurrency`. `concurrency < 1` is treated as 1.

```typescript
const batch = await batchAudit(urls, { concurrency: 4, retries: 2 });
batch.reports;            // AuditReport[], input order
batch.summary.total;     // number
batch.summary.passed;    // count scoring >= 70
batch.summary.failed;    // count scoring < 70
batch.summary.averageScore;
batch.summary.grade;     // Grade for the average
```

## Result shapes

```typescript
interface AuditReport {
  url: string;
  timestamp: string;        // ISO 8601
  overallScore: number;     // 0–100
  grade: Grade;
  results: CheckResult[];
  duration: number;         // ms
}

interface CheckResult {
  id: string;               // e.g. 'llms-txt'
  name: string;             // e.g. 'LLMs.txt'
  description: string;
  score: number;            // 0–100, clamped
  findings: Finding[];
  duration: number;         // ms
}

interface Finding {
  status: 'pass' | 'warn' | 'fail';
  message: string;
  detail?: string;
  hint?: string;            // remediation advice (warn/fail)
  learnMoreUrl?: string;    // link to the matching remediation guide
}

interface Grade { min: number; label: string; color: string; }
```

## Scoring

```typescript
function calculateOverallScore(results: CheckResult[], metas: CheckMeta[]): number;
function getGrade(score: number): Grade;
```

`calculateOverallScore` computes the weighted average; it falls back to a plain average when all selected checks have weight 0, and returns 0 for empty input. `getGrade` maps a score to its `Grade`.

```ts
function categoryScore(results: CheckResult[], category: CheckCategory): number | null;
```

`categoryScore` is the same arithmetic over one area, and `null` when the area has nothing applicable. An overall number hides an area that is entirely broken — a site can score 80 while every access check fails, because the other four carry it. This is what `--fail-on-category` gates on and what a report grouped by area shows per group.

## Baselines

```typescript
function toBaselineData(report: AuditReport): BaselineData;
function saveBaseline(path: string, report: AuditReport): void;   // writes JSON
function loadBaseline(path: string): BaselineData;                 // throws on missing/invalid file
function diffBaseline(baseline: BaselineData, report: AuditReport): BaselineDiff;

interface BaselineData {
  url: string;
  timestamp: string;
  overallScore: number;
  checks: Record<string, number>; // checkId → score
}

interface BaselineDiff {
  url: string;
  baselineTimestamp: string;
  currentTimestamp: string;
  overallPrevious: number;
  overallCurrent: number;
  overallDelta: number;
  checks: CheckDiff[];
  regressions: CheckDiff[];   // delta < 0
  improvements: CheckDiff[];  // delta > 0
}
```

`loadBaseline` throws (does not return null) on a missing file or invalid JSON — wrap it in try/catch. Checks present now but absent from the baseline appear as new (no delta); checks removed since are ignored.

## Reporters

```typescript
function renderMarkdown(report: AuditReport, diff?: BaselineDiff): string;
function renderBatchMarkdown(batch: BatchAuditReport): string;
```

Both return a Markdown string (summary table + findings with status emoji; baseline deltas when a diff is passed). Terminal and HTML rendering are CLI-internal; for other formats, consume the `AuditReport` JSON directly.

## Checks registry

```typescript
import { checks } from 'ax-audit';

interface CheckModule {
  run: (ctx: CheckContext) => Promise<CheckResult>;
  meta: CheckMeta; // { id, name, description, weight }
}
```

Run an individual check with a custom context:

```typescript
const llms = checks.find((c) => c.meta.id === 'llms-txt')!;
const result = await llms.run({
  url: 'https://example.com',   // no trailing slash
  html: homepageHtml,
  headers: homepageHeaders,     // lowercased keys
  fetch: myFetchImpl,
});

interface CheckContext {
  url: string;
  html: string;
  headers: Record<string, string>;
  fetch: (url: string, options?: FetchOptions) => Promise<FetchResponse>;
}

interface FetchOptions { headers?: Record<string, string>; }

interface FetchResponse {
  status: number;   // 0 on network error
  headers: Record<string, string>; // lowercased keys
  body: string;
  ok: boolean;
  url: string;      // final URL after redirects
  error?: string;   // set when status === 0
}
```

`ctx.fetch` custom headers merge case-insensitively over the defaults (a custom `Accept` or `User-Agent` replaces the default), and responses are cached per URL + normalized headers — mirroring HTTP `Vary`. Your `fetch` implementation should never throw; model failures as `{ status: 0, ok: false, error }`.

## Reference tables

Exported so a consumer can *describe* an audit rather than only run one:
a report that prints what a check is worth, a page that groups results by
area, a robots.txt editor that names the crawlers worth naming. Before
4.1 none of these were reachable — the `exports` map admits only the
entry point — so every consumer transcribed them and wrote a test to
catch the day the copy went stale.

```ts
const VERSION: string;

const CHECK_WEIGHTS: Record<string, number>;
const CHECK_CATEGORIES: Record<string, CheckCategory>;
const GRADES: Grade[];

const AI_CRAWLERS: Record<CrawlerPurpose, string[]>;
const ALL_AI_CRAWLERS: string[];
const CORE_AI_CRAWLERS: string[];
const LEGACY_AI_CRAWLERS: Record<string, string>;  // token -> why it does nothing
const CRAWLER_META: Record<string, CrawlerInfo>;
const CONTENT_SIGNALS: string[];

function crawlerInfo(token: string): CrawlerInfo | undefined;
function crawlerPurpose(token: string): CrawlerPurpose | undefined;
function legacyCrawlerNote(token: string): string | undefined;

type CrawlerPurpose = 'training' | 'search' | 'user-fetch' | 'agent';

interface CrawlerInfo {
  vendor: string;
  purpose: CrawlerPurpose;
  honorsRobots: boolean | 'partial';
  impact: string;      // one sentence on what blocking this costs
  docUrl: string;
  ipListUrl?: string;  // published ranges, for reverse verification
  signsRequests?: boolean;   // Web Bot Auth (RFC 9421)
  tokenOnly?: boolean;       // a robots.txt control that never appears in a request
  note?: string;
}
```

`CHECK_WEIGHTS` and `CHECK_CATEGORIES` both cover every shipped check, and
`test/public-api.test.js` fails if either stops doing so. A check may also
declare `meta.category` for itself; when it does, the two must agree.

The rest of `constants.ts` — thresholds, media types, required-field
lists — stays private. A consumer pinned to those would make every
check's internals a breaking change.

## API stability

Within a major version, the exported function signatures and the `AuditReport` JSON shape are stable. Specifically:

- **Stable:** `audit`, `batchAudit`, `calculateOverallScore`, `categoryScore`, `getGrade`, the baseline functions, the reporter functions, the reference tables above, and all exported type *shapes*.
- **May change in minor versions:** the *set* of checks (new checks are added), individual check `score`/`findings` content, check `weight` values (new checks start at 0; reweighting is reserved for majors), and the *contents* of the reference tables — a crawler token is added the week its vendor documents one, and waiting for a major would make the table wrong for months. The tables themselves, and their shapes, are stable. Treat `results` as a list to iterate, not a fixed-length tuple.
- **Internal:** anything not exported from `src/index.ts`, including terminal/HTML reporters and individual check modules' internals.

## Exported types

`AuditOptions`, `BatchOptions`, `AuditReport`, `BatchAuditReport`, `CheckResult`, `CheckMeta`, `CheckContext`, `CheckModule`, `Finding`, `FindingStatus`, `FetchOptions`, `FetchResponse`, `Grade`, `OutputFormat`, `BaselineData`, `BaselineDiff`, `CheckDiff`.
