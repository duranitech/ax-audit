import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

export const meta: CheckMeta = {
  id: 'crawl-efficiency',
  name: 'Crawl Efficiency',
  description: 'Checks compression, conditional GET (ETag / Last-Modified), and response size',
  weight: 0, // Informational in 3.x — will gain weight in v4.0 (score-affecting changes are treated as breaking).
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

  return buildResult(meta, score, findings, start);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
