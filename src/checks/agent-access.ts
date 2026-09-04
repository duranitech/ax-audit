import { PROBEABLE_CORE_CRAWLERS, crawlerInfo } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { extractVisibleText } from './html-utils.js';
import { parseUserAgents, intentBlocked } from './robots-parser.js';
import { classifyResponse, INCONCLUSIVE_CAVEAT, type ResponseClass } from './waf.js';

/**
 * "agent-access" — the gap between what robots.txt permits and what the server
 * actually does.
 *
 * The failure this catches is invisible from the inside: robots.txt says
 * `Allow: /` for GPTBot, and the WAF returns 403 to anything whose user agent
 * says GPTBot. The operator sees a permissive robots.txt and assumes the site
 * is reachable. Cloudflare's "Block AI Crawlers" toggle produces exactly this,
 * and so does a hand-written rule that outlived its reason.
 *
 * The check probes the homepage once per core crawler and compares the result
 * against the default-user-agent baseline. Since 3.7 it classifies *how* a
 * request was turned away, because the remedies are completely different: a
 * JavaScript challenge needs a bot-management exception, a hard 403 needs a
 * firewall rule change, a 402 is a deliberate price, and a signature demand is
 * the site working as designed.
 *
 * Honesty constraint: this probe is unsigned and comes from the auditor's own
 * network. An edge that verifies crawlers by IP range or Web Bot Auth signature
 * will reject it while admitting the genuine crawler. Those outcomes are scored
 * as inconclusive and labelled as such, never as "blocks AI crawlers".
 */
export const meta: CheckMeta = {
  id: 'agent-access',
  name: 'Agent Access',
  description: 'Checks that AI crawler user-agents are not blocked or served reduced content (cloaking)',
  weight: 0, // Informational in 3.x — will gain weight in v4.0 (score-affecting changes are treated as breaking).
  category: 'access',
};

/** Content below this fraction of the baseline visible text counts as "reduced". */
const REDUCED_CONTENT_RATIO = 0.5;
/** Baselines with less visible text than this are too small for meaningful content comparison. */
const MIN_BASELINE_TEXT = 200;

type Outcome =
  /** Same response as the default user agent. */
  | 'ok'
  /** 200, but materially less content than the baseline. */
  | 'reduced'
  /** Turned away, matching an explicit robots.txt Disallow. */
  | 'blocked-consistent'
  /** Turned away while robots.txt permits access. */
  | 'blocked'
  /** Turned away by a mechanism an unsigned probe cannot distinguish from correct behaviour. */
  | 'inconclusive'
  /** Reachable, but the content is priced or licensed rather than free. */
  | 'conditional';

/** Credit each outcome contributes to the access score. */
const OUTCOME_CREDIT: Record<Outcome, number> = {
  ok: 1,
  'blocked-consistent': 1,
  conditional: 1,
  inconclusive: 0.75,
  reduced: 0.5,
  blocked: 0,
};

/**
 * Build a realistic crawler User-Agent for a given bot token. WAF and
 * bot-management rules match on the token substring, which is what we need
 * to trigger the same code path the real crawler would hit.
 */
export function crawlerUserAgent(token: string): string {
  return `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${token}/1.0)`;
}

// `intentBlocked` moved to robots-parser.ts in 3.7; re-exported for compatibility.
export { intentBlocked } from './robots-parser.js';

/** A compact fingerprint of what a page actually says, for parity comparison. */
interface PageShape {
  textLength: number;
  title: string | null;
  h1: string | null;
  jsonLdBlocks: number;
}

function shapeOf(html: string): PageShape {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return {
    textLength: extractVisibleText(html).length,
    title: title ? extractVisibleText(title[1]) : null,
    h1: h1 ? extractVisibleText(h1[1]) : null,
    jsonLdBlocks: (html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/gi) ?? []).length,
  };
}

/** Differences between a crawler's page and the baseline, in reader-facing terms. */
function shapeDiff(baseline: PageShape, actual: PageShape): string[] {
  const diffs: string[] = [];
  if (baseline.title !== null && actual.title !== baseline.title) {
    diffs.push(`title differs ("${actual.title ?? 'none'}" vs "${baseline.title}")`);
  }
  if (baseline.h1 !== null && actual.h1 !== baseline.h1) {
    diffs.push(`h1 differs ("${actual.h1 ?? 'none'}" vs "${baseline.h1}")`);
  }
  if (baseline.jsonLdBlocks > 0 && actual.jsonLdBlocks < baseline.jsonLdBlocks) {
    diffs.push(`${baseline.jsonLdBlocks - actual.jsonLdBlocks} JSON-LD block(s) missing`);
  }
  return diffs;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];

  const baseline = await ctx.fetch(ctx.url);
  if (!baseline.ok) {
    findings.push({
      status: 'fail',
      message: 'Baseline homepage request failed — cannot compare crawler access',
      detail: `HTTP ${baseline.status || 'network error'}`,
      learnMoreUrl: guideUrl(meta.id, 'baseline-unavailable'),
    });
    return buildResult(meta, 0, findings, start);
  }
  const baselineShape = shapeOf(baseline.body);
  const baselineText = baselineShape.textLength;

  const robotsRes = await ctx.fetch(`${ctx.url}/robots.txt`);
  const robotsEntries = robotsRes.ok ? parseUserAgents(robotsRes.body) : [];

  const outcomes = new Map<string, Outcome>();

  for (const crawler of PROBEABLE_CORE_CRAWLERS) {
    const res = await ctx.fetch(ctx.url, { headers: { 'User-Agent': crawlerUserAgent(crawler) } });
    const cls = classifyResponse(res);
    const blockedByRobots = intentBlocked(robotsEntries, crawler);

    if (cls.kind === 'ok') {
      const shape = shapeOf(res.body);
      const diffs = shapeDiff(baselineShape, shape);
      const textDropped = baselineText >= MIN_BASELINE_TEXT && shape.textLength < baselineText * REDUCED_CONTENT_RATIO;

      if (textDropped || diffs.length > 0) {
        outcomes.set(crawler, 'reduced');
        findings.push({
          status: 'warn',
          message: `${crawler} receives a different page than a regular client`,
          detail: [textDropped ? `${shape.textLength} vs ${baselineText} chars of visible text` : null, ...diffs]
            .filter(Boolean)
            .join('; '),
          hint:
            'The server returns 200 but serves this crawler different content — often an interstitial, a consent ' +
            'wall, or conditional rendering. Agents index exactly what they receive, so the version they see is the ' +
            'version that gets cited.',
          learnMoreUrl: guideUrl(meta.id, 'reduced-content'),
        });
      } else {
        outcomes.set(crawler, 'ok');
      }
      continue;
    }

    outcomes.set(crawler, recordTurnedAway(crawler, cls, blockedByRobots, robotsRes.ok, findings));
  }

  const okCount = [...outcomes.values()].filter((o) => o === 'ok').length;
  if (okCount === PROBEABLE_CORE_CRAWLERS.length) {
    findings.unshift({
      status: 'pass',
      message: `All ${PROBEABLE_CORE_CRAWLERS.length} core AI crawler user-agents receive the same page as a regular client`,
    });
  }

  const inconclusive = [...outcomes.entries()].filter(([, o]) => o === 'inconclusive');
  if (inconclusive.length > 0) {
    findings.push({
      status: 'warn',
      message: `${inconclusive.length} crawler probe(s) could not be settled from outside`,
      detail: inconclusive.map(([name]) => name).join(', '),
      hint: INCONCLUSIVE_CAVEAT,
      learnMoreUrl: guideUrl(meta.id, 'inconclusive-probe'),
    });
  }

  const credit = [...outcomes.values()].reduce((acc, o) => acc + OUTCOME_CREDIT[o], 0);
  const score = Math.round((credit / PROBEABLE_CORE_CRAWLERS.length) * 100);

  return buildResult(meta, score, findings, start);
}

/**
 * Turn a non-200 crawler response into a finding and an outcome. The
 * classification decides both the wording and the credit: a challenge is not a
 * block, a price is not a refusal, and a signature demand is a site working as
 * designed.
 */
function recordTurnedAway(
  crawler: string,
  cls: ResponseClass,
  blockedByRobots: boolean,
  robotsAvailable: boolean,
  findings: Finding[],
): Outcome {
  const info = crawlerInfo(crawler);
  const evidence = cls.evidence.length > 0 ? cls.evidence.join('; ') : cls.label;

  switch (cls.kind) {
    case 'challenge':
      findings.push({
        status: 'warn',
        message: `${crawler} receives a ${cls.vendor ?? 'JavaScript'} challenge instead of the page`,
        detail: evidence,
        hint:
          'Challenge pages require running JavaScript. Crawlers that only fetch HTML — which is most of them — never ' +
          'get past one, so the page is effectively unavailable to them even though nothing is "blocked". ' +
          'Add a bot-management exception for verified AI crawlers. ' +
          INCONCLUSIVE_CAVEAT,
        learnMoreUrl: guideUrl(meta.id, 'challenge-page'),
      });
      return 'inconclusive';

    case 'needs-signature':
      findings.push({
        status: 'pass',
        message: `${crawler} must present a Web Bot Auth signature`,
        detail: evidence,
        hint:
          'The origin asks unverified clients to re-request with an HTTP Message Signature. Vendors that sign their ' +
          'requests will pass; this probe does not sign, so it cannot confirm the outcome for the real crawler.',
        learnMoreUrl: guideUrl(meta.id, 'needs-signature'),
      });
      return 'inconclusive';

    case 'paywall':
      findings.push({
        status: 'pass',
        message: `${crawler} is offered priced access${cls.price ? ` at ${cls.price}` : ''}`,
        detail: evidence,
        hint: 'Content is monetised for crawlers rather than blocked. Crawlers that support the payment flow can still reach it.',
        learnMoreUrl: guideUrl(meta.id, 'pay-per-crawl'),
      });
      return 'conditional';

    case 'license-required':
      findings.push({
        status: 'pass',
        message: `${crawler} is asked to obtain a licence before use`,
        detail: evidence,
        hint: 'The origin implements the RSL Open Licensing Protocol. Clients that negotiate a licence can reach the content.',
        learnMoreUrl: guideUrl(meta.id, 'license-required'),
      });
      return 'conditional';

    case 'rate-limited':
      findings.push({
        status: 'warn',
        message: `${crawler} is rate limited on a single request`,
        detail: evidence,
        hint:
          'One probe should not hit a rate limit. A limit this tight will stall any crawl. Always answer 429 with a ' +
          'Retry-After header so well-behaved crawlers back off correctly instead of giving up.',
        learnMoreUrl: guideUrl(meta.id, 'rate-limited'),
      });
      return 'inconclusive';

    case 'server-error':
    case 'network-error':
      findings.push({
        status: 'warn',
        message: `${crawler} probe failed: ${cls.label}`,
        detail: evidence,
        hint: 'The request did not complete, so access for this crawler is unknown. Re-run the audit; if it persists, check origin health for this user agent.',
        learnMoreUrl: guideUrl(meta.id, 'probe-failed'),
      });
      return 'inconclusive';

    default: {
      // A plain refusal. Whether it is a finding depends on robots.txt intent.
      if (blockedByRobots) {
        findings.push({
          status: 'pass',
          message: `${crawler} blocked at the server — consistent with its robots.txt Disallow`,
          detail: evidence,
        });
        return 'blocked-consistent';
      }

      if (cls.inconclusive) {
        findings.push({
          status: 'warn',
          message: `${crawler} is refused by ${cls.vendor ?? 'the origin'} while robots.txt permits it`,
          detail: evidence,
          hint:
            (info ? `${info.impact} ` : '') +
            'This edge verifies crawlers by IP range or signature, so the refusal may be correct anti-spoofing rather ' +
            'than a policy block. ' +
            INCONCLUSIVE_CAVEAT,
          learnMoreUrl: guideUrl(meta.id, 'blocked-crawler'),
        });
        return 'inconclusive';
      }

      findings.push({
        status: 'warn',
        message: `${crawler} is ${robotsAvailable ? 'allowed in robots.txt' : 'not restricted'} but its User-Agent is refused`,
        detail: evidence,
        hint:
          (info ? `${info.impact} ` : '') +
          'Your firewall rejects this crawler token even though robots.txt permits it — the block is invisible to you ' +
          'but fatal for the agent. Check your firewall rules and AI-bot toggles (for example Cloudflare "Block AI Crawlers").',
        learnMoreUrl: guideUrl(meta.id, 'blocked-crawler'),
      });
      return 'blocked';
    }
  }
}
