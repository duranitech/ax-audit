import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { extractVisibleText, getTagAttribute } from './html-utils.js';
import { classifyResponse } from './waf.js';

/**
 * "http-hygiene" — does this site answer honestly at the protocol level?
 *
 * An agent has no eyes. It decides what happened from the status code, and it
 * has no way to notice that the 200 it just received is a "page not found"
 * screen. A human seeing that page moves on; an agent stores the apology as the
 * answer, or retries forever, or reports it to the user as content.
 *
 * The failures here are unglamorous and common:
 *
 * - **Soft 404s.** A missing page answering `200 OK`, or redirecting to the
 *   homepage. Every "not found" an agent cannot detect becomes a fabricated
 *   fact or a wasted retry.
 * - **Rate limits without `Retry-After`.** A `429` with no header tells a
 *   well-behaved crawler nothing about when to come back, so it either gives up
 *   or hammers. The header is how backoff is negotiated.
 * - **Long redirect chains.** Each hop is a round trip an agent pays for, and
 *   some clients cap their hops well below what browsers allow.
 * - **`HEAD` refused.** A cheap existence check turned into a full download.
 * - **Missing charset**, which turns non-ASCII text into replacement characters
 *   in whatever the agent quotes.
 */
export const meta: CheckMeta = {
  id: 'http-hygiene',
  name: 'HTTP Hygiene',
  description: 'Checks status-code honesty, redirect depth, rate-limit headers and content typing',
  category: 'access',
};

/** Redirect hops tolerated on the homepage before it costs an agent real time. */
const MAX_REDIRECT_HOPS = 1;

/** Phrases a soft-404 body uses. Matched only against short bodies, to avoid false hits on articles about 404s. */
const NOT_FOUND_PHRASES =
  /\b(404|page not found|not found|no longer exists|doesn'?t exist|does not exist|couldn'?t find|could not find)\b/i;

/** Body shorter than this is treated as an error page rather than content. */
const SHORT_BODY_CHARS = 600;

/** Build a path that cannot plausibly exist, so a 200 proves the site invents pages. */
function improbablePath(): string {
  return `/ax-audit-probe-${Math.random().toString(36).slice(2, 10)}`;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  score = await checkSoft404(ctx, findings, score);
  score = await checkRedirects(ctx, findings, score);
  score = await checkHeadSupport(ctx, findings, score);
  score = checkContentTyping(ctx, findings, score);

  return buildResult(meta, score, findings, start);
}

/**
 * Request a path that cannot exist and insist the server say so. A `200`, a
 * redirect to the homepage, or an error page dressed as content all break the
 * one signal an agent can rely on.
 */
async function checkSoft404(ctx: CheckContext, findings: Finding[], score: number): Promise<number> {
  const path = improbablePath();
  const res = await ctx.fetch(`${ctx.url}${path}`, { redirect: 'manual' });
  const cls = classifyResponse(res);

  if (cls.kind === 'challenge' || cls.kind === 'needs-signature') {
    findings.push({
      status: 'warn',
      message: 'Could not test 404 handling — the probe was challenged',
      detail: cls.evidence.join('; '),
      hint: 'Bot management answered a plain GET with an interstitial, so status-code honesty could not be verified from outside.',
      learnMoreUrl: guideUrl(meta.id, 'probe-challenged'),
    });
    return score;
  }

  if (res.status === 404 || res.status === 410) {
    findings.push({ status: 'pass', message: `Missing pages return ${res.status}` });
    return checkErrorBody(res.body, findings, score);
  }

  if (res.status >= 300 && res.status < 400) {
    const target = res.redirectLocation ?? '';
    const toRoot = target === '/' || target === ctx.url || target === `${ctx.url}/`;
    findings.push({
      status: 'warn',
      message: `A missing page redirects (${res.status}) instead of returning 404`,
      detail: `Location: ${target || '(none)'}`,
      hint: toRoot
        ? 'Redirecting every unknown URL to the homepage means an agent following a stale link believes it arrived. Return 404 or 410.'
        : 'A redirect on a nonexistent path hides the error. Return 404 or 410 so a client can tell the difference.',
      learnMoreUrl: guideUrl(meta.id, 'soft-404-redirect'),
    });
    return score - 20;
  }

  if (res.status === 200) {
    const text = extractVisibleText(res.body);
    const looksLikeError = text.length < SHORT_BODY_CHARS && NOT_FOUND_PHRASES.test(text);
    findings.push({
      status: 'fail',
      message: looksLikeError
        ? 'A "page not found" screen is served with HTTP 200'
        : 'A nonexistent path returns HTTP 200',
      detail: `${path} → 200 (${text.length} chars of visible text)`,
      hint:
        'An agent has no way to see that this page is an apology. It stores the text as the answer, or retries a URL ' +
        'that will never work. Return 404 for missing pages and 410 for removed ones.',
      learnMoreUrl: guideUrl(meta.id, 'soft-404'),
    });
    return score - 30;
  }

  if (res.status === 403 || res.status === 401) {
    findings.push({
      status: 'warn',
      message: `A nonexistent path returns ${res.status} rather than 404`,
      hint: 'Answering unknown paths with 403 is a defensible hardening choice, but it stops a client distinguishing "missing" from "forbidden".',
      learnMoreUrl: guideUrl(meta.id, 'not-found-403'),
    });
    return score - 5;
  }

  findings.push({
    status: 'warn',
    message: `A nonexistent path returns ${res.status || 'a network error'}`,
    hint: 'Missing pages should return 404 or 410.',
    learnMoreUrl: guideUrl(meta.id, 'soft-404'),
  });
  return score - 10;
}

/** A correct 404 can still ship an unhelpful body. */
function checkErrorBody(body: string, findings: Finding[], score: number): number {
  if (body.trim().length === 0) {
    findings.push({
      status: 'warn',
      message: '404 responses have an empty body',
      hint: 'Send a short explanation and a link back into the site. An agent that hits a dead link can then recover instead of stopping.',
      learnMoreUrl: guideUrl(meta.id, 'empty-error-body'),
    });
    return score - 5;
  }
  return score;
}

/** Count redirect hops from the audited URL to the page that finally answers. */
async function checkRedirects(ctx: CheckContext, findings: Finding[], score: number): Promise<number> {
  let url = ctx.url;
  const chain: string[] = [];

  for (let hop = 0; hop <= 5; hop++) {
    const res = await ctx.fetch(url, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400 || !res.redirectLocation) break;
    let next: string;
    try {
      next = new URL(res.redirectLocation, url).toString();
    } catch {
      break;
    }
    chain.push(`${res.status} → ${next}`);
    if (next === url) break;
    url = next;
  }

  if (chain.length === 0) {
    findings.push({ status: 'pass', message: 'Homepage answers without a redirect' });
    return score;
  }

  if (chain.length <= MAX_REDIRECT_HOPS) {
    findings.push({
      status: 'pass',
      message: `Homepage answers after ${chain.length} redirect`,
      detail: chain.join('\n'),
    });
    return score;
  }

  findings.push({
    status: 'warn',
    message: `Homepage takes ${chain.length} redirects to answer`,
    detail: chain.join('\n'),
    hint:
      'Every hop is a round trip the agent pays for, and some clients cap redirects well below a browser. ' +
      'Collapse the chain: point the first URL straight at the final one.',
    learnMoreUrl: guideUrl(meta.id, 'redirect-chain'),
  });
  return score - 10;
}

/** `HEAD` is how a client checks existence without paying for the body. */
async function checkHeadSupport(ctx: CheckContext, findings: Finding[], score: number): Promise<number> {
  const res = await ctx.fetch(ctx.url, { method: 'HEAD' });

  if (res.status === 405 || res.status === 501) {
    findings.push({
      status: 'warn',
      message: `HEAD requests are refused (${res.status})`,
      hint: 'HEAD lets a client confirm a URL exists, or check Last-Modified, without downloading the page. Refusing it turns every existence check into a full transfer.',
      learnMoreUrl: guideUrl(meta.id, 'head-refused'),
    });
    return score - 10;
  }

  if (res.ok) {
    findings.push({ status: 'pass', message: 'HEAD requests are supported' });
  }

  // A rate limit on the second request of an audit is a real finding: nothing
  // here resembles a crawl.
  if (res.status === 429) {
    const retryAfter = res.headers['retry-after'];
    findings.push({
      status: retryAfter === undefined ? 'fail' : 'warn',
      message:
        retryAfter === undefined
          ? 'Rate limited with no Retry-After header'
          : `Rate limited after two requests (Retry-After: ${retryAfter})`,
      hint:
        retryAfter === undefined
          ? 'A 429 without Retry-After tells a well-behaved crawler nothing about when to return, so it either gives up or keeps hammering. Always send the header.'
          : 'A limit this tight will stall any crawl. Consider a higher allowance for identified AI crawlers.',
      learnMoreUrl: guideUrl(meta.id, 'rate-limit'),
    });
    return score - (retryAfter === undefined ? 20 : 10);
  }

  return score;
}

/** Character encoding and language declarations, which decide what an agent quotes. */
function checkContentTyping(ctx: CheckContext, findings: Finding[], score: number): number {
  const headers = ctx.headers ?? {};
  const contentType = headers['content-type'] ?? '';

  if (contentType === '') {
    findings.push({
      status: 'warn',
      message: 'Homepage has no Content-Type header',
      hint: 'Send Content-Type: text/html; charset=utf-8 so a client does not have to guess the encoding.',
      learnMoreUrl: guideUrl(meta.id, 'no-content-type'),
    });
    return score - 10;
  }

  const hasCharset = /charset=/i.test(contentType);
  const hasMetaCharset = /<meta[^>]+charset\s*=/i.test(ctx.html ?? '');
  if (!hasCharset && !hasMetaCharset) {
    findings.push({
      status: 'warn',
      message: 'No character encoding declared in the header or the document',
      hint: 'Without a charset, non-ASCII text is decoded by guesswork and quoted back with replacement characters. Add charset=utf-8.',
      learnMoreUrl: guideUrl(meta.id, 'no-charset'),
    });
    score -= 10;
  } else if (!hasCharset) {
    findings.push({
      status: 'pass',
      message: 'Character encoding declared in the document (not in the Content-Type header)',
    });
  } else {
    findings.push({ status: 'pass', message: `Content-Type: ${contentType.split(';')[0]} with charset` });
  }

  // `Content-Language` and `<html lang>` should not contradict each other.
  const htmlLang = (getTagAttribute(ctx.html ?? '', 'html', 'lang') ?? '').toLowerCase();
  const contentLanguage = (headers['content-language'] ?? '').toLowerCase().split(',')[0].trim();
  if (htmlLang !== '' && contentLanguage !== '' && htmlLang.split('-')[0] !== contentLanguage.split('-')[0]) {
    findings.push({
      status: 'warn',
      message: `<html lang="${htmlLang}"> disagrees with Content-Language: ${contentLanguage}`,
      hint: 'Agents pick a language signal and translate or route on it. Make the two agree.',
      learnMoreUrl: guideUrl(meta.id, 'language-mismatch'),
    });
    score -= 5;
  }

  return score;
}
