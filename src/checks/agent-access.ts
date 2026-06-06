import { CORE_AI_CRAWLERS } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { extractVisibleText } from './html-utils.js';
import { parseUserAgents, type BotEntry } from './robots-txt.js';

export const meta: CheckMeta = {
  id: 'agent-access',
  name: 'Agent Access',
  description: 'Checks that AI crawler user-agents are not blocked or served reduced content (cloaking)',
  weight: 0, // Informational in 3.x — will gain weight in v4.0 (score-affecting changes are treated as breaking).
};

/** Content below this fraction of the baseline visible text counts as "reduced". */
const REDUCED_CONTENT_RATIO = 0.5;
/** Baselines with less visible text than this are too small for meaningful content comparison. */
const MIN_BASELINE_TEXT = 200;

type Outcome = 'ok' | 'reduced' | 'blocked-consistent' | 'blocked';

/**
 * Build a realistic crawler User-Agent for a given bot token. WAF and
 * bot-management rules match on the token substring, which is what we need
 * to trigger the same code path the real crawler would hit.
 */
export function crawlerUserAgent(token: string): string {
  return `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${token}/1.0)`;
}

/**
 * Whether robots.txt expresses the intent to block this crawler: an explicit
 * full Disallow for it, or a full wildcard Disallow with no explicit entry.
 */
export function intentBlocked(entries: BotEntry[], crawler: string): boolean {
  const explicit = entries.find((e) => e.name.toLowerCase() === crawler.toLowerCase());
  if (explicit) return explicit.disallowed;
  const wildcard = entries.find((e) => e.name === '*');
  return wildcard?.disallowed ?? false;
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
  const baselineText = extractVisibleText(baseline.body).length;

  const robotsRes = await ctx.fetch(`${ctx.url}/robots.txt`);
  const robotsEntries = robotsRes.ok ? parseUserAgents(robotsRes.body) : [];

  const outcomes = new Map<string, Outcome>();

  for (const crawler of CORE_AI_CRAWLERS) {
    const res = await ctx.fetch(ctx.url, { headers: { 'User-Agent': crawlerUserAgent(crawler) } });
    const blockedByRobots = intentBlocked(robotsEntries, crawler);

    if (!res.ok) {
      outcomes.set(crawler, blockedByRobots ? 'blocked-consistent' : 'blocked');
      const detail = `HTTP ${res.status || 'network error'} for User-Agent containing "${crawler}"`;
      if (blockedByRobots) {
        findings.push({
          status: 'pass',
          message: `${crawler} blocked at the server — consistent with its robots.txt Disallow`,
          detail,
        });
      } else {
        findings.push({
          status: 'warn',
          message: `${crawler} is ${robotsRes.ok ? 'allowed in robots.txt' : 'not restricted'} but its User-Agent is blocked`,
          detail,
          hint:
            'Your WAF or bot management rejects this crawler token even though robots.txt permits it — the block is invisible to you but fatal for the agent. ' +
            'Check your firewall rules and AI-bot toggles (e.g., Cloudflare "Block AI Crawlers"). ' +
            'Note: if your WAF verifies bots cryptographically (Web Bot Auth / verified-bots lists), the real crawler may still pass while this unverified probe is rejected — verify against your WAF logs.',
          learnMoreUrl: guideUrl(meta.id, 'blocked-crawler'),
        });
      }
      continue;
    }

    const text = extractVisibleText(res.body).length;
    if (baselineText >= MIN_BASELINE_TEXT && text < baselineText * REDUCED_CONTENT_RATIO) {
      outcomes.set(crawler, 'reduced');
      findings.push({
        status: 'warn',
        message: `${crawler} receives reduced content (${text} vs ${baselineText} chars of visible text)`,
        hint:
          'The server returns 200 but serves this crawler substantially less content than a regular client — ' +
          'often an interstitial, a challenge page, or conditional rendering. Agents index what they receive.',
        learnMoreUrl: guideUrl(meta.id, 'reduced-content'),
      });
    } else {
      outcomes.set(crawler, 'ok');
    }
  }

  const okCount = [...outcomes.values()].filter((o) => o === 'ok').length;
  if (okCount === CORE_AI_CRAWLERS.length) {
    findings.unshift({
      status: 'pass',
      message: `All ${CORE_AI_CRAWLERS.length} core AI crawler user-agents receive equivalent responses`,
    });
  }

  const credit = [...outcomes.values()].reduce((acc, o) => {
    if (o === 'ok' || o === 'blocked-consistent') return acc + 1;
    if (o === 'reduced') return acc + 0.5;
    return acc;
  }, 0);
  const score = Math.round((credit / CORE_AI_CRAWLERS.length) * 100);

  return buildResult(meta, score, findings, start);
}
