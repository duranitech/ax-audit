import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { findLinkTags, getAttribute } from './html-utils.js';

export const meta: CheckMeta = {
  id: 'content-negotiation',
  name: 'Content Negotiation',
  description: 'Checks whether the homepage serves Markdown to AI agents via Accept: text/markdown',
  weight: 0, // Informational in 3.x — will gain weight in v4.0 (score-affecting changes are treated as breaking).
};

/** Markdown sent by agents that support content negotiation (Claude Code, Cursor, OpenCode). */
const MARKDOWN_ACCEPT = 'text/markdown';

/** Score when Markdown is not negotiated but a `<link rel="alternate" type="text/markdown">` exists. */
const ALTERNATE_ONLY_SCORE = 40;

/**
 * Detect an HTML document masquerading as Markdown. Markdown may legally
 * contain inline HTML, so this only flags full documents (doctype / <html> /
 * <head> at the start), not embedded tags.
 */
function looksLikeHtmlDocument(body: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>])/i.test(body);
}

/** Find `<link rel="alternate" type="text/markdown">` tags in the homepage HTML. */
function findMarkdownAlternates(html: string): string[] {
  return findLinkTags(html, 'alternate').filter((tag) => {
    const type = getAttribute(tag, 'type');
    return type !== null && type.toLowerCase().includes('text/markdown');
  });
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];

  const res = await ctx.fetch(ctx.url, { headers: { Accept: MARKDOWN_ACCEPT } });

  if (res.status === 0) {
    findings.push({
      status: 'fail',
      message: 'Could not fetch homepage with "Accept: text/markdown"',
      detail: res.error ?? 'Network error',
      learnMoreUrl: guideUrl(meta.id, 'fetch-error'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const contentType = (res.headers['content-type'] ?? '').toLowerCase();
  const servesMarkdown = res.ok && contentType.includes(MARKDOWN_ACCEPT);

  if (!servesMarkdown) {
    findings.push({
      status: 'fail',
      message: 'Homepage does not serve Markdown via content negotiation',
      detail:
        res.status === 406
          ? 'Server responded 406 Not Acceptable to "Accept: text/markdown"'
          : `Got ${contentType.split(';')[0] || 'no Content-Type'} (HTTP ${res.status}) for "Accept: text/markdown"`,
      hint:
        'Serve a Markdown representation of your pages when agents request "Accept: text/markdown". ' +
        'Agents like Claude Code and Cursor ask for it, and Markdown cuts token usage by ~80% vs HTML. ' +
        'Cloudflare ("Markdown for Agents") and Vercel can enable this without code changes.',
      learnMoreUrl: guideUrl(meta.id, res.status === 406 ? 'http-406' : 'not-supported'),
    });

    const alternates = findMarkdownAlternates(ctx.html);
    if (alternates.length > 0) {
      findings.push({
        status: 'pass',
        message: `Markdown alternate advertised via <link rel="alternate" type="text/markdown"> (${alternates.length} link tag(s))`,
        detail: 'Discoverable, but agents must perform an extra fetch instead of negotiating the same URL.',
      });
      return buildResult(meta, ALTERNATE_ONLY_SCORE, findings, start);
    }

    findings.push({
      status: 'warn',
      message: 'No <link rel="alternate" type="text/markdown"> fallback found on the homepage',
      hint:
        'If you cannot enable content negotiation, advertise a Markdown version with ' +
        '<link rel="alternate" type="text/markdown" href="/index.md"> so agents can discover it.',
      learnMoreUrl: guideUrl(meta.id, 'no-alternate'),
    });
    return buildResult(meta, 0, findings, start);
  }

  let score = 100;
  findings.push({
    status: 'pass',
    message: 'Homepage serves Markdown via content negotiation (Accept: text/markdown)',
  });

  if (res.body.trim().length === 0) {
    findings.push({
      status: 'warn',
      message: 'Markdown response body is empty',
      hint: 'Return the page content as Markdown — an empty body gives agents nothing to work with.',
      learnMoreUrl: guideUrl(meta.id, 'empty-body'),
    });
    score -= 30;
  } else if (looksLikeHtmlDocument(res.body)) {
    findings.push({
      status: 'warn',
      message: 'Response is labeled text/markdown but the body is an HTML document',
      hint: 'Convert the page to actual Markdown instead of relabeling the HTML response.',
      learnMoreUrl: guideUrl(meta.id, 'mislabeled-content-type'),
    });
    score -= 25;
  } else {
    findings.push({ status: 'pass', message: 'Response body is Markdown, not an HTML document' });
  }

  const vary = (res.headers['vary'] ?? '').toLowerCase();
  const variesOnAccept = vary
    .split(',')
    .map((v) => v.trim())
    .some((v) => v === 'accept' || v === '*');
  if (variesOnAccept) {
    findings.push({ status: 'pass', message: 'Vary: Accept present (caches keep HTML and Markdown apart)' });
  } else {
    findings.push({
      status: 'warn',
      message: 'Vary header does not include "Accept"',
      detail: vary ? `Vary: ${res.headers['vary']}` : 'No Vary header',
      hint:
        'Send "Vary: Accept" when the same URL serves both HTML and Markdown, ' +
        'otherwise shared caches and CDNs may serve Markdown to browsers (or HTML to agents).',
      learnMoreUrl: guideUrl(meta.id, 'missing-vary'),
    });
    score -= 15;
  }

  if (ctx.html.length > 0 && res.body.length > 0) {
    const reduction = Math.round((1 - res.body.length / ctx.html.length) * 100);
    if (reduction > 0) {
      findings.push({
        status: 'pass',
        message: `Markdown is ~${reduction}% lighter than the HTML representation (${res.body.length} vs ${ctx.html.length} bytes)`,
      });
    } else {
      findings.push({
        status: 'warn',
        message: `Markdown response is not smaller than the HTML representation (${res.body.length} vs ${ctx.html.length} bytes)`,
        hint: 'Strip navigation, boilerplate, and markup remnants from the Markdown output — its purpose is token efficiency.',
        learnMoreUrl: guideUrl(meta.id, 'not-smaller'),
      });
    }
  }

  return buildResult(meta, score, findings, start);
}
