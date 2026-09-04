import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { extractVisibleText, findLinkTags, getAttribute, getMetaContent, getTagAttribute } from './html-utils.js';
import { buildResult } from './utils.js';

/**
 * "seo-basics" — the head-tag fundamentals every AI agent and search crawler relies on
 * before anything else: `<title>`, `<meta description>`, `<link rel="canonical">`,
 * `<html lang>`, `viewport`, `charset`, and `hreflang` for multilingual sites.
 *
 * These are not "SEO tricks"; they are the unambiguous identity, language, and topic
 * signals an agent uses to summarize, rank, or cite a page. ax-audit treats this as
 * baseline hygiene rather than optimization.
 */
export const meta: CheckMeta = {
  id: 'seo-basics',
  name: 'SEO Basics',
  description: 'Checks <title>, meta description, canonical, lang, charset, viewport, hreflang',
};

const TITLE_MIN = 20;
const TITLE_MAX = 70;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const html = ctx.html;
  if (!html) {
    findings.push({
      status: 'fail',
      message: 'Could not fetch homepage HTML',
      hint: 'Verify the homepage returns a non-empty 200 response on the root URL.',
      learnMoreUrl: guideUrl(meta.id, 'no-html'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? extractVisibleText(titleMatch[1]) : '';
  if (!title) {
    findings.push({
      status: 'fail',
      message: '<title> is missing or empty',
      hint: 'Add a <title> in <head> describing the page in 20-70 characters. Agents quote it as the document name.',
      learnMoreUrl: guideUrl(meta.id, 'no-title'),
    });
    score -= 25;
  } else if (title.length < TITLE_MIN) {
    findings.push({
      status: 'warn',
      message: `<title> is too short (${title.length} chars): "${title}"`,
      hint: `Lengthen the title to ${TITLE_MIN}-${TITLE_MAX} characters with a clear topic indicator.`,
      learnMoreUrl: guideUrl(meta.id, 'short-title'),
    });
    score -= 10;
  } else if (title.length > TITLE_MAX) {
    findings.push({
      status: 'warn',
      message: `<title> is too long (${title.length} chars)`,
      detail: `"${title.slice(0, 80)}…"`,
      hint: `Shorten the title to ${TITLE_MIN}-${TITLE_MAX} characters. Many agents and search engines truncate beyond ~70.`,
      learnMoreUrl: guideUrl(meta.id, 'long-title'),
    });
    score -= 5;
  } else {
    findings.push({ status: 'pass', message: `<title> length ${title.length} chars: "${title}"` });
  }

  const description = getMetaContent(html, 'description');
  if (!description) {
    findings.push({
      status: 'fail',
      message: '<meta name="description"> is missing',
      hint: 'Add <meta name="description" content="..."> in <head> with a 70-160 character summary. Agents use this as the canonical short description.',
      learnMoreUrl: guideUrl(meta.id, 'no-description'),
    });
    score -= 20;
  } else if (description.length < DESCRIPTION_MIN) {
    findings.push({
      status: 'warn',
      message: `Meta description is short (${description.length} chars)`,
      hint: `Expand the description to ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters with the page's main value proposition.`,
      learnMoreUrl: guideUrl(meta.id, 'short-description'),
    });
    score -= 8;
  } else if (description.length > DESCRIPTION_MAX) {
    findings.push({
      status: 'warn',
      message: `Meta description is long (${description.length} chars)`,
      hint: `Trim to ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters; longer descriptions get truncated.`,
      learnMoreUrl: guideUrl(meta.id, 'long-description'),
    });
    score -= 5;
  } else {
    findings.push({ status: 'pass', message: `Meta description length ${description.length} chars` });
  }

  if (description && title && description.trim().toLowerCase() === title.trim().toLowerCase()) {
    findings.push({
      status: 'warn',
      message: 'Meta description duplicates the <title>',
      hint: 'Write a description that complements the title rather than repeating it. Agents lose context when both fields contain the same text.',
      learnMoreUrl: guideUrl(meta.id, 'duplicate-title-description'),
    });
    score -= 5;
  }

  const canonicalLinks = findLinkTags(html, 'canonical');
  if (canonicalLinks.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No <link rel="canonical"> found',
      hint: 'Add <link rel="canonical" href="https://your-site.com/page"> so agents have an unambiguous URL to cite even when crawled via a redirect or query-string variant.',
      learnMoreUrl: guideUrl(meta.id, 'no-canonical'),
    });
    score -= 10;
  } else if (canonicalLinks.length > 1) {
    findings.push({
      status: 'warn',
      message: `${canonicalLinks.length} <link rel="canonical"> tags (must be exactly 1)`,
      hint: 'Keep a single canonical link per page. Multiple canonical hints are ignored by agents and search engines.',
      learnMoreUrl: guideUrl(meta.id, 'multiple-canonical'),
    });
    score -= 5;
  } else {
    const href = getAttribute(canonicalLinks[0], 'href');
    if (!href) {
      findings.push({
        status: 'warn',
        message: '<link rel="canonical"> is missing href',
        hint: 'Add an absolute URL to the canonical link tag.',
        learnMoreUrl: guideUrl(meta.id, 'canonical-no-href'),
      });
      score -= 5;
    } else if (!/^https?:\/\//i.test(href)) {
      findings.push({
        status: 'warn',
        message: `Canonical href is not absolute: ${href}`,
        hint: 'Use an absolute URL (https://...) for the canonical href. Relative paths are ambiguous when fetched outside the original page context.',
        learnMoreUrl: guideUrl(meta.id, 'canonical-relative'),
      });
      score -= 5;
    } else {
      findings.push({ status: 'pass', message: `Canonical URL: ${href}` });
    }
  }

  const lang = getTagAttribute(html, 'html', 'lang');
  if (!lang) {
    findings.push({
      status: 'warn',
      message: '<html lang="..."> is missing',
      hint: 'Set the document language: <html lang="en">. Multilingual agents rely on this to pick the right summarization model and avoid mixed-language ranking.',
      learnMoreUrl: guideUrl(meta.id, 'no-lang'),
    });
    score -= 10;
  } else if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(lang)) {
    findings.push({
      status: 'warn',
      message: `<html lang> looks invalid: "${lang}"`,
      hint: 'Use a valid BCP 47 tag (e.g., en, en-US, es-419, zh-Hant).',
      learnMoreUrl: guideUrl(meta.id, 'invalid-lang'),
    });
    score -= 5;
  } else {
    findings.push({ status: 'pass', message: `<html lang="${lang}">` });
  }

  if (
    /<meta\s+charset\s*=\s*["']?utf-8["']?/i.test(html) ||
    /<meta\s+http-equiv\s*=\s*["']content-type["'][^>]*charset=utf-8/i.test(html)
  ) {
    findings.push({ status: 'pass', message: 'UTF-8 charset declared' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No UTF-8 charset declaration in HTML head',
      hint: 'Add <meta charset="utf-8"> as the first child of <head>. Without it, agents can mis-decode non-ASCII content.',
      learnMoreUrl: guideUrl(meta.id, 'no-charset'),
    });
    score -= 5;
  }

  const viewport = getMetaContent(html, 'viewport');
  if (viewport && /width\s*=/.test(viewport)) {
    findings.push({ status: 'pass', message: `Viewport meta present: "${viewport}"` });
  } else {
    findings.push({
      status: 'warn',
      message: 'Missing or incomplete viewport meta tag',
      hint: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">. Helps mobile agents render the page correctly.',
      learnMoreUrl: guideUrl(meta.id, 'no-viewport'),
    });
    score -= 5;
  }

  const hreflangs = findLinkTags(html, 'alternate').filter((tag) => /\bhreflang\s*=/.test(tag));
  if (hreflangs.length > 0) {
    const hasXDefault = hreflangs.some((tag) => /hreflang\s*=\s*["']x-default["']/.test(tag));
    if (hasXDefault) {
      findings.push({
        status: 'pass',
        message: `${hreflangs.length} hreflang alternate(s) including x-default`,
      });
    } else {
      findings.push({
        status: 'warn',
        message: `${hreflangs.length} hreflang alternate(s) but no x-default`,
        hint: 'Add <link rel="alternate" hreflang="x-default" href="..."> as a fallback for unmatched locales.',
        learnMoreUrl: guideUrl(meta.id, 'no-x-default'),
      });
      score -= 3;
    }
  }

  return buildResult(meta, score, findings, start);
}
