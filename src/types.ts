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
  /**
   * `false` when the check does not apply to this site (no API surface for
   * `api-discovery`, no commerce signals for `commerce-discovery`, ...).
   * Not-applicable checks are reported as N/A and excluded from the weighted
   * denominator instead of scoring 0. Absent means applicable.
   */
  applicable?: boolean;
  /** Category used to group results in reports. Mirrors `CheckMeta.category`. */
  category?: CheckCategory;
}

/**
 * Report grouping for a check. Categories describe *what kind of readiness*
 * a check measures, so reports can summarise per area rather than as one
 * undifferentiated list of 20+ checks.
 *
 * - `content`    — is there substance an agent can read and quote?
 * - `discovery`  — can an agent find the site's machine-readable entry points?
 * - `access`     — can an agent actually retrieve it (crawler policy, WAFs, HTTP hygiene)?
 * - `policy`     — what are the declared usage rights, and are they consistent?
 * - `protocols`  — callable surfaces: A2A, MCP, OpenAPI, skills, commerce.
 */
export type CheckCategory = 'content' | 'discovery' | 'access' | 'policy' | 'protocols';

export interface CheckMeta {
  id: string;
  name: string;
  description: string;
  /**
   * Optional per-check override. Weights normally live in one place,
   * `CHECK_WEIGHTS`; declaring them here as well let the two drift apart, which
   * is exactly what happened between 3.x and 4.0. Prefer the central map.
   */
  weight?: number;
  /** Report grouping. Falls back to `CHECK_CATEGORIES[id]` when omitted. */
  category?: CheckCategory;
  /**
   * Former ids for this check. `--checks` selection and baseline diffing
   * resolve aliases, so renaming a check never silently drops a saved
   * baseline entry or breaks an existing CI invocation.
   */
  aliases?: string[];
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  url: string;
  error?: string;
  /** Wall-clock duration of the request in milliseconds (undefined for synthetic responses). */
  elapsedMs?: number;
  /** Whether the fetch followed at least one redirect before producing this response. */
  redirected?: boolean;
  /** `Location` header value when the request was made with `redirect: 'manual'` and got a 3xx. */
  redirectLocation?: string;
}

/** Per-request options for the audit fetcher. */
export interface FetchOptions {
  /**
   * Extra request headers. Merged over the fetcher defaults, so a custom
   * `Accept` (e.g. `text/markdown` for content-negotiation probes) replaces
   * the default one. Header names are case-insensitive.
   */
  headers?: Record<string, string>;
  /**
   * HTTP method. `HEAD` is used for cheap liveness probes (llms.txt link
   * sampling, catalog entry resolution) where the body is irrelevant.
   * Default `GET`.
   */
  method?: 'GET' | 'HEAD';
  /**
   * Redirect handling. `manual` returns the 3xx response itself with
   * `redirectLocation` populated, so checks can count hops and inspect
   * redirect targets. Default `follow`.
   */
  redirect?: 'follow' | 'manual';
}

export interface CheckContext {
  url: string;
  fetch: (url: string, options?: FetchOptions) => Promise<FetchResponse>;
  html: string;
  headers: Record<string, string>;
  /**
   * Forces protocol checks applicable regardless of what the site currently
   * exposes, so a team can audit against what they intend to build. `auto`
   * (the default) detects each surface from the site itself.
   */
  profile?: 'auto' | 'api' | 'mcp' | 'agent' | 'docs' | 'commerce' | 'all';
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
  /**
   * Forces protocol checks applicable. By default a check for a surface the
   * site does not have reports N/A rather than zero; a profile says "audit me
   * as though I had one".
   */
  profile?: 'auto' | 'api' | 'mcp' | 'agent' | 'docs' | 'commerce' | 'all';
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
