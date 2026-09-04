import { guideUrl } from '../guide-urls.js';
import type { CheckMeta, CheckResult, FetchResponse, Finding } from '../types.js';

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export function buildResult(
  meta: CheckMeta,
  score: number,
  findings: Finding[],
  start: number,
  options: { applicable?: boolean } = {},
): CheckResult {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    score: clampScore(score),
    findings,
    duration: Math.round(performance.now() - start),
    ...(meta.category !== undefined ? { category: meta.category } : {}),
    ...(options.applicable === false ? { applicable: false } : {}),
  };
}

/**
 * Result for a check whose subject the site does not have: no API to describe,
 * no commerce surface, no MCP server. Reported as N/A and excluded from the
 * score rather than counted as a failure.
 */
export function notApplicable(meta: CheckMeta, findings: Finding[], start: number): CheckResult {
  return buildResult(meta, 0, findings, start, { applicable: false });
}

/**
 * Whether a response body is a web page rather than the machine-readable
 * document that was asked for.
 *
 * Single-page applications answer every unmatched path with their index shell,
 * status 200. Probing `/.well-known/agent-card.json` or `/mcp/server-card` on
 * such a site returns HTML, and a check that trusts the status code reports a
 * *malformed* document where the honest answer is that the document is absent.
 * That mistake is worse than a miss: it sends an operator hunting for a bug in
 * a file they never wrote.
 *
 * Detection is deliberately narrow — a doctype or an `<html>` tag near the top
 * of the body. Anything else is handed to the real parser, which reports its own
 * problems precisely.
 */
export function isHtmlDocument(body: string): boolean {
  const head = body.slice(0, 1024).trimStart();
  return /^<!doctype\s+html/i.test(head) || /^<html[\s>]/i.test(head) || /<html[\s>]/i.test(head.slice(0, 512));
}

/**
 * Validate the `Content-Type` of a fetched resource against a list of acceptable MIME types.
 *
 * Returns:
 * - `null` when the content type is acceptable (no finding to add)
 * - a `Finding` describing the mismatch otherwise (caller decides whether to apply a score penalty)
 */
export function checkContentType(
  res: FetchResponse,
  expected: string[],
  context: { checkId: string; resourceLabel: string; anchor: string },
): Finding | null {
  const ct = (res.headers['content-type'] ?? '').toLowerCase();
  if (!ct) {
    return {
      status: 'warn',
      message: `${context.resourceLabel} has no Content-Type header`,
      hint: `Serve ${context.resourceLabel} with one of: ${expected.join(', ')}.`,
      learnMoreUrl: guideUrl(context.checkId, context.anchor),
    };
  }
  if (expected.some((mime) => ct.includes(mime))) return null;
  return {
    status: 'warn',
    message: `${context.resourceLabel} Content-Type is "${ct.split(';')[0]}"`,
    detail: `Expected one of: ${expected.join(', ')}`,
    hint: `Configure your server to serve ${context.resourceLabel} as ${expected[0]} so AI agents parse it correctly.`,
    learnMoreUrl: guideUrl(context.checkId, context.anchor),
  };
}
