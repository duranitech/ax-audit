import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { getMetaContent } from './html-utils.js';

/**
 * "ai-directives" — the page-level controls that actually govern whether your
 * content can appear in an AI answer.
 *
 * robots.txt decides whether a crawler may *fetch* a page. These directives
 * decide what may be *done* with it once fetched, and unlike most of the
 * machine-readable signals in this audit, the two largest vendors document that
 * they honor them:
 *
 * - Google: `nosnippet` "will also prevent the content from being used as a
 *   direct input for AI Overviews and AI Mode"; `max-snippet:[n]` limits how
 *   much may be used; `data-nosnippet` scopes the exclusion to part of a page.
 * - Microsoft: `noarchive` excludes a page from Copilot grounding entirely;
 *   `nocache` limits Copilot to the URL, title and snippet.
 *
 * The most common misconception this check corrects is about `Google-Extended`.
 * Operators disallow it expecting to leave AI Overviews. It does not do that:
 * it governs Gemini training and grounding in Gemini Apps and Vertex AI, while
 * AI Overviews and AI Mode follow Googlebot and the snippet directives. A site
 * that disallows `Google-Extended` and sets no snippet directive has opted out
 * of the thing it probably did not mind and stayed in the thing it did.
 *
 * `noai` and `noimageai` are reported as declared preferences. No major AI
 * operator has committed to honoring them, and saying otherwise would be
 * misleading.
 */
export const meta: CheckMeta = {
  id: 'ai-directives',
  name: 'AI Directives',
  description: 'Checks page-level robots directives that govern AI answers and summaries',
  weight: 0, // Informational in 3.x — gains weight in 4.0.
  category: 'access',
};

/** Directive tokens parsed out of a robots meta tag or `X-Robots-Tag` header. */
export interface ParsedDirectives {
  /** Bare tokens, lowercased. */
  tokens: Set<string>;
  /** `max-snippet` value, or `null` when absent. `-1` means unlimited. */
  maxSnippet: number | null;
  /** Which sources declared directives, for the report. */
  sources: string[];
}

/**
 * Parse robots directives from meta tags and `X-Robots-Tag`.
 *
 * `X-Robots-Tag` may name a user agent before its directives
 * (`X-Robots-Tag: googlebot: noindex`) and may repeat, which HTTP folds into
 * one comma-separated value. Both forms are handled; a UA-scoped rule counts
 * because the audit reports the strictest thing any major crawler is told.
 */
export function parseDirectives(html: string, headers: Record<string, string>): ParsedDirectives {
  const tokens = new Set<string>();
  const sources: string[] = [];
  let maxSnippet: number | null = null;

  const consume = (value: string, source: string): void => {
    let sawAny = false;
    for (const raw of value.split(',')) {
      // Strip a leading `<user-agent>:` scope if present.
      const segment =
        raw.includes(':') && !/^\s*max-(snippet|image-preview|video-preview)\s*:/i.test(raw)
          ? raw.slice(raw.indexOf(':') + 1)
          : raw;
      const token = segment.trim().toLowerCase();
      if (!token) continue;

      const snippet = token.match(/^max-snippet\s*:\s*(-?\d+)$/);
      if (snippet) {
        // `-1` means "no limit", so it must never win a minimum against a real
        // cap. Normalise it to Infinity while comparing and restore it after.
        const n = Number(snippet[1]) === -1 ? Infinity : Number(snippet[1]);
        maxSnippet = maxSnippet === null ? n : Math.min(maxSnippet, n);
        tokens.add('max-snippet');
        sawAny = true;
        continue;
      }

      tokens.add(token);
      sawAny = true;
    }
    if (sawAny) sources.push(source);
  };

  for (const name of ['robots', 'googlebot', 'bingbot', 'google', 'msnbot']) {
    const content = getMetaContent(html, name);
    if (content !== null) consume(content, `<meta name="${name}">`);
  }

  if (headers['x-robots-tag'] !== undefined) consume(headers['x-robots-tag'], 'X-Robots-Tag header');

  return { tokens, maxSnippet: maxSnippet === Infinity ? -1 : maxSnippet, sources };
}

/**
 * Count `data-nosnippet` regions and judge whether they cover the page's
 * substance. Scoping a cookie banner is housekeeping; wrapping `<main>` removes
 * the page from AI answers.
 */
export function analyseDataNosnippet(html: string): { count: number; coversMain: boolean } {
  const matches = [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bdata-nosnippet\b[^>]*)>/gi)];
  const coversMain = matches.some((m) => /^(main|article|body)$/i.test(m[1]));
  return { count: matches.length, coversMain };
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  if (!ctx.html || ctx.html.trim().length === 0) {
    findings.push({
      status: 'fail',
      message: 'Homepage HTML unavailable — cannot read AI directives',
      learnMoreUrl: guideUrl(meta.id, 'no-html'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const { tokens, maxSnippet, sources } = parseDirectives(ctx.html, ctx.headers ?? {});
  const has = (t: string): boolean => tokens.has(t);

  /* ── Indexability: the precondition for everything else ─────────────── */

  if (has('noindex') || has('none')) {
    findings.push({
      status: 'fail',
      message: 'Homepage is marked noindex',
      detail: sources.join(', '),
      hint:
        'A noindex page is invisible to every search-grounded assistant, because they all cite from a search index. ' +
        'If this is deliberate, nothing else in this check matters. If it is not, remove the directive.',
      learnMoreUrl: guideUrl(meta.id, 'noindex'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({ status: 'pass', message: 'Homepage is indexable' });

  /* ── Snippet controls: Google AI Overviews and AI Mode ───────────────── */

  if (has('nosnippet')) {
    findings.push({
      status: 'warn',
      message: 'nosnippet excludes this page from Google AI Overviews and AI Mode',
      detail: sources.join(', '),
      hint:
        'Google documents that nosnippet prevents content being used as a direct input for AI Overviews and AI Mode, ' +
        'as well as suppressing the search snippet. Remove it if you want to be quoted; keep it if you do not.',
      learnMoreUrl: guideUrl(meta.id, 'nosnippet'),
    });
    score -= 30;
  } else if (maxSnippet !== null && maxSnippet !== -1) {
    if (maxSnippet === 0) {
      findings.push({
        status: 'warn',
        message: 'max-snippet:0 has the same effect as nosnippet',
        detail: sources.join(', '),
        hint: 'A zero-character snippet limit excludes the page from AI Overviews and AI Mode as an input.',
        learnMoreUrl: guideUrl(meta.id, 'nosnippet'),
      });
      score -= 30;
    } else {
      findings.push({
        status: maxSnippet < 160 ? 'warn' : 'pass',
        message: `max-snippet:${maxSnippet} limits how much of this page an AI answer may use`,
        detail: sources.join(', '),
        ...(maxSnippet < 160
          ? {
              hint: 'Below roughly 160 characters there is little room for a useful quotation. Use max-snippet:-1 for no limit.',
              learnMoreUrl: guideUrl(meta.id, 'max-snippet'),
            }
          : {}),
      });
    }
  } else if (maxSnippet === -1) {
    findings.push({ status: 'pass', message: 'max-snippet:-1 — no limit on snippet length' });
  }

  /* ── Copilot controls ────────────────────────────────────────────────── */

  if (has('noarchive')) {
    findings.push({
      status: 'warn',
      message: 'noarchive excludes this page from Microsoft Copilot grounding',
      detail: sources.join(', '),
      hint:
        'Microsoft documents that noarchive means a page is not included in Copilot answers and not linked from them. ' +
        'nocache is the lighter option: Copilot may use the URL, title and snippet but not the body.',
      learnMoreUrl: guideUrl(meta.id, 'noarchive'),
    });
    score -= 30;
  } else if (has('nocache')) {
    findings.push({
      status: 'warn',
      message: 'nocache limits Copilot to the URL, title and snippet of this page',
      detail: sources.join(', '),
      hint: 'Copilot may cite the page but not use its body. Remove nocache to allow full grounding.',
      learnMoreUrl: guideUrl(meta.id, 'nocache'),
    });
    score -= 10;
  }

  /* ── Scoped exclusions ───────────────────────────────────────────────── */

  const dataNosnippet = analyseDataNosnippet(ctx.html);
  if (dataNosnippet.coversMain) {
    findings.push({
      status: 'warn',
      message: 'data-nosnippet wraps the page’s main content',
      detail: `${dataNosnippet.count} data-nosnippet region(s) found`,
      hint: 'Scoping a cookie banner or a byline is housekeeping. Wrapping <main>, <article> or <body> removes the page from AI answers as surely as nosnippet does.',
      learnMoreUrl: guideUrl(meta.id, 'data-nosnippet-main'),
    });
    score -= 20;
  } else if (dataNosnippet.count > 0) {
    findings.push({
      status: 'pass',
      message: `${dataNosnippet.count} data-nosnippet region(s) — scoped exclusions, main content still quotable`,
    });
  }

  if (has('noimageindex')) {
    findings.push({
      status: 'warn',
      message: 'noimageindex keeps this page’s images out of image results and multimodal answers',
      detail: sources.join(', '),
      hint: 'Remove it if you want images cited alongside your text.',
      learnMoreUrl: guideUrl(meta.id, 'noimageindex'),
    });
    score -= 5;
  }

  /* ── Declared preferences with no committed honorer ──────────────────── */

  const declared = ['noai', 'noimageai'].filter(has);
  if (declared.length > 0) {
    findings.push({
      status: 'pass',
      message: `${declared.join(' and ')} declared`,
      detail:
        'A stated preference against AI use. No major AI operator documents honoring these tokens, so treat them as a ' +
        'legal or ethical signal rather than an enforcement mechanism.',
    });
  }

  if (has('notranslate')) {
    findings.push({
      status: 'pass',
      message: 'notranslate declared — assistants should not offer a translated version',
    });
  }

  /* ── The Google-Extended misconception ───────────────────────────────── */

  await reportGoogleExtendedMismatch(ctx, tokens, findings);

  if (findings.every((f) => f.status === 'pass')) {
    findings.push({
      status: 'pass',
      message: 'No directive restricts how AI assistants may use this page',
    });
  }

  return buildResult(meta, score, findings, start);
}

/**
 * Flag the most common mistaken belief about AI opt-outs: that disallowing
 * `Google-Extended` removes a site from AI Overviews. It does not, and a site
 * that made that assumption is opted out of Gemini training while remaining
 * fully quotable in the surface it was trying to leave.
 */
async function reportGoogleExtendedMismatch(
  ctx: CheckContext,
  tokens: Set<string>,
  findings: Finding[],
): Promise<void> {
  const robots = await ctx.fetch(`${ctx.url}/robots.txt`);
  if (!robots.ok) return;

  const { parseRobotsTxt, toBotEntries, intentBlocked } = await import('./robots-parser.js');
  const blocked = intentBlocked(toBotEntries(parseRobotsTxt(robots.body)), 'Google-Extended');
  if (!blocked) return;

  const restricted = tokens.has('nosnippet') || tokens.has('noindex');
  if (restricted) return;

  findings.push({
    status: 'warn',
    message: 'Google-Extended is disallowed, but this page is still eligible for AI Overviews',
    detail: 'robots.txt disallows Google-Extended; no nosnippet or max-snippet directive is set on the page.',
    hint:
      'Google-Extended governs Gemini training and grounding in Gemini Apps and Vertex AI. AI Overviews and AI Mode ' +
      'follow Googlebot and the snippet directives instead. If the intent was to stay out of AI Overviews, use ' +
      'nosnippet or max-snippet. If the intent was to opt out of training, this is already correct.',
    learnMoreUrl: guideUrl(meta.id, 'google-extended-mismatch'),
  });
}
