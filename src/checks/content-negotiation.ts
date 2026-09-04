import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { findLinkTags, getAttribute } from './html-utils.js';
import { parseFrontmatter } from './frontmatter.js';

export const meta: CheckMeta = {
  id: 'content-negotiation',
  name: 'Content Negotiation',
  description: 'Checks whether the homepage serves Markdown to AI agents via Accept: text/markdown',
  category: 'content',
};

/** Markdown sent by agents that support content negotiation (Claude Code, Cursor, OpenCode). */
const MARKDOWN_ACCEPT = 'text/markdown';

/**
 * The Accept header a real agent sends. Probing with a bare `text/markdown`
 * tests a code path no client actually exercises: Claude Code, Cursor and
 * OpenCode all send a q-weighted list with HTML as the fallback, and a
 * negotiation implementation that only matches the bare string will pass this
 * check and fail every real request.
 */
const REALISTIC_ACCEPT = 'text/markdown, text/html;q=0.9, */*;q=0.1';

/**
 * Vercel and others negotiate on the user agent for known agents that send no
 * Accept preference, so the same URL may serve Markdown to Claude Code and HTML
 * to this audit unless the audit asks the same way.
 */
const AGENT_USER_AGENT = 'Claude-Code/1.0';

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

  const res = await ctx.fetch(ctx.url, { headers: { Accept: REALISTIC_ACCEPT } });

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
        'Agents like Claude Code and Cursor ask for it, and Markdown cuts token usage by roughly 80% against HTML. ' +
        'Cloudflare ("Markdown for Agents") and Vercel can enable this without code changes.',
      learnMoreUrl: guideUrl(meta.id, res.status === 406 ? 'http-406' : 'not-supported'),
    });

    await reportUserAgentNegotiation(ctx, findings);
    await reportMarkdownSuffix(ctx, findings);

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

  reportTokenSavings(ctx, res.headers, res.body, findings);
  reportFrontmatter(res.body, findings);
  reportCanonicalLink(res.headers, findings);

  return buildResult(meta, score, findings, start);
}

/* ── Extended reporting (informational) ─────────────────────────────────── */

/**
 * Report how much the Markdown representation actually saves.
 *
 * Cloudflare's implementation states the numbers directly, in
 * `x-markdown-tokens` and `x-original-tokens`, which is better evidence than a
 * byte ratio: bytes and tokens diverge sharply on markup-heavy pages. When the
 * headers are absent, fall back to comparing sizes.
 */
function reportTokenSavings(
  ctx: CheckContext,
  headers: Record<string, string>,
  body: string,
  findings: Finding[],
): void {
  const markdownTokens = Number(headers['x-markdown-tokens']);
  const originalTokens = Number(headers['x-original-tokens']);

  if (Number.isFinite(markdownTokens) && Number.isFinite(originalTokens) && originalTokens > 0) {
    const saved = Math.round((1 - markdownTokens / originalTokens) * 100);
    findings.push({
      status: saved > 0 ? 'pass' : 'warn',
      message: `Markdown costs ${markdownTokens} tokens against ${originalTokens} for the HTML (${saved}% saved)`,
      detail: 'Counts reported by the origin via x-markdown-tokens and x-original-tokens.',
    });
    return;
  }

  if (ctx.html.length === 0 || body.length === 0) return;

  const reduction = Math.round((1 - body.length / ctx.html.length) * 100);
  if (reduction > 0) {
    findings.push({
      status: 'pass',
      message: `Markdown is ~${reduction}% lighter than the HTML representation (${body.length} vs ${ctx.html.length} bytes)`,
    });
  } else {
    findings.push({
      status: 'warn',
      message: `Markdown response is not smaller than the HTML representation (${body.length} vs ${ctx.html.length} bytes)`,
      hint: 'Strip navigation, boilerplate, and markup remnants from the Markdown output — its purpose is token efficiency.',
      learnMoreUrl: guideUrl(meta.id, 'not-smaller'),
    });
  }
}

/**
 * Frontmatter carries what the HTML expressed through tags an agent no longer
 * sees: the canonical URL, the title, when the page last changed. Without it a
 * Markdown response is content with no provenance, and an agent quoting it
 * cannot say where it came from.
 */
function reportFrontmatter(body: string, findings: Finding[]): void {
  const { frontmatter, present } = parseFrontmatter(body);

  if (!present) {
    findings.push({
      status: 'warn',
      message: 'Markdown response has no frontmatter',
      hint:
        'Add a YAML block with at least title and canonical_url, plus last_updated where you have it. Stripping the ' +
        'HTML also strips the canonical link and the metadata tags, so without frontmatter an agent cannot attribute ' +
        'what it quotes.',
      learnMoreUrl: guideUrl(meta.id, 'no-frontmatter'),
    });
    return;
  }

  const useful = ['title', 'canonical_url', 'url', 'last_updated', 'description'].filter(
    (k) => frontmatter[k] !== undefined && frontmatter[k] !== '',
  );
  findings.push({
    status: useful.length > 0 ? 'pass' : 'warn',
    message:
      useful.length > 0
        ? `Markdown frontmatter carries ${useful.join(', ')}`
        : 'Markdown frontmatter is present but carries no title, canonical URL or date',
    ...(useful.length === 0
      ? {
          hint: 'Include title and canonical_url so a quotation can be attributed back to the page.',
          learnMoreUrl: guideUrl(meta.id, 'empty-frontmatter'),
        }
      : {}),
  });
}

/** A `Link: rel="canonical"` header attributes the Markdown even without frontmatter. */
function reportCanonicalLink(headers: Record<string, string>, findings: Finding[]): void {
  const link = headers['link'] ?? '';
  if (/rel\s*=\s*"?canonical"?/i.test(link)) {
    findings.push({ status: 'pass', message: 'Markdown response carries a canonical Link header' });
  }
}

/**
 * Some origins negotiate on the user agent rather than on Accept, serving
 * Markdown to a recognised agent that expressed no preference. Worth probing
 * before concluding the site has no Markdown at all.
 */
async function reportUserAgentNegotiation(ctx: CheckContext, findings: Finding[]): Promise<void> {
  const res = await ctx.fetch(ctx.url, { headers: { 'User-Agent': AGENT_USER_AGENT } });
  if (!res.ok) return;
  if (!(res.headers['content-type'] ?? '').toLowerCase().includes(MARKDOWN_ACCEPT)) return;

  findings.push({
    status: 'pass',
    message: 'Markdown is served to a recognised agent user agent, without an Accept preference',
    detail: `Probed with User-Agent: ${AGENT_USER_AGENT}.`,
    hint:
      'This works for agents you recognise today. Negotiating on Accept as well covers every client that asks ' +
      'properly, including ones whose user agent you have never seen.',
  });
}

/** The `.md` suffix convention: a durable URL for the Markdown version. */
async function reportMarkdownSuffix(ctx: CheckContext, findings: Finding[]): Promise<void> {
  for (const path of ['/index.md', '/index.html.md']) {
    const res = await ctx.fetch(`${ctx.url}${path}`);
    if (!res.ok || res.body.trim().length === 0 || looksLikeHtmlDocument(res.body)) continue;
    findings.push({
      status: 'pass',
      message: `Markdown available at the suffix URL ${path}`,
      detail:
        'A durable URL an agent can construct, though it still costs a second request against negotiating in place.',
    });
    return;
  }
}
