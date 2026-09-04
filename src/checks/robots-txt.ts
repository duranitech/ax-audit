import {
  ALL_AI_CRAWLERS,
  CONTENT_SIGNALS,
  CONTENT_SIGNAL_USE_VALUES,
  CORE_AI_CRAWLERS,
  crawlerInfo,
  crawlerPurpose,
  legacyCrawlerNote,
  type CrawlerPurpose,
} from '../constants.js';
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

  const isConfigured = (bot: string): boolean => configuredBots.some((b) => b.name.toLowerCase() === bot.toLowerCase());

  // 4.0 scores against the current core set. The 3.x freeze that held it at
  // eight tokens is gone, so the crawlers that gained traffic share in 2026
  // now count.
  const coreConfigured = CORE_AI_CRAWLERS.filter(isConfigured);
  const coreMissing = CORE_AI_CRAWLERS.filter((bot) => !isConfigured(bot));

  if (coreConfigured.length === CORE_AI_CRAWLERS.length) {
    findings.push({
      status: 'pass',
      message: `All ${CORE_AI_CRAWLERS.length} core AI crawlers explicitly configured`,
    });
  } else if (coreConfigured.length > 0) {
    findings.push({
      status: 'warn',
      message: `${coreConfigured.length}/${CORE_AI_CRAWLERS.length} core AI crawlers configured`,
      detail: coreMissing.map((bot) => `${bot} — ${crawlerInfo(bot)?.impact ?? 'no explicit rule'}`).join('\n'),
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
    const blockedByWildcard = CORE_AI_CRAWLERS.filter((bot) => !isConfigured(bot));
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
    // 4.0 removed the 3.x freeze: every catalogued crawler counts. Search
    // crawlers cost more than training ones, because blocking a search crawler
    // removes the site from that assistant's answers while blocking a training
    // crawler is a policy choice.
    for (const bot of blockedBots) {
      score -= crawlerPurpose(bot.name) === 'search' ? 5 : 2;
    }
  }

  addBlockedPurposeFindings(
    blockedBots.map((b) => b.name),
    findings,
  );
  addLegacyTokenFindings(
    configuredBots.map((b) => b.name),
    findings,
  );

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

/* ── Crawler catalogue reporting (informational in 3.x) ────────────────── */

/**
 * Explain a block in terms of what it costs, grouped by purpose.
 *
 * Blocking a training crawler is a deliberate, defensible policy choice.
 * Blocking a search crawler removes the site from that assistant's answers,
 * which operators frequently do by accident when copying a "block AI" snippet.
 * Reporting both as one undifferentiated warning hides the difference that
 * matters.
 */
function addBlockedPurposeFindings(blockedNames: string[], findings: Finding[]): void {
  if (blockedNames.length === 0) return;

  const byPurpose = new Map<CrawlerPurpose, string[]>();
  for (const name of blockedNames) {
    const purpose = crawlerPurpose(name);
    if (purpose === undefined) continue;
    byPurpose.set(purpose, [...(byPurpose.get(purpose) ?? []), name]);
  }

  const search = byPurpose.get('search') ?? [];
  if (search.length > 0) {
    findings.push({
      status: 'warn',
      message: `${search.length} assistant search crawler(s) blocked — your site cannot be cited by those assistants`,
      detail: search.map((n) => `${n} — ${crawlerInfo(n)?.impact ?? 'search index crawler'}`).join('\n'),
      hint:
        'Search crawlers build the index an assistant cites from; they are separate from the training crawlers. ' +
        'If the intent was to opt out of training only, allow these and block the training tokens instead.',
      learnMoreUrl: guideUrl(meta.id, 'blocked-search-crawlers'),
    });
  }

  const training = byPurpose.get('training') ?? [];
  if (training.length > 0) {
    findings.push({
      status: 'pass',
      message: `${training.length} training crawler(s) blocked — recorded as a deliberate policy choice`,
      detail: training.join(', '),
    });
  }

  const userFetch = byPurpose.get('user-fetch') ?? [];
  const ignoring = userFetch.filter((n) => crawlerInfo(n)?.honorsRobots !== true);
  if (ignoring.length > 0) {
    findings.push({
      status: 'warn',
      message: `${ignoring.length} user-triggered fetcher(s) blocked in robots.txt that may ignore it`,
      detail: ignoring
        .map((n) => `${n} — ${crawlerInfo(n)?.note ?? 'documented as possibly ignoring robots.txt'}`)
        .join('\n'),
      hint:
        'These clients fetch a page because a person asked for that URL, and their vendors document that robots.txt may not apply. ' +
        'Enforce at the edge if the block must hold.',
      learnMoreUrl: guideUrl(meta.id, 'blocked-user-fetchers'),
    });
  }
}

/**
 * Flag rules for tokens that no longer do anything: renamed products,
 * discontinued crawlers, and strings that were never real user agents but
 * circulate widely in copy-pasted "block AI" snippets.
 */
function addLegacyTokenFindings(configuredNames: string[], findings: Finding[]): void {
  const legacy = configuredNames
    .map((name) => ({ name, note: legacyCrawlerNote(name) }))
    .filter((e): e is { name: string; note: string } => e.note !== undefined);
  if (legacy.length === 0) return;

  findings.push({
    status: 'warn',
    message: `${legacy.length} robots.txt rule(s) target a retired or non-existent crawler token`,
    detail: legacy.map((e) => `${e.name} — ${e.note}`).join('\n'),
    hint: 'These rules have no effect. Remove them so the file reflects your actual policy.',
    learnMoreUrl: guideUrl(meta.id, 'legacy-tokens'),
  });
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
