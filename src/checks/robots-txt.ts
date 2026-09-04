import { ALL_AI_CRAWLERS, CONTENT_SIGNALS, CONTENT_SIGNAL_USE_VALUES, CORE_AI_CRAWLERS } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import {
  parseRobotsTxt,
  parseContentSignalValue,
  parseContentUsageValue,
  toBotEntries,
  type RobotsTxt,
} from './robots-parser.js';

export const meta: CheckMeta = {
  id: 'robots-txt',
  name: 'Robots.txt',
  description: 'Checks AI crawler configuration in robots.txt',
  weight: 11,
};

// Re-exported for checks and consumers that were written against the pre-3.7
// location of the parser. The implementation now lives in `robots-parser.ts`.
export { parseUserAgents, intentBlocked } from './robots-parser.js';
export type { BotEntry } from './robots-parser.js';

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const res = await ctx.fetch(`${ctx.url}/robots.txt`);

  if (!res.ok) {
    findings.push({
      status: 'fail',
      message: '/robots.txt not found',
      hint: 'Create a /robots.txt file at your site root. Add User-agent entries for AI crawlers (GPTBot, ClaudeBot, etc.) with Allow: / to grant access.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({ status: 'pass', message: '/robots.txt exists' });
  const text = res.body;
  const robots = parseRobotsTxt(text);
  const configuredBots = toBotEntries(robots);
  const wildcardEntry = configuredBots.find((b) => b.name === '*');

  const coreConfigured = CORE_AI_CRAWLERS.filter((bot) =>
    configuredBots.some((b) => b.name.toLowerCase() === bot.toLowerCase()),
  );
  const coreMissing = CORE_AI_CRAWLERS.filter(
    (bot) => !configuredBots.some((b) => b.name.toLowerCase() === bot.toLowerCase()),
  );

  if (coreConfigured.length === CORE_AI_CRAWLERS.length) {
    findings.push({ status: 'pass', message: `All ${CORE_AI_CRAWLERS.length} core AI crawlers explicitly configured` });
  } else if (coreConfigured.length > 0) {
    findings.push({
      status: 'warn',
      message: `${coreConfigured.length}/${CORE_AI_CRAWLERS.length} core AI crawlers configured`,
      detail: `Missing: ${coreMissing.join(', ')}`,
      hint: `Add explicit User-agent entries for the missing crawlers with Allow: / for each one.`,
      learnMoreUrl: guideUrl(meta.id, 'missing-crawlers'),
    });
    score -= Math.round((coreMissing.length / CORE_AI_CRAWLERS.length) * 30);
  } else {
    findings.push({
      status: 'fail',
      message: 'No core AI crawlers explicitly configured',
      detail: `Expected: ${CORE_AI_CRAWLERS.join(', ')}`,
      hint: 'Add User-agent entries for core AI crawlers in your robots.txt. For each crawler, add: User-agent: <name> followed by Allow: / on the next line.',
      learnMoreUrl: guideUrl(meta.id, 'no-core-crawlers'),
    });
    score -= 40;
  }

  // Check wildcard blocking unconfigured AI crawlers
  if (wildcardEntry?.disallowed) {
    const blockedByWildcard = CORE_AI_CRAWLERS.filter(
      (bot) => !configuredBots.some((b) => b.name.toLowerCase() === bot.toLowerCase()),
    );
    if (blockedByWildcard.length > 0) {
      findings.push({
        status: 'warn',
        message: `${blockedByWildcard.length} core AI crawler(s) blocked via wildcard User-agent: *`,
        detail: blockedByWildcard.join(', '),
        hint: 'Your "User-agent: * / Disallow: /" rule blocks these crawlers. Add explicit User-agent entries with Allow: / for each AI crawler you want to permit.',
        learnMoreUrl: guideUrl(meta.id, 'blocked-by-wildcard'),
      });
      score -= blockedByWildcard.length * 5;
    }
  }

  const blockedBots = configuredBots.filter(
    (b) => b.name !== '*' && ALL_AI_CRAWLERS.some((ai) => ai.toLowerCase() === b.name.toLowerCase()) && b.disallowed,
  );
  if (blockedBots.length > 0) {
    findings.push({
      status: 'warn',
      message: `${blockedBots.length} AI crawler(s) explicitly blocked`,
      detail: blockedBots.map((b) => b.name).join(', '),
      hint: 'These crawlers have "Disallow: /" rules. If you want AI agents to access your site, change to "Allow: /" for each blocked crawler.',
      learnMoreUrl: guideUrl(meta.id, 'explicitly-blocked'),
    });
    score -= blockedBots.length * 3;
  }

  // Check partial restrictions (Disallow on specific paths, not full block)
  const restrictedBots = configuredBots.filter(
    (b) =>
      b.name !== '*' &&
      ALL_AI_CRAWLERS.some((ai) => ai.toLowerCase() === b.name.toLowerCase()) &&
      b.hasRestrictions &&
      !b.disallowed,
  );
  if (restrictedBots.length > 0) {
    findings.push({
      status: 'warn',
      message: `${restrictedBots.length} AI crawler(s) have partial path restrictions`,
      detail: restrictedBots.map((b) => b.name).join(', '),
      hint: 'These crawlers have Disallow rules on specific paths. For full AI access, use only "Allow: /" and let the wildcard User-agent: * handle path restrictions.',
      learnMoreUrl: guideUrl(meta.id, 'partial-restrictions'),
    });
  }

  if (robots.sitemaps.length > 0) {
    findings.push({ status: 'pass', message: 'Sitemap directive present' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No Sitemap directive found',
      hint: 'Add a Sitemap directive to your robots.txt: Sitemap: https://your-site.com/sitemap.xml',
      learnMoreUrl: guideUrl(meta.id, 'missing-sitemap'),
    });
    score -= 5;
  }

  // Usage-preference directives — informational in 3.x: findings only, no score impact.
  addContentSignalFindings(robots, findings);
  addContentUsageFindings(robots, findings);

  const totalConfigured = ALL_AI_CRAWLERS.filter((bot) =>
    configuredBots.some((b) => b.name.toLowerCase() === bot.toLowerCase()),
  );
  findings.push({
    status: totalConfigured.length >= 10 ? 'pass' : 'warn',
    message: `${totalConfigured.length}/${ALL_AI_CRAWLERS.length} known AI crawlers have explicit rules`,
    ...(totalConfigured.length < 10
      ? {
          hint: 'Add explicit User-agent entries for more AI crawlers to maximize discoverability.',
          learnMoreUrl: guideUrl(meta.id, 'low-coverage'),
        }
      : {}),
  });

  return buildResult(meta, score, findings, start);
}

/* ── Content Signals Policy (https://contentsignals.org) ───────────────── */

/**
 * Report `Content-Signal:` declarations, the machine-readable statement of how
 * content may be used *after* access. Cloudflare serves these by default on its
 * managed robots.txt, so they show up on a large share of the web.
 *
 * Every finding here is informational in 3.x: no major AI operator has publicly
 * committed to honoring the policy (Google has said its crawlers ignore it), so
 * an absent directive must never cost a site points.
 */
function addContentSignalFindings(robots: RobotsTxt, findings: Finding[]): void {
  const declared = robots.groups.flatMap((g) => g.contentSignals.map((raw) => ({ group: g.userAgents, raw })));

  for (const raw of robots.orphanContentSignals) {
    findings.push({
      status: 'warn',
      message: 'Content-Signal directive outside a User-agent group',
      detail: `Content-Signal: ${raw}`,
      hint: 'Place Content-Signal inside a User-agent group, after the User-agent line it applies to.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-content-signal'),
    });
  }

  if (declared.length === 0) {
    if (robots.orphanContentSignals.length > 0) return;
    findings.push({
      status: 'warn',
      message: 'No Content-Signal directive found (optional)',
      hint:
        'Declare how crawlers may use your content after access with the Content Signals Policy, ' +
        'e.g.: Content-Signal: search=yes, ai-train=no. Known signals: ' +
        `${CONTENT_SIGNALS.join(', ')}, plus the optional use=${CONTENT_SIGNAL_USE_VALUES.join('|')}. ` +
        'Generate yours at contentsignals.org.',
      learnMoreUrl: guideUrl(meta.id, 'missing-content-signals'),
    });
    return;
  }

  if (robots.cloudflareManaged) {
    findings.push({
      status: 'pass',
      message: 'Content signals served from a Cloudflare-managed robots.txt block',
      detail: 'Edit these in the Cloudflare dashboard (AI Crawl Control), not in your origin robots.txt.',
    });
  }

  for (const decl of declared) {
    const group = decl.group.join(', ');
    const { valid, malformed, unknown, invalidValue } = parseContentSignalValue(decl.raw);

    if (valid.length > 0) {
      findings.push({
        status: 'pass',
        message: `Content signals declared for User-agent: ${group} — ${valid.join(', ')}`,
      });
    }
    if (malformed.length > 0) {
      findings.push({
        status: 'warn',
        message: `Malformed content signal segment(s) for User-agent: ${group}`,
        detail: malformed.join(', '),
        hint: 'Use comma-delimited signal=yes|no pairs, e.g.: Content-Signal: search=yes, ai-train=no.',
        learnMoreUrl: guideUrl(meta.id, 'invalid-content-signal'),
      });
    }
    if (invalidValue.length > 0) {
      findings.push({
        status: 'warn',
        message: `Content signal(s) with an out-of-vocabulary value for User-agent: ${group}`,
        detail: invalidValue.join(', '),
        hint:
          `${CONTENT_SIGNALS.join(', ')} take yes or no. ` +
          `use takes ${CONTENT_SIGNAL_USE_VALUES.join(', ')} (default: reference).`,
        learnMoreUrl: guideUrl(meta.id, 'invalid-content-signal'),
      });
    }
    if (unknown.length > 0) {
      findings.push({
        status: 'warn',
        message: `Unknown content signal name(s) for User-agent: ${group}`,
        detail: unknown.join(', '),
        hint: `The Content Signals Policy defines: ${CONTENT_SIGNALS.join(', ')}, use. Other names are ignored by crawlers.`,
        learnMoreUrl: guideUrl(meta.id, 'unknown-content-signal'),
      });
    }
  }
}

/* ── IETF AIPREF Content-Usage (draft-ietf-aipref-attach-05) ────────────── */

/**
 * Report `Content-Usage:` rules. AIPREF is the IETF's answer to the same
 * question Content Signals asks, and its drafts are still pre-last-call, so
 * these findings are informational and an absent directive is never penalised.
 *
 * The one thing worth flagging loudly is a vocabulary mix-up: AIPREF spells the
 * training token `train-ai` with `y`/`n` values, while Content Signals and RSL
 * spell it `ai-train` with `yes`/`no`. A `Content-Usage: ai-train=no` line looks
 * right and does nothing.
 */
function addContentUsageFindings(robots: RobotsTxt, findings: Finding[]): void {
  const declared = robots.groups.flatMap((g) => g.contentUsage.map((raw) => ({ group: g.userAgents, raw })));
  const orphans = robots.orphanContentUsage;
  if (declared.length === 0 && orphans.length === 0) return;

  for (const raw of orphans) {
    findings.push({
      status: 'warn',
      message: 'Content-Usage rule outside a User-agent group',
      detail: `Content-Usage: ${raw}`,
      hint: 'AIPREF scopes Content-Usage rules to the User-agent group they appear in. Place the rule after a User-agent line.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-content-usage'),
    });
  }

  for (const decl of declared) {
    const group = decl.group.join(', ');
    const scope = (path: string | null): string => (path === null ? '' : ` for ${path}`);
    const { path, valid, unknown, invalidValue, malformed, crossVocabulary } = parseContentUsageValue(decl.raw);

    if (valid.length > 0) {
      findings.push({
        status: 'pass',
        message: `AI usage preferences declared for User-agent: ${group}${scope(path)} — ${valid.join(', ')}`,
        detail:
          'IETF AIPREF (draft-ietf-aipref-attach). The drafts are pre-last-call; treat this as a forward-looking signal.',
      });
    }
    if (crossVocabulary.length > 0) {
      findings.push({
        status: 'warn',
        message: `Content-Usage uses Content Signals vocabulary for User-agent: ${group}`,
        detail: crossVocabulary.join(', '),
        hint: 'AIPREF defines train-ai and search with y/n values. Content Signals defines ai-train, ai-input and search with yes/no. Write Content-Usage: train-ai=n, and keep ai-train=no on the Content-Signal line.',
        learnMoreUrl: guideUrl(meta.id, 'content-usage-vocabulary'),
      });
    }
    if (invalidValue.length > 0) {
      findings.push({
        status: 'warn',
        message: `Content-Usage value(s) outside the AIPREF vocabulary for User-agent: ${group}`,
        detail: invalidValue.join(', '),
        hint: 'AIPREF preference values are y and n. An absent token means "unknown", never "allowed".',
        learnMoreUrl: guideUrl(meta.id, 'content-usage-vocabulary'),
      });
    }
    if (unknown.length > 0) {
      findings.push({
        status: 'warn',
        message: `Unknown Content-Usage token(s) for User-agent: ${group}`,
        detail: unknown.join(', '),
        hint: 'AIPREF vocabulary v07 defines train-ai and search. Extensions require a standards-track RFC.',
        learnMoreUrl: guideUrl(meta.id, 'content-usage-vocabulary'),
      });
    }
    if (malformed.length > 0) {
      findings.push({
        status: 'warn',
        message: `Malformed Content-Usage segment(s) for User-agent: ${group}`,
        detail: malformed.join(', '),
        hint: 'Content-Usage takes an optional path pattern then a Structured Fields dictionary, e.g.: Content-Usage: /docs/ train-ai=n, search=y.',
        learnMoreUrl: guideUrl(meta.id, 'invalid-content-usage'),
      });
    }
  }
}
