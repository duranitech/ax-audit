export type FindingStatus = 'pass' | 'warn' | 'fail';

export interface Finding {
  status: FindingStatus;
  message: string;
  detail?: string;
  hint?: string;
  learnMoreUrl?: string;
}

export interface CheckResult {
  id: string;
  name: string;
  description: string;
  score: number;
  findings: Finding[];
  duration: number;
}

export interface CheckMeta {
  id: string;
  name: string;
  description: string;
  weight: number;
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  url: string;
  error?: string;
}

/** Per-request options for the audit fetcher. */
export interface FetchOptions {
  /**
   * Extra request headers. Merged over the fetcher defaults, so a custom
   * `Accept` (e.g. `text/markdown` for content-negotiation probes) replaces
   * the default one. Header names are case-insensitive.
   */
  headers?: Record<string, string>;
}

export interface CheckContext {
  url: string;
  fetch: (url: string, options?: FetchOptions) => Promise<FetchResponse>;
  html: string;
  headers: Record<string, string>;
}

export interface CheckModule {
  run: (ctx: CheckContext) => Promise<CheckResult>;
  meta: CheckMeta;
}

export interface Grade {
  min: number;
  label: string;
  color: string;
}

export interface AuditReport {
  url: string;
  timestamp: string;
  overallScore: number;
  grade: Grade;
  results: CheckResult[];
  duration: number;
}

export interface AuditOptions {
  url: string;
  checks?: string[];
  timeout?: number;
  verbose?: boolean;
  /** Retry attempts for transient fetch failures (timeouts, 5xx, network errors). Default 2. */
  retries?: number;
}

export interface BatchOptions extends Omit<AuditOptions, 'url'> {
  /** Maximum number of URLs audited in parallel. Default 1 (sequential). */
  concurrency?: number;
}

export interface BatchAuditReport {
  reports: AuditReport[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    averageScore: number;
    grade: Grade;
  };
  duration: number;
}

export interface SecurityHeader {
  name: string;
  label: string;
  critical: boolean;
}

export type OutputFormat = 'terminal' | 'json' | 'html' | 'markdown';

/* ── Baseline / Diff ──────────────────────────────────────── */

/** Minimal snapshot of an audit run stored as the baseline file. */
export interface BaselineData {
  url: string;
  timestamp: string;
  overallScore: number;
  checks: Record<string, number>; // checkId → score
}

/** Per-check score delta. */
export interface CheckDiff {
  id: string;
  name: string;
  previous: number;
  current: number;
  delta: number; // positive = improvement, negative = regression
}

/** Full diff between the current audit and a stored baseline. */
export interface BaselineDiff {
  url: string;
  baselineTimestamp: string;
  currentTimestamp: string;
  overallPrevious: number;
  overallCurrent: number;
  overallDelta: number;
  checks: CheckDiff[];
  regressions: CheckDiff[]; // convenience: checks where delta < 0
  improvements: CheckDiff[]; // convenience: checks where delta > 0
}
