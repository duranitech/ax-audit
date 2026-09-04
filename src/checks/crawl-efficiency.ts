import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { extractVisibleText } from './html-utils.js';

export const meta: CheckMeta = {
  id: 'crawl-efficiency',
  name: 'Crawl Efficiency',
  description: 'Checks compression, conditional GET (ETag / Last-Modified), and response size',
};

/** Page sizes (decompressed HTML bytes) above this earn a warning. */
const LARGE_PAGE_BYTES = 2_000_000;
const ACCEPTABLE_PAGE_BYTES = 500_000;

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  // Request explicitly advertising modern compression. The runtime's fetch
  // transparently decompresses the body, but the Content-Encoding header still
  // reflects what the server sent on the wire.
  const res = await ctx.fetch(ctx.url, { headers: { 'Accept-Encoding': 'br, gzip, deflate' } });

  if (!res.ok) {
    findings.push({
      status: 'fail',
      message: 'Homepage request failed — cannot assess crawl efficiency',
      detail: `HTTP ${res.status || 'network error'}`,
      learnMoreUrl: guideUrl(meta.id, 'fetch-failed'),
    });
    return buildResult(meta, 0, findings, start);
  }

  /* ── Compression ──────────────────────────────────────────────────── */

  const encoding = (res.headers['content-encoding'] ?? '').toLowerCase().trim();
  if (encoding === 'br') {
    findings.push({ status: 'pass', message: 'Response compressed with Brotli (br)' });
  } else if (encoding === 'gzip' || encoding === 'deflate' || encoding === 'zstd') {
    findings.push({
      status: 'pass',
      message: `Response compressed with ${encoding}`,
      detail: 'Brotli (br) typically compresses text 10–20% smaller — consider enabling it.',
    });
  } else {
    findings.push({
      status: 'warn',
      message: 'Response is not compressed',
      detail: encoding ? `Content-Encoding: ${encoding}` : 'No Content-Encoding header',
      hint:
        'Enable Brotli or gzip for text responses. Compression cuts bytes transferred by ~70–80% and ' +
        'reduces crawl cost for every agent and bot that fetches your pages.',
      learnMoreUrl: guideUrl(meta.id, 'no-compression'),
    });
    score -= 30;
  }

  /* ── Conditional GET (ETag / Last-Modified → 304) ─────────────────── */

  const etag = res.headers['etag'];
  const lastModified = res.headers['last-modified'];

  if (!etag && !lastModified) {
    findings.push({
      status: 'warn',
      message: 'No ETag or Last-Modified header — conditional requests unsupported',
      hint:
        'Send an ETag or Last-Modified header so crawlers can revalidate with If-None-Match / ' +
        'If-Modified-Since and receive a cheap 304 Not Modified instead of the full body.',
      learnMoreUrl: guideUrl(meta.id, 'no-validators'),
    });
    score -= 30;
  } else {
    const validator = etag ? 'ETag' : 'Last-Modified';
    findings.push({ status: 'pass', message: `Cache validator present (${validator})` });

    const conditionalHeaders: Record<string, string> = {};
    if (etag) conditionalHeaders['If-None-Match'] = etag;
    if (lastModified) conditionalHeaders['If-Modified-Since'] = lastModified;

    const conditional = await ctx.fetch(ctx.url, { headers: conditionalHeaders });
    if (conditional.status === 304) {
      findings.push({ status: 'pass', message: 'Conditional request returns 304 Not Modified' });
    } else {
      findings.push({
        status: 'warn',
        message: `Conditional request returned ${conditional.status} instead of 304 Not Modified`,
        detail: `Re-requested with ${Object.keys(conditionalHeaders).join(' + ')}`,
        hint:
          'The server advertises a cache validator but does not honor If-None-Match / If-Modified-Since. ' +
          'Configure it to return 304 when the validator matches, so crawlers avoid re-downloading unchanged pages.',
        learnMoreUrl: guideUrl(meta.id, 'no-304'),
      });
      score -= 15;
    }
  }

  /* ── Response size ────────────────────────────────────────────────── */

  const bytes = Buffer.byteLength(res.body, 'utf8');
  if (bytes > LARGE_PAGE_BYTES) {
    findings.push({
      status: 'warn',
      message: `Homepage is very large (${formatBytes(bytes)} decompressed)`,
      hint:
        'Large documents inflate crawl cost and token usage. Trim inlined data, split content, ' +
        'or serve a Markdown representation to agents (see the content-negotiation check).',
      learnMoreUrl: guideUrl(meta.id, 'large-page'),
    });
    score -= 10;
  } else if (bytes > ACCEPTABLE_PAGE_BYTES) {
    findings.push({
      status: 'warn',
      message: `Homepage is on the large side (${formatBytes(bytes)} decompressed)`,
      hint: 'Consider trimming inlined payloads to reduce crawl cost.',
      learnMoreUrl: guideUrl(meta.id, 'large-page'),
    });
    score -= 5;
  } else {
    findings.push({ status: 'pass', message: `Homepage size is reasonable (${formatBytes(bytes)} decompressed)` });
  }

  reportTokenBudget(ctx.html ?? '', findings);
  reportResponseTime(res.elapsedMs, findings);

  return buildResult(meta, score, findings, start);
}

/* ── Cost in tokens and in time (informational in 3.x) ──────────────────── */

/** Rough characters-per-token ratio for English prose in a byte-pair encoding. */
const CHARS_PER_TOKEN = 4;
/** Above this, a page crowds out everything else in an agent's context window. */
const LARGE_TOKEN_BUDGET = 25_000;
/** Time to a complete response beyond which agents start timing out or giving up. */
const SLOW_RESPONSE_MS = 2_000;

/**
 * Estimate the token cost of the readable content.
 *
 * Bytes are the wrong unit for an agent: a page can be small and still expensive
 * once markup is stripped, or large and cheap. The estimate is a chars-per-token
 * approximation, stated as such, and it is compared against the whole response
 * so an operator can see how much of what they send is markup the agent pays to
 * receive and then discards.
 */
export function reportTokenBudget(html: string, findings: Finding[]): void {
  if (html.length === 0) return;

  const text = extractVisibleText(html);
  const contentTokens = Math.round(text.length / CHARS_PER_TOKEN);
  const wireTokens = Math.round(html.length / CHARS_PER_TOKEN);
  const markupShare = wireTokens > 0 ? Math.round((1 - contentTokens / wireTokens) * 100) : 0;

  if (contentTokens > LARGE_TOKEN_BUDGET) {
    findings.push({
      status: 'warn',
      message: `Homepage carries roughly ${contentTokens.toLocaleString('en-US')} tokens of readable content`,
      detail: 'Estimated at four characters per token.',
      hint:
        'A page this large crowds out everything else in an agent\u2019s context window, so it reads the beginning and ' +
        'gives up. Split it, or serve a Markdown representation.',
      learnMoreUrl: guideUrl(meta.id, 'large-token-budget'),
    });
    return;
  }

  findings.push({
    status: markupShare > 90 ? 'warn' : 'pass',
    message: `Roughly ${contentTokens.toLocaleString('en-US')} tokens of content in ${wireTokens.toLocaleString('en-US')} tokens of response (${markupShare}% markup)`,
    detail: 'Estimated at four characters per token.',
    ...(markupShare > 90
      ? {
          hint: 'An agent pays to receive the markup and then discards it. Serving Markdown on Accept negotiation is the direct fix.',
          learnMoreUrl: guideUrl(meta.id, 'markup-overhead'),
        }
      : {}),
  });
}

/** Report how long the origin took, since agents give up sooner than people do. */
export function reportResponseTime(elapsedMs: number | undefined, findings: Finding[]): void {
  if (elapsedMs === undefined) return;

  if (elapsedMs > SLOW_RESPONSE_MS) {
    findings.push({
      status: 'warn',
      message: `Homepage took ${elapsedMs}ms to respond`,
      hint:
        'Agents crawl on tighter timeouts than browsers and rarely retry. A slow page is not a slow page to them, it ' +
        'is a missing one.',
      learnMoreUrl: guideUrl(meta.id, 'slow-response'),
    });
    return;
  }

  findings.push({ status: 'pass', message: `Homepage responded in ${elapsedMs}ms` });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
