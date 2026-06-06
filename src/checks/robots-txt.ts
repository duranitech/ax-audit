import { ALL_AI_CRAWLERS, CONTENT_SIGNALS, CORE_AI_CRAWLERS } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

export const meta: CheckMeta = {
  id: 'robots-txt',
  name: 'Robots.txt',
  description: 'Checks AI crawler configuration in robots.txt',
  weight: 11,
};

interface BotEntry {
  name: string;
  disallowed: boolean;
  hasRestrictions: boolean;
  hasAllow: boolean;
}

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
  const configuredBots = parseUserAgents(text);
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

  if (/^Sitemap:/im.test(text)) {
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

  // Content Signals Policy (contentsignals.org) — informational in 3.x: findings only, no score impact.
  addContentSignalFindings(text, findings);

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

function parseUserAgents(text: string): BotEntry[] {
  const entries: BotEntry[] = [];
  let currentGroup: BotEntry[] = [];
  let inDirectives = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const uaMatch = trimmed.match(/^User-agent:\s*(.+)/i);
    if (uaMatch) {
      if (inDirectives) {
        currentGroup = [];
        inDirectives = false;
      }
      const entry: BotEntry = { name: uaMatch[1].trim(), disallowed: false, hasRestrictions: false, hasAllow: false };
      currentGroup.push(entry);
      entries.push(entry);
    } else if (/^Disallow:\s*\/\s*$/i.test(trimmed)) {
      inDirectives = true;
      for (const entry of currentGroup) {
        entry.disallowed = true;
        entry.hasRestrictions = true;
      }
    } else if (/^Disallow:\s*\/.+/i.test(trimmed)) {
      inDirectives = true;
      for (const entry of currentGroup) {
        entry.hasRestrictions = true;
      }
    } else if (/^Allow:/i.test(trimmed)) {
      inDirectives = true;
      for (const entry of currentGroup) {
        entry.hasAllow = true;
      }
    } else if (/^(Sitemap|Crawl-delay|Host|Content-Signal):/i.test(trimmed)) {
      inDirectives = true;
    }
  }

  return entries;
}

/* ── Content Signals Policy (https://contentsignals.org) ───────────────── */

interface ContentSignalDecl {
  /** User-agent names of the group this declaration belongs to (empty = outside any group). */
  userAgents: string[];
  /** Raw directive value, e.g. "search=yes, ai-train=no". */
  raw: string;
}

/**
 * Extract `Content-Signal:` declarations and the User-agent group each belongs to.
 * Mirrors the grouping rules of `parseUserAgents`: consecutive User-agent lines form
 * one group; any directive line closes the group.
 */
export function parseContentSignalDecls(text: string): ContentSignalDecl[] {
  const decls: ContentSignalDecl[] = [];
  let currentUAs: string[] = [];
  let inDirectives = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const uaMatch = trimmed.match(/^User-agent:\s*(.+)/i);
    if (uaMatch) {
      if (inDirectives) {
        currentUAs = [];
        inDirectives = false;
      }
      currentUAs.push(uaMatch[1].trim());
      continue;
    }

    const csMatch = trimmed.match(/^Content-Signal:\s*(.+)/i);
    if (csMatch) {
      inDirectives = true;
      decls.push({ userAgents: [...currentUAs], raw: csMatch[1].trim() });
      continue;
    }

    if (/^(Disallow|Allow|Sitemap|Crawl-delay|Host):/i.test(trimmed)) {
      inDirectives = true;
    }
  }

  return decls;
}

interface ParsedSignals {
  valid: string[]; // normalized "name=yes|no" pairs with known names
  malformed: string[]; // segments not matching name=yes|no
  unknown: string[]; // well-formed pairs with names outside the spec vocabulary
}

function parseSignalPairs(raw: string): ParsedSignals {
  const result: ParsedSignals = { valid: [], malformed: [], unknown: [] };
  for (const segment of raw.split(',')) {
    const s = segment.trim();
    if (!s) continue;
    const m = s.match(/^([a-z][a-z-]*)\s*=\s*(yes|no)$/i);
    if (!m) {
      result.malformed.push(s);
      continue;
    }
    const name = m[1].toLowerCase();
    if (!CONTENT_SIGNALS.includes(name)) {
      result.unknown.push(s);
      continue;
    }
    result.valid.push(`${name}=${m[2].toLowerCase()}`);
  }
  return result;
}

function addContentSignalFindings(text: string, findings: Finding[]): void {
  const decls = parseContentSignalDecls(text);

  if (decls.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No Content-Signal directive found (optional)',
      hint:
        'Declare how crawlers may use your content after access with the Content Signals Policy, ' +
        'e.g.: Content-Signal: search=yes, ai-train=no. Known signals: ' +
        `${CONTENT_SIGNALS.join(', ')}. Generate yours at contentsignals.org.`,
      learnMoreUrl: guideUrl(meta.id, 'missing-content-signals'),
    });
    return;
  }

  for (const decl of decls) {
    const group = decl.userAgents.length > 0 ? decl.userAgents.join(', ') : null;
    const { valid, malformed, unknown } = parseSignalPairs(decl.raw);

    if (group === null) {
      findings.push({
        status: 'warn',
        message: 'Content-Signal directive outside a User-agent group',
        detail: `Content-Signal: ${decl.raw}`,
        hint: 'Place Content-Signal inside a User-agent group, after the User-agent line it applies to.',
        learnMoreUrl: guideUrl(meta.id, 'invalid-content-signal'),
      });
      continue;
    }

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
    if (unknown.length > 0) {
      findings.push({
        status: 'warn',
        message: `Unknown content signal name(s) for User-agent: ${group}`,
        detail: unknown.join(', '),
        hint: `The Content Signals Policy defines: ${CONTENT_SIGNALS.join(', ')}. Other names are ignored by crawlers.`,
        learnMoreUrl: guideUrl(meta.id, 'unknown-content-signal'),
      });
    }
  }
}
