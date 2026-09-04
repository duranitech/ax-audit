/**
 * One robots.txt parser for every check that reads the file.
 *
 * Before 3.7 the group-splitting logic lived in three places (`robots-txt`
 * counted User-agent groups, `rsl` scanned for `License:`, `agent-access`
 * re-derived block intent) and each had its own idea of what closes a group.
 * They now share this module, so a fix to the grouping rules fixes every check.
 *
 * Grouping follows RFC 9309 §2.2.1: consecutive `User-agent` lines accumulate
 * into one group; the first rule line closes the accumulation, and the next
 * `User-agent` starts a fresh group. Directives that are not part of a group
 * (`Sitemap`) are collected globally.
 *
 * Beyond RFC 9309 this parser understands four extensions, all optional and all
 * reported rather than assumed:
 *
 * - `Content-Signal:` — Content Signals Policy (contentsignals.org, CC0), served
 *   by Cloudflare's managed robots.txt on millions of zones. Values are
 *   `name=yes|no` pairs over `search`, `ai-input`, `ai-train`, plus the `use=`
 *   field Cloudflare added on 2026-07-01 (`immediate` | `reference` | `full`).
 * - `Content-Usage:` — IETF AIPREF (draft-ietf-aipref-attach-05, 2026-08-19).
 *   An optional path pattern followed by a Structured Fields dictionary over
 *   `train-ai` and `search` with `y`/`n` values. Note the token inversion
 *   against Content Signals: AIPREF says `train-ai`, Content Signals says
 *   `ai-train`. Mixing them up is a real-world bug this parser can surface.
 * - `License:` — Really Simple Licensing 1.0 §4.4.1, global or group-scoped.
 * - `Agentmap:` — the ARD / ai-catalog discovery hint Lighthouse's `ard-schema`
 *   audit reads, analogous to `Sitemap:`.
 */
import { CONTENT_SIGNALS, CONTENT_SIGNAL_USE_VALUES, AIPREF_TOKENS, AIPREF_VALUES } from '../constants.js';
import { parseDictionary } from './structured-fields.js';

/** A `User-agent` group and the rules attached to it. */
export interface RobotsGroup {
  /** User-agent tokens sharing this group, as written. */
  userAgents: string[];
  allow: string[];
  disallow: string[];
  /** Raw `Content-Signal:` values declared in this group. */
  contentSignals: string[];
  /** Raw `Content-Usage:` values declared in this group. */
  contentUsage: string[];
  /** Group-scoped RSL `License:` values (override the global ones per RSL §4.4.1). */
  licenses: string[];
  crawlDelay?: string;
}

/** Everything ax-audit reads out of a robots.txt, parsed once. */
export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** Global (out-of-group) RSL `License:` directives. */
  licenses: string[];
  /** `Agentmap:` directives pointing at an ai-catalog / ARD document. */
  agentmaps: string[];
  /** `Content-Signal:` / `Content-Usage:` lines that appeared outside any group. */
  orphanContentSignals: string[];
  orphanContentUsage: string[];
  /** True when Cloudflare's managed-content block markers are present. */
  cloudflareManaged: boolean;
  /** Total non-comment, non-blank lines — used to distinguish empty from absent. */
  ruleLineCount: number;
}

/** Backwards-compatible per-bot view derived from the parsed groups. */
export interface BotEntry {
  name: string;
  /** A full `Disallow: /` applies to this bot. */
  disallowed: boolean;
  /** Any `Disallow:` rule applies to this bot (full or path-scoped). */
  hasRestrictions: boolean;
  hasAllow: boolean;
}

const GROUP_DIRECTIVES = /^(Disallow|Allow|Crawl-delay|Content-Signal|Content-Usage|License|Noindex|Request-rate):/i;

/**
 * Parse a robots.txt document. Never throws: unrecognised lines are ignored,
 * which is exactly what RFC 9309 §2.2.4 requires of conforming parsers.
 */
export function parseRobotsTxt(text: string): RobotsTxt {
  const result: RobotsTxt = {
    groups: [],
    sitemaps: [],
    licenses: [],
    agentmaps: [],
    orphanContentSignals: [],
    orphanContentUsage: [],
    cloudflareManaged: /#\s*(BEGIN|END)\s+Cloudflare\s+Managed\s+[Cc]ontent/i.test(text),
    ruleLineCount: 0,
  };

  let current: RobotsGroup | null = null;
  // True once a rule line has been seen in the current group: the next
  // `User-agent` line then starts a new group instead of joining this one.
  let groupClosed = false;

  for (const rawLine of text.split('\n')) {
    // A comment may follow a value on the same line; strip from the first `#`
    // that is not inside the value we care about. robots.txt has no quoting,
    // so a plain split is correct.
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    result.ruleLineCount++;

    const ua = line.match(/^User-agent:\s*(.*)$/i);
    if (ua) {
      const name = ua[1].trim();
      if (!name) continue;
      if (current === null || groupClosed) {
        current = {
          userAgents: [],
          allow: [],
          disallow: [],
          contentSignals: [],
          contentUsage: [],
          licenses: [],
        };
        result.groups.push(current);
        groupClosed = false;
      }
      current.userAgents.push(name);
      continue;
    }

    const sitemap = line.match(/^Sitemap:\s*(.+)$/i);
    if (sitemap) {
      result.sitemaps.push(sitemap[1].trim());
      continue;
    }

    const agentmap = line.match(/^Agentmap:\s*(.+)$/i);
    if (agentmap) {
      result.agentmaps.push(agentmap[1].trim());
      continue;
    }

    if (!GROUP_DIRECTIVES.test(line)) continue;

    const [name, ...rest] = line.split(':');
    const directive = name.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (current !== null) groupClosed = true;

    switch (directive) {
      case 'disallow':
        current?.disallow.push(value);
        break;
      case 'allow':
        current?.allow.push(value);
        break;
      case 'crawl-delay':
        if (current) current.crawlDelay = value;
        break;
      case 'content-signal':
        if (current) current.contentSignals.push(value);
        else result.orphanContentSignals.push(value);
        break;
      case 'content-usage':
        if (current) current.contentUsage.push(value);
        else result.orphanContentUsage.push(value);
        break;
      case 'license':
        // RSL §4.4.1: a License inside a group scopes to that group; before any
        // group it applies site-wide.
        if (current) current.licenses.push(value);
        else result.licenses.push(value);
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Flatten parsed groups into one entry per User-agent token, preserving the
 * shape the 3.x checks were written against.
 *
 * A bot named in several groups is merged: `disallowed` is true when any group
 * fully blocks it. RFC 9309 says a crawler picks the most specific matching
 * group, but robots.txt files that name the same token twice are almost always
 * a mistake, so merging surfaces the restriction rather than hiding it.
 */
export function toBotEntries(robots: RobotsTxt): BotEntry[] {
  const byName = new Map<string, BotEntry>();

  for (const group of robots.groups) {
    const fullBlock = group.disallow.some((p) => p === '/');
    const anyDisallow = group.disallow.some((p) => p !== '');
    const anyAllow = group.allow.length > 0;

    for (const name of group.userAgents) {
      const existing = byName.get(name);
      if (existing) {
        existing.disallowed ||= fullBlock;
        existing.hasRestrictions ||= anyDisallow;
        existing.hasAllow ||= anyAllow;
        continue;
      }
      byName.set(name, {
        name,
        disallowed: fullBlock,
        hasRestrictions: anyDisallow,
        hasAllow: anyAllow,
      });
    }
  }

  return [...byName.values()];
}

/** Parse text straight into bot entries. Convenience for checks that need nothing else. */
export function parseUserAgents(text: string): BotEntry[] {
  return toBotEntries(parseRobotsTxt(text));
}

/** Every RSL `License:` value in the document, group-scoped ones included. */
export function collectLicenses(robots: RobotsTxt): string[] {
  return [...robots.licenses, ...robots.groups.flatMap((g) => g.licenses)];
}

/**
 * Whether robots.txt expresses the intent to block a crawler: an explicit full
 * `Disallow: /` for it, or a wildcard full block with no explicit entry.
 */
export function intentBlocked(entries: BotEntry[], crawler: string): boolean {
  const explicit = entries.find((e) => e.name.toLowerCase() === crawler.toLowerCase());
  if (explicit) return explicit.disallowed;
  return entries.find((e) => e.name === '*')?.disallowed ?? false;
}

/* ── Content Signals Policy vocabulary ──────────────────────────────────── */

export interface ParsedSignals {
  /** Normalised `name=value` pairs with known names. */
  valid: string[];
  /** Segments not matching `name=value`. */
  malformed: string[];
  /** Well-formed pairs whose name is outside the policy vocabulary. */
  unknown: string[];
  /** Well-formed pairs with a known name but an out-of-vocabulary value. */
  invalidValue: string[];
}

/**
 * Parse one `Content-Signal:` value.
 *
 * Accepts the three boolean signals (`search`, `ai-input`, `ai-train` with
 * `yes`/`no`) and the `use` field Cloudflare added on 2026-07-01, whose values
 * are `immediate`, `reference` (the stated default) and `full`. Cloudflare's
 * managed robots.txt writes `Content-signal:` with a lowercase `s` and a space
 * after each comma, while the launch blog uses `Content-Signal:` without
 * spaces; both parse identically here.
 */
export function parseContentSignalValue(raw: string): ParsedSignals {
  const result: ParsedSignals = { valid: [], malformed: [], unknown: [], invalidValue: [] };

  for (const segment of raw.split(',')) {
    const s = segment.trim();
    if (!s) continue;

    const m = s.match(/^([a-z][a-z-]*)\s*=\s*([a-z-]+)$/i);
    if (!m) {
      result.malformed.push(s);
      continue;
    }

    const name = m[1].toLowerCase();
    const value = m[2].toLowerCase();

    if (name === 'use') {
      if (CONTENT_SIGNAL_USE_VALUES.includes(value)) result.valid.push(`use=${value}`);
      else result.invalidValue.push(s);
      continue;
    }

    if (!CONTENT_SIGNALS.includes(name)) {
      result.unknown.push(s);
      continue;
    }

    if (value !== 'yes' && value !== 'no') {
      result.invalidValue.push(s);
      continue;
    }

    result.valid.push(`${name}=${value}`);
  }

  return result;
}

/* ── IETF AIPREF Content-Usage vocabulary ───────────────────────────────── */

export interface ParsedUsage {
  /** Path pattern the preference is scoped to, or `null` for the whole group. */
  path: string | null;
  /** Normalised `token=value` pairs over the AIPREF vocabulary. */
  valid: string[];
  /** Dictionary members outside the AIPREF vocabulary. */
  unknown: string[];
  /** Known tokens with values other than `y`/`n`. */
  invalidValue: string[];
  /** Segments the Structured Fields parser rejected. */
  malformed: string[];
  /**
   * Content Signals / RSL tokens used under `Content-Usage`, e.g. `ai-train=no`
   * where AIPREF expects `train-ai=n`. Reported separately because the two
   * vocabularies are near-mirror images and confusing them is silent breakage.
   */
  crossVocabulary: string[];
}

/** Tokens that belong to a *different* usage vocabulary, flagged when seen under Content-Usage. */
const FOREIGN_TOKENS = new Set(['ai-train', 'ai-input', 'ai-index', 'ai-all', 'use']);

/**
 * Parse one `Content-Usage:` value per draft-ietf-aipref-attach-05 §3:
 * an optional path pattern, whitespace, then a Structured Fields dictionary.
 */
export function parseContentUsageValue(raw: string): ParsedUsage {
  const result: ParsedUsage = {
    path: null,
    valid: [],
    unknown: [],
    invalidValue: [],
    malformed: [],
    crossVocabulary: [],
  };

  let body = raw.trim();
  // A leading path pattern is present when the first whitespace-delimited token
  // starts with `/` (or `*`, for a bare wildcard pattern).
  const firstSpace = body.search(/\s/);
  if (firstSpace > 0) {
    const head = body.slice(0, firstSpace);
    if (head.startsWith('/') || head.startsWith('*')) {
      result.path = head;
      body = body.slice(firstSpace).trim();
    }
  }

  const dict = parseDictionary(body);
  result.malformed.push(...dict.malformed);

  for (const member of dict.members) {
    if (FOREIGN_TOKENS.has(member.key)) {
      result.crossVocabulary.push(member.raw);
      continue;
    }
    if (!AIPREF_TOKENS.includes(member.key)) {
      result.unknown.push(member.raw);
      continue;
    }
    if (!AIPREF_VALUES.includes(member.value.toLowerCase())) {
      result.invalidValue.push(member.raw);
      continue;
    }
    result.valid.push(`${member.key}=${member.value.toLowerCase()}`);
  }

  return result;
}

/* ── RSL License directives ─────────────────────────────────────────────── */

/** Extract every `License:` directive value (RSL 1.0 §4.4.1). */
export function parseRobotsLicenseDirectives(text: string): string[] {
  return collectLicenses(parseRobotsTxt(text));
}
