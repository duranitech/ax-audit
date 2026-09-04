import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult, checkContentType } from './utils.js';
import { findLinkTags } from './html-utils.js';
import { parseLinkHeader } from './http-headers.js';

/**
 * "llms-txt" — the curated index a site publishes for language models.
 *
 * Two things are worth being honest about in the report. Google has stated
 * plainly that Search ignores llms.txt, and adoption studies find the large
 * majority of published files are never fetched by any AI search crawler. The
 * consumers that *do* read it are coding agents — Claude Code, Cursor,
 * OpenCode — which makes it a developer-tooling signal rather than a search
 * visibility one. A report that implies otherwise is selling something.
 *
 * The specification was revised in 2026 ("v2"), adding three things this check
 * now looks for: files scoped to a subpath, a `describedby` link relation
 * pointing a page at the file that covers it, and per-page Markdown mirrors
 * reached by appending `.md`.
 */
export const meta: CheckMeta = {
  id: 'llms-txt',
  name: 'LLMs.txt',
  description: 'Checks /llms.txt presence, spec compliance, and link health',
  weight: 11,
  category: 'discovery',
};

/** How many links to sample for liveness. Enough to catch rot without a crawl. */
const LINK_SAMPLE_SIZE = 15;
/** A file larger than this is unlikely to fit an agent's context budget usefully. */
const LARGE_FILE_BYTES = 50_000;

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const res = await ctx.fetch(`${ctx.url}/llms.txt`);

  if (!res.ok) {
    findings.push({
      status: 'fail',
      message: '/llms.txt not found',
      detail: `HTTP ${res.status || 'network error'}`,
      hint: 'Create a /llms.txt file at your site root following the llmstxt.org specification. It should be a Markdown file starting with "# Your Site Name" and include a description, sections, and links.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({ status: 'pass', message: '/llms.txt exists' });

  const ctFinding = checkContentType(res, ['text/plain', 'text/markdown'], {
    checkId: meta.id,
    resourceLabel: '/llms.txt',
    anchor: 'wrong-content-type',
  });
  if (ctFinding) {
    findings.push(ctFinding);
    score -= 5;
  } else {
    findings.push({
      status: 'pass',
      message: `/llms.txt Content-Type OK (${res.headers['content-type']?.split(';')[0]})`,
    });
  }

  const text = res.body;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines[0]?.startsWith('# ')) {
    findings.push({
      status: 'warn',
      message: 'Missing H1 heading (first line should start with "# ")',
      hint: 'Add an H1 heading as the first line of your llms.txt file, e.g.: # Your Site Name',
      learnMoreUrl: guideUrl(meta.id, 'missing-h1'),
    });
    score -= 15;
  } else {
    findings.push({ status: 'pass', message: `H1 heading: "${lines[0].slice(2)}"` });
  }

  const hasBlockquote = lines.some((l) => l.startsWith('> '));
  if (!hasBlockquote) {
    findings.push({
      status: 'warn',
      message: 'No blockquote description found ("> ...")',
      hint: 'Add a blockquote description after the H1 heading, e.g.: > A brief summary of your site for AI agents.',
      learnMoreUrl: guideUrl(meta.id, 'missing-blockquote'),
    });
    score -= 10;
  } else {
    findings.push({ status: 'pass', message: 'Blockquote description present' });
  }

  const sections = lines.filter((l) => l.startsWith('## '));
  if (sections.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No section headings found (## ...)',
      hint: 'Organize your llms.txt content with ## section headings (e.g., ## About, ## API, ## Documentation).',
      learnMoreUrl: guideUrl(meta.id, 'missing-sections'),
    });
    score -= 10;
  } else {
    findings.push({ status: 'pass', message: `${sections.length} section heading(s) found` });
  }

  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const links = [...text.matchAll(linkPattern)];
  if (links.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No Markdown links found',
      hint: 'Add Markdown links to relevant pages: [Page Title](https://example.com/page). This helps AI agents navigate your site.',
      learnMoreUrl: guideUrl(meta.id, 'no-links'),
    });
    score -= 10;
  } else {
    findings.push({ status: 'pass', message: `${links.length} link(s) found` });
  }

  if (text.length < 100) {
    findings.push({
      status: 'warn',
      message: 'Content appears minimal (< 100 characters)',
      hint: 'Expand your llms.txt with more descriptive content about your site, its purpose, and available resources.',
      learnMoreUrl: guideUrl(meta.id, 'minimal-content'),
    });
    score -= 10;
  }

  const fullRes = await ctx.fetch(`${ctx.url}/llms-full.txt`);
  if (fullRes.ok) {
    findings.push({ status: 'pass', message: '/llms-full.txt also available (bonus)' });
    score = Math.min(100, score + 10);
  } else {
    findings.push({
      status: 'warn',
      message: '/llms-full.txt not found (optional but recommended)',
      hint: 'Create a /llms-full.txt with expanded content — full documentation, API details, and comprehensive site information for AI agents.',
      learnMoreUrl: guideUrl(meta.id, 'missing-full'),
    });
  }

  // Everything below is informational in 3.x: new findings inside a weighted
  // check must not move the score.
  reportSize(text, findings);
  reportDescribedBy(ctx, findings);
  await reportLinkHealth(ctx, links, findings);
  await reportMarkdownMirror(ctx, findings);
  reportConsumers(findings);

  return buildResult(meta, score, findings, start);
}

/* ── llms.txt v2 additions and link health (informational in 3.x) ───────── */

/** A file too large to be read whole is a file an agent truncates. */
function reportSize(text: string, findings: Finding[]): void {
  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes <= LARGE_FILE_BYTES) return;
  findings.push({
    status: 'warn',
    message: `/llms.txt is ${Math.round(bytes / 1024)} KB`,
    hint:
      'An index this large competes with the content it points at for context budget. Keep llms.txt to a map of links ' +
      'and move the prose into llms-full.txt or the pages themselves.',
    learnMoreUrl: guideUrl(meta.id, 'large-file'),
  });
}

/**
 * llms.txt v2 added a `describedby` relation so a page can point at the file
 * covering it. Without it, an agent that landed deep in the site has to guess
 * that a root llms.txt exists.
 */
function reportDescribedBy(ctx: CheckContext, findings: Finding[]): void {
  const inHeader = parseLinkHeader(ctx.headers?.['link'] ?? '').some((entry) =>
    (entry.params['rel'] ?? '').split(/\s+/).includes('describedby'),
  );
  const inHtml = findLinkTags(ctx.html ?? '', 'describedby').length > 0;

  if (inHeader || inHtml) {
    findings.push({
      status: 'pass',
      message: `Pages point at their llms.txt via rel="describedby" (${inHeader ? 'Link header' : 'HTML link'})`,
    });
    return;
  }

  findings.push({
    status: 'warn',
    message: 'No rel="describedby" link to llms.txt',
    hint:
      'llms.txt v2 uses this relation so a page can name the file that covers it. Add ' +
      '<link rel="describedby" href="/llms.txt"> or the equivalent Link header, so an agent that landed on a deep ' +
      'page does not have to guess that an index exists.',
    learnMoreUrl: guideUrl(meta.id, 'no-describedby'),
  });
}

/**
 * Sample the links and report the dead ones. An index of broken links is the
 * failure mode this file is most prone to: it is written once and never
 * revalidated, while the site moves underneath it.
 */
async function reportLinkHealth(ctx: CheckContext, links: RegExpMatchArray[], findings: Finding[]): Promise<void> {
  const urls = [...new Set(links.map((m) => m[2]))];
  if (urls.length === 0) return;

  const duplicates = links.length - urls.length;
  if (duplicates > 0) {
    findings.push({
      status: 'warn',
      message: `${duplicates} duplicate link(s) in llms.txt`,
      hint: 'Each URL should appear once. Duplicates spend an agent’s budget re-reading what it already has.',
      learnMoreUrl: guideUrl(meta.id, 'duplicate-links'),
    });
  }

  const sample = urls.slice(0, LINK_SAMPLE_SIZE);
  const dead: string[] = [];
  const redirected: string[] = [];

  for (const url of sample) {
    const head = await ctx.fetch(url, { method: 'HEAD', redirect: 'manual' });
    // Some origins refuse HEAD; a GET settles it rather than reporting a live
    // page as dead.
    const res = head.status === 405 || head.status === 501 ? await ctx.fetch(url, { redirect: 'manual' }) : head;

    if (res.status >= 300 && res.status < 400) {
      redirected.push(`${url} → ${res.redirectLocation ?? '(no Location)'}`);
      continue;
    }
    if (!res.ok) dead.push(`${url} (HTTP ${res.status || 'network error'})`);
  }

  if (dead.length > 0) {
    findings.push({
      status: 'fail',
      message: `${dead.length}/${sample.length} sampled llms.txt link(s) are broken`,
      detail: dead.join('\n'),
      hint:
        'An index of dead links wastes exactly the budget it was meant to save, and an agent has no way to tell a ' +
        'moved page from a removed one. Revalidate llms.txt when you move pages.',
      learnMoreUrl: guideUrl(meta.id, 'broken-links'),
    });
  } else {
    findings.push({ status: 'pass', message: `${sample.length} sampled link(s) resolve` });
  }

  if (redirected.length > 0) {
    findings.push({
      status: 'warn',
      message: `${redirected.length} sampled link(s) redirect`,
      detail: redirected.join('\n'),
      hint: 'Point llms.txt at the final URL. Each redirect is a round trip the agent pays for on every visit.',
      learnMoreUrl: guideUrl(meta.id, 'redirecting-links'),
    });
  }
}

/**
 * llms.txt v2 documents per-page Markdown mirrors reached by appending `.md`.
 * They matter more than the index itself: an agent that found a page still has
 * to read it, and the HTML costs several times the tokens.
 */
async function reportMarkdownMirror(ctx: CheckContext, findings: Finding[]): Promise<void> {
  for (const path of ['/index.md', '/index.html.md']) {
    const res = await ctx.fetch(`${ctx.url}${path}`);
    if (!res.ok || res.body.trim().length === 0) continue;
    if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(res.body)) continue;
    findings.push({
      status: 'pass',
      message: `Per-page Markdown mirror available at ${path}`,
      detail: 'Agents that cannot negotiate on Accept can still read the cheap representation.',
    });
    return;
  }

  findings.push({
    status: 'warn',
    message: 'No per-page Markdown mirror found',
    detail: 'Tried /index.md and /index.html.md.',
    hint:
      'llms.txt v2 documents appending .md to a URL for its Markdown version. The index tells an agent which pages ' +
      'exist; the mirrors are what make reading them cheap.',
    learnMoreUrl: guideUrl(meta.id, 'no-markdown-mirror'),
  });
}

/** State plainly who reads this file, so nobody over-invests on the wrong premise. */
function reportConsumers(findings: Finding[]): void {
  findings.push({
    status: 'pass',
    message: 'Consumer note: llms.txt is read by coding agents, not by search',
    detail:
      'Google has stated that Search ignores llms.txt, and adoption studies find most published files are never ' +
      'fetched by an AI search crawler. Claude Code, Cursor and OpenCode do fetch it. Treat it as developer tooling, ' +
      'not as a search-visibility signal.',
  });
}
