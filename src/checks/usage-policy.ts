import { RSL_MIME } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { findLinkTags, getAttribute, getMetaContent } from './html-utils.js';
import { parseLinkHeader } from './http-headers.js';
import { parseDictionary } from './structured-fields.js';
import { AIPREF_TOKENS, AIPREF_VALUES } from '../constants.js';
import { collectLicenses, parseContentSignalValue, parseContentUsageValue, parseRobotsTxt } from './robots-parser.js';

/**
 * "usage-policy" — do your machine-readable usage signals agree with each other?
 *
 * A site can now state its AI usage terms in at least five places, written in
 * vocabularies that mirror each other without matching:
 *
 * | Mechanism | Training | Grounding / RAG | Search |
 * | --- | --- | --- | --- |
 * | Content Signals (robots.txt) | `ai-train=yes\|no` | `ai-input=yes\|no` | `search=yes\|no` |
 * | IETF AIPREF (robots.txt or header) | `train-ai=y\|n` | *(no category yet)* | `search=y\|n` |
 * | RSL licence | `ai-train` | `ai-input` | `ai-index`, `search` |
 * | TDMRep | `tdm-reservation: 0\|1` | — | — |
 * | robots meta | `noai` | — | — |
 *
 * Nobody maintains five documents by hand without them drifting. This check
 * normalises every signal onto three questions — may you train on it, may you
 * ground an answer in it, may you index it — and reports where the answers
 * disagree. A site whose robots.txt says `ai-train=no` while its RSL licence
 * permits `ai-train` has published two contradictory legal positions, and which
 * one a crawler honors is then a matter of which file it happened to read.
 *
 * On enforcement, the check is blunt: only robots.txt access rules are
 * documented as honored by Google, OpenAI, Anthropic and Microsoft. Content
 * Signals, AIPREF, RSL and TDMRep are declarations. Their weight is legal — the
 * EU AI Act's opt-out provisions and the GPAI Code of Practice reference several
 * of them — rather than technical, and reports say so rather than implying a
 * crawler will obey.
 */
export const meta: CheckMeta = {
  id: 'usage-policy',
  name: 'Usage Policy',
  description: 'Checks machine-readable AI usage signals for coverage and internal consistency',
  category: 'policy',
};

/** The three questions every usage vocabulary answers, or declines to answer. */
export type Dimension = 'train' | 'ground' | 'index';

export type Stance = 'allow' | 'deny' | 'unstated';

export interface Declaration {
  /** Human name of the mechanism and where it was found. */
  source: string;
  /** Whether the mechanism has any documented honorer among major AI operators. */
  enforceable: boolean;
  train: Stance;
  ground: Stance;
  index: Stance;
}

const DIMENSION_LABEL: Record<Dimension, string> = {
  train: 'training on your content',
  ground: 'grounding an answer in your content',
  index: 'indexing your content for search',
};

function yesNo(value: string | undefined): Stance {
  if (value === 'yes' || value === 'y') return 'allow';
  if (value === 'no' || value === 'n') return 'deny';
  return 'unstated';
}

/** Read a Content-Signal value into a declaration. */
export function fromContentSignal(raw: string, source: string): Declaration {
  const pairs = new Map(
    parseContentSignalValue(raw).valid.map((p) => {
      const [k, v] = p.split('=');
      return [k, v] as const;
    }),
  );
  return {
    source,
    enforceable: false,
    train: yesNo(pairs.get('ai-train')),
    ground: yesNo(pairs.get('ai-input')),
    index: yesNo(pairs.get('search')),
  };
}

/** Read an AIPREF Content-Usage value into a declaration. AIPREF has no grounding category yet. */
export function fromContentUsage(raw: string, source: string): Declaration {
  const pairs = new Map(
    parseContentUsageValue(raw).valid.map((p) => {
      const [k, v] = p.split('=');
      return [k, v] as const;
    }),
  );
  return {
    source,
    enforceable: false,
    train: yesNo(pairs.get('train-ai')),
    ground: 'unstated',
    index: yesNo(pairs.get('search')),
  };
}

/**
 * Read RSL `permits` / `prohibits` usage tokens into a declaration.
 * `all` and `ai-all` set several dimensions at once.
 */
export function fromRsl(document: string, source: string): Declaration {
  const decl: Declaration = { source, enforceable: false, train: 'unstated', ground: 'unstated', index: 'unstated' };
  const body = document.replace(/<!--[\s\S]*?-->/g, '');

  for (const m of body.matchAll(/<(permits|prohibits)\b([^>]*)>([^<]*)</gi)) {
    const stance: Stance = m[1].toLowerCase() === 'permits' ? 'allow' : 'deny';
    const type = (getAttribute(m[2], 'type') ?? '').toLowerCase();
    if (type !== 'usage') continue;

    for (const token of m[3].trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      switch (token) {
        case 'ai-train':
          decl.train = stance;
          break;
        case 'ai-input':
          decl.ground = stance;
          break;
        case 'ai-index':
        case 'search':
          decl.index = stance;
          break;
        case 'ai-all':
          decl.train = stance;
          decl.ground = stance;
          break;
        case 'all':
          decl.train = stance;
          decl.ground = stance;
          decl.index = stance;
          break;
        default:
          break;
      }
    }
  }

  return decl;
}

/** Collect every usage declaration a site publishes. */
async function collect(ctx: CheckContext): Promise<{ declarations: Declaration[]; notes: Finding[] }> {
  const declarations: Declaration[] = [];
  const notes: Finding[] = [];

  /* robots.txt: Content-Signal and Content-Usage, per group. */
  const robotsRes = await ctx.fetch(`${ctx.url}/robots.txt`);
  const robots = robotsRes.ok ? parseRobotsTxt(robotsRes.body) : null;

  if (robots !== null) {
    for (const group of robots.groups) {
      const scope = group.userAgents.join(', ');
      for (const raw of group.contentSignals) {
        declarations.push(fromContentSignal(raw, `robots.txt Content-Signal (User-agent: ${scope})`));
      }
      for (const raw of group.contentUsage) {
        declarations.push(fromContentUsage(raw, `robots.txt Content-Usage (User-agent: ${scope})`));
      }
    }
  }

  /* HTTP headers: the Content-Usage response header, and Cloudflare's content-signal. */
  const headers = ctx.headers ?? {};
  if (headers['content-usage'] !== undefined) {
    declarations.push(fromContentUsage(headers['content-usage'], 'Content-Usage response header'));
    const dict = parseDictionary(headers['content-usage']);
    const bad = dict.members.filter(
      (m) => !AIPREF_TOKENS.includes(m.key) || !AIPREF_VALUES.includes(m.value.toLowerCase()),
    );
    if (bad.length > 0) {
      notes.push({
        status: 'warn',
        message: 'Content-Usage response header uses tokens outside the AIPREF vocabulary',
        detail: bad.map((m) => m.raw).join(', '),
        hint: 'The header takes a Structured Fields dictionary over train-ai and search with y/n values.',
        learnMoreUrl: guideUrl(meta.id, 'header-vocabulary'),
      });
    }
  }
  if (headers['content-signal'] !== undefined) {
    declarations.push(fromContentSignal(headers['content-signal'], 'content-signal response header'));
  }

  /* RSL licence, discovered the same three ways the rsl check uses. */
  const licenceUrl = findLicenceUrl(ctx, robots === null ? [] : collectLicenses(robots));
  if (licenceUrl !== null) {
    const doc = await ctx.fetch(licenceUrl);
    if (doc.ok && /<rsl[\s>]/i.test(doc.body)) {
      declarations.push(fromRsl(doc.body, `RSL licence (${licenceUrl})`));
    }
  }

  /* TDMRep: reservation is specifically about text-and-data-mining, i.e. training. */
  const tdm = await readTdmRep(ctx);
  if (tdm !== null) declarations.push(tdm);

  /* robots meta noai: a declared preference with no committed honorer. */
  const robotsMeta = (getMetaContent(ctx.html ?? '', 'robots') ?? '').toLowerCase();
  if (/\bnoai\b/.test(robotsMeta)) {
    declarations.push({
      source: '<meta name="robots" content="noai">',
      enforceable: false,
      train: 'deny',
      ground: 'unstated',
      index: 'unstated',
    });
  }

  return { declarations, notes };
}

/** Resolve the first RSL licence URL from robots.txt, the Link header, or an HTML link. */
function findLicenceUrl(ctx: CheckContext, robotsLicences: string[]): string | null {
  const candidates: string[] = [...robotsLicences];

  for (const entry of parseLinkHeader(ctx.headers?.['link'] ?? '')) {
    if (entry.params['rel'] === 'license' && (entry.params['type'] ?? '').includes(RSL_MIME)) {
      candidates.push(entry.url);
    }
  }
  for (const tag of findLinkTags(ctx.html ?? '', 'license')) {
    const type = (getAttribute(tag, 'type') ?? '').toLowerCase();
    const href = getAttribute(tag, 'href');
    if (type.includes(RSL_MIME) && href !== null) candidates.push(href);
  }

  if (candidates.length === 0) return null;
  try {
    return new URL(candidates[0], `${ctx.url}/`).toString();
  } catch {
    return null;
  }
}

/** Read a TDM reservation from headers, meta tags, or the well-known file (precedence: meta > header > file). */
async function readTdmRep(ctx: CheckContext): Promise<Declaration | null> {
  const metaValue = getMetaContent(ctx.html ?? '', 'tdm-reservation');
  if (metaValue !== null) {
    return {
      source: '<meta name="tdm-reservation">',
      enforceable: false,
      train: metaValue.trim() === '1' ? 'deny' : 'allow',
      ground: 'unstated',
      index: 'unstated',
    };
  }

  const header = ctx.headers?.['tdm-reservation'];
  if (header !== undefined) {
    return {
      source: 'tdm-reservation response header',
      enforceable: false,
      train: header.trim() === '1' ? 'deny' : 'allow',
      ground: 'unstated',
      index: 'unstated',
    };
  }

  const res = await ctx.fetch(`${ctx.url}/.well-known/tdmrep.json`);
  if (!res.ok) return null;
  try {
    const data = JSON.parse(res.body);
    if (!Array.isArray(data) || data.length === 0) return null;
    // The entry covering the site root governs the audited page.
    const root = data.find((e) => e?.location === '/' || e?.location === '') ?? data[0];
    const reserved = Number(root?.['tdm-reservation']);
    if (reserved !== 0 && reserved !== 1) return null;
    return {
      source: '/.well-known/tdmrep.json',
      enforceable: false,
      train: reserved === 1 ? 'deny' : 'allow',
      ground: 'unstated',
      index: 'unstated',
    };
  } catch {
    return null;
  }
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const { declarations, notes } = await collect(ctx);
  findings.push(...notes);

  if (declarations.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No machine-readable usage policy declared',
      detail:
        'Checked robots.txt Content-Signal and Content-Usage, the Content-Usage and content-signal response headers, ' +
        'an RSL licence, TDMRep, and the noai meta directive.',
      hint:
        'State your terms where they can be read without a lawyer. The lowest-effort option is a Content-Signal line ' +
        'in robots.txt: Content-Signal: search=yes, ai-input=yes, ai-train=no. Absence is neutral, not permission — ' +
        'but it also gives you nothing to point at.',
      learnMoreUrl: guideUrl(meta.id, 'no-policy'),
    });
    return buildResult(meta, 40, findings, start);
  }

  findings.push({
    status: 'pass',
    message: `${declarations.length} usage declaration(s) found`,
    detail: declarations.map((d) => d.source).join('\n'),
  });

  score = reportConsistency(declarations, findings, score);
  reportCoverage(declarations, findings);

  findings.push({
    status: 'pass',
    message: 'Enforcement note: only robots.txt access rules are documented as honored by major AI operators',
    detail:
      'Content Signals, AIPREF, RSL and TDMRep are declarations. Their weight is legal — the EU AI Act opt-out ' +
      'provisions and the GPAI Code of Practice reference several of them — rather than technical. Pair any of them ' +
      'with robots.txt rules if the intent is to be enforced.',
  });

  return buildResult(meta, score, findings, start);
}

/**
 * Report where two declarations answer the same question differently. This is
 * the finding this check exists for: contradictory published positions mean the
 * terms a crawler honors depend on which file it happened to read.
 */
function reportConsistency(declarations: Declaration[], findings: Finding[], score: number): number {
  let conflicts = 0;

  for (const dimension of ['train', 'ground', 'index'] as Dimension[]) {
    const allow = declarations.filter((d) => d[dimension] === 'allow');
    const deny = declarations.filter((d) => d[dimension] === 'deny');

    if (allow.length > 0 && deny.length > 0) {
      conflicts++;
      findings.push({
        status: 'fail',
        message: `Your signals disagree about ${DIMENSION_LABEL[dimension]}`,
        detail: [
          `Permitted by: ${allow.map((d) => d.source).join('; ')}`,
          `Denied by: ${deny.map((d) => d.source).join('; ')}`,
        ].join('\n'),
        hint:
          'Two of your published documents state opposite terms, so which one applies depends on which file a crawler ' +
          'reads. Pick the position you mean and make every mechanism say it.',
        learnMoreUrl: guideUrl(meta.id, 'contradiction'),
      });
      continue;
    }

    if (allow.length + deny.length > 0) {
      const stance = allow.length > 0 ? 'permitted' : 'denied';
      findings.push({
        status: 'pass',
        message: `Consistent across ${allow.length + deny.length} declaration(s): ${DIMENSION_LABEL[dimension]} is ${stance}`,
      });
    }
  }

  return score - conflicts * 25;
}

/** Note the dimensions no declaration answers, and the vocabularies that cannot answer them. */
function reportCoverage(declarations: Declaration[], findings: Finding[]): void {
  const unstated = (['train', 'ground', 'index'] as Dimension[]).filter((d) =>
    declarations.every((decl) => decl[d] === 'unstated'),
  );
  if (unstated.length === 0) return;

  findings.push({
    status: 'warn',
    message: `No declaration covers ${unstated.map((d) => DIMENSION_LABEL[d]).join(' or ')}`,
    detail:
      unstated.includes('ground') && declarations.every((d) => !d.source.includes('Content-Signal'))
        ? 'Grounding is the dimension that decides whether an assistant may quote you in an answer. AIPREF has no category for it yet; Content Signals ai-input and RSL ai-input do.'
        : undefined,
    hint: 'An unstated dimension is "unknown", never "allowed". State it explicitly if you have a position on it.',
    learnMoreUrl: guideUrl(meta.id, 'coverage'),
  });
}
