import { AI_CATALOG_ENTRY_TYPES } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult, isHtmlDocument } from './utils.js';
import { findLinkTags, getAttribute } from './html-utils.js';
import { parseLinkHeader } from './http-headers.js';
import { parseRobotsTxt } from './robots-parser.js';
import { standingNote } from './well-known.js';

/**
 * "ai-catalog" — one document listing everything an agent can call on this
 * site.
 *
 * Every protocol arrived with its own discovery file: an A2A card here, an MCP
 * server card there, an API catalog somewhere else, a skills index in a fourth
 * place. An agent that wants to know what a site offers has to know all four
 * conventions in advance and probe each one.
 *
 * Two efforts are converging on a single index. The Linux Foundation's Agent
 * Card working group specifies `/.well-known/ai-catalog.json`; Agentic Resource
 * Discovery, with Google, Microsoft and Hugging Face listed, specifies
 * `/.well-known/ard.json`. They overlap heavily and neither has won. Google's
 * own Lighthouse ships an `ard-schema` audit that accepts four discovery routes
 * — a robots.txt `Agentmap:` directive, an `ai-catalog` link relation in the
 * header or the HTML, or the well-known path — so this check accepts all of
 * them too.
 *
 * Both are drafts, so the check is informational and its absence is never a
 * defect. What it *can* do usefully today is catch a catalog that lies: an
 * entry pointing at a document that 404s, or whose media type does not match
 * what the entry claims. A broken index is worse than no index, because an
 * agent trusts it before it fetches.
 */
export const meta: CheckMeta = {
  id: 'ai-catalog',
  name: 'AI Catalog',
  description: 'Checks the agent resource catalog (ai-catalog.json / ard.json) and whether its entries resolve',
  category: 'protocols',
};

type Mechanism = 'robots-agentmap' | 'link-header' | 'html-link' | 'well-known';

const MECHANISM_LABEL: Record<Mechanism, string> = {
  'robots-agentmap': 'robots.txt Agentmap: directive',
  'link-header': 'Link header rel="ai-catalog"',
  'html-link': '<link rel="ai-catalog">',
  'well-known': 'well-known path',
};

const WELL_KNOWN_PATHS = ['/.well-known/ai-catalog.json', '/.well-known/ard.json'];

/** Entries whose URL should resolve, with the media type they promise. */
interface Entry {
  identifier: string;
  type: string;
  displayName: string;
  url?: string;
  inline: boolean;
}

interface Located {
  mechanism: Mechanism;
  url: string;
  res: FetchResponse;
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, `${base}/`).toString();
  } catch {
    return url;
  }
}

async function fetchDocument(ctx: CheckContext, url: string): Promise<FetchResponse | null> {
  const res = await ctx.fetch(url);
  if (!res.ok || res.body.trim().length === 0 || isHtmlDocument(res.body)) return null;
  return res;
}

/** Try every documented discovery route, in the order Lighthouse's audit uses. */
async function locate(ctx: CheckContext): Promise<Located | null> {
  const robotsRes = await ctx.fetch(`${ctx.url}/robots.txt`);
  if (robotsRes.ok) {
    for (const target of parseRobotsTxt(robotsRes.body).agentmaps) {
      const url = absolute(target, ctx.url);
      const res = await fetchDocument(ctx, url);
      if (res !== null) return { mechanism: 'robots-agentmap', url, res };
    }
  }

  for (const entry of parseLinkHeader(ctx.headers?.['link'] ?? '')) {
    const rel = (entry.params['rel'] ?? '').split(/\s+/);
    if (!rel.includes('ai-catalog') && !rel.includes('ard')) continue;
    const url = absolute(entry.url, ctx.url);
    const res = await fetchDocument(ctx, url);
    if (res !== null) return { mechanism: 'link-header', url, res };
  }

  for (const rel of ['ai-catalog', 'ard']) {
    for (const tag of findLinkTags(ctx.html ?? '', rel)) {
      const href = getAttribute(tag, 'href');
      if (href === null) continue;
      const url = absolute(href, ctx.url);
      const res = await fetchDocument(ctx, url);
      if (res !== null) return { mechanism: 'html-link', url, res };
    }
  }

  for (const path of WELL_KNOWN_PATHS) {
    const res = await fetchDocument(ctx, `${ctx.url}${path}`);
    if (res !== null) return { mechanism: 'well-known', url: `${ctx.url}${path}`, res };
  }

  return null;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const found = await locate(ctx);

  if (found === null) {
    findings.push({
      status: 'warn',
      message: 'No agent resource catalog found',
      detail: `Checked ${Object.values(MECHANISM_LABEL).join(', ')} and ${WELL_KNOWN_PATHS.join(', ')}. Both specifications are drafts.`,
      hint:
        'A catalog is one document listing everything an agent can call here — agent cards, MCP servers, APIs, skills — ' +
        'so a client stops probing four conventions to find out. Worth publishing once you have more than one of those. ' +
        'Informational: both ai-catalog.json and ard.json are still drafts, so this never affects your score.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({
    status: 'pass',
    message: `Agent resource catalog found via ${MECHANISM_LABEL[found.mechanism]}`,
    detail: [found.url, standingNote(new URL(found.url).pathname)].filter(Boolean).join(' — '),
  });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(found.res.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'fail',
      message: 'Catalog is not valid JSON',
      hint: 'Fix the JSON syntax. A catalog an agent cannot parse is worse than none, because it is fetched first.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }

  score = validateShape(data, findings, score);
  score = await resolveEntries(ctx, readEntries(data), findings, score);

  return buildResult(meta, score, findings, start);
}

function readEntries(data: Record<string, unknown>): Entry[] {
  const raw = Array.isArray(data.entries) ? (data.entries as Record<string, unknown>[]) : [];
  return raw.map((e) => ({
    identifier: String(e.identifier ?? ''),
    type: String(e.type ?? ''),
    displayName: String(e.displayName ?? e.identifier ?? '(unnamed)'),
    url: typeof e.url === 'string' ? e.url : undefined,
    inline: e.data !== undefined,
  }));
}

function validateShape(data: Record<string, unknown>, findings: Finding[], score: number): number {
  if (data.specVersion === undefined) {
    findings.push({
      status: 'warn',
      message: 'Catalog declares no specVersion',
      hint: 'Add "specVersion": "1.0" so a consumer knows which revision to expect. Both drafts are moving.',
      learnMoreUrl: guideUrl(meta.id, 'no-spec-version'),
    });
    score -= 5;
  }

  const host = (data.host ?? {}) as Record<string, unknown>;
  if (host.identifier === undefined && host.displayName === undefined) {
    findings.push({
      status: 'warn',
      message: 'Catalog declares no host',
      hint: 'Add host.displayName and host.identifier so an agent can attribute the resources it finds.',
      learnMoreUrl: guideUrl(meta.id, 'no-host'),
    });
    score -= 5;
  }

  return score;
}

/**
 * Fetch what each entry points at. This is the part of the check that earns its
 * keep: an agent trusts a catalog before it fetches, so a dead entry sends it
 * somewhere that does not exist.
 */
async function resolveEntries(
  ctx: CheckContext,
  entries: Entry[],
  findings: Finding[],
  score: number,
): Promise<number> {
  if (entries.length === 0) {
    findings.push({
      status: 'warn',
      message: 'Catalog has no entries',
      hint: 'An empty catalog advertises nothing. List your agent cards, MCP servers, API descriptions and skills.',
      learnMoreUrl: guideUrl(meta.id, 'empty'),
    });
    return score - 20;
  }

  findings.push({ status: 'pass', message: `Catalog lists ${entries.length} resource(s)` });

  const incomplete = entries.filter((e) => e.identifier === '' || e.type === '' || (e.url === undefined && !e.inline));
  if (incomplete.length > 0) {
    findings.push({
      status: 'warn',
      message: `${incomplete.length} entry(ies) missing identifier, type, or url/data`,
      detail: incomplete.map((e) => e.displayName).join(', '),
      hint: 'Every entry needs an identifier, a media type, and either an inline data object or a url.',
      learnMoreUrl: guideUrl(meta.id, 'incomplete-entry'),
    });
    score -= 10;
  }

  const unknownTypes = [
    ...new Set(entries.map((e) => e.type).filter((t) => t !== '' && !(t in AI_CATALOG_ENTRY_TYPES))),
  ];
  if (unknownTypes.length > 0) {
    findings.push({
      status: 'warn',
      message: 'Entry with an unrecognised media type',
      detail: unknownTypes.join(', '),
      hint: `Known types: ${Object.keys(AI_CATALOG_ENTRY_TYPES).join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'entry-type'),
    });
    score -= 5;
  }

  // Resolve at most five referenced documents; a catalog with more is unusual
  // and the point is made by a sample.
  const linked = entries.filter((e) => e.url !== undefined).slice(0, 5);
  const dead: string[] = [];
  const mistyped: string[] = [];

  for (const entry of linked) {
    const url = absolute(entry.url!, ctx.url);
    const res = await ctx.fetch(url, { method: 'HEAD' });
    // Some origins refuse HEAD; fall back to GET rather than reporting a
    // working document as dead.
    const effective = res.status === 405 || res.status === 501 ? await ctx.fetch(url) : res;

    if (!effective.ok) {
      dead.push(`${entry.displayName} → ${url} (HTTP ${effective.status || 'network error'})`);
      continue;
    }
    const ct = (effective.headers['content-type'] ?? '').toLowerCase();
    if (entry.type !== '' && ct !== '' && !ct.includes(entry.type) && !ct.includes('application/json')) {
      mistyped.push(`${entry.displayName}: claims ${entry.type}, served ${ct.split(';')[0]}`);
    }
  }

  if (dead.length > 0) {
    findings.push({
      status: 'fail',
      message: `${dead.length} catalog entry(ies) point at a document that cannot be fetched`,
      detail: dead.join('\n'),
      hint:
        'An agent reads the catalog before it reads anything else, so a dead entry sends it somewhere that does not ' +
        'exist. Fix the URL or remove the entry.',
      learnMoreUrl: guideUrl(meta.id, 'dead-entry'),
    });
    score -= 15 * dead.length;
  } else if (linked.length > 0) {
    findings.push({ status: 'pass', message: `All ${linked.length} referenced document(s) resolve` });
  }

  if (mistyped.length > 0) {
    findings.push({
      status: 'warn',
      message: `${mistyped.length} entry(ies) served with a different media type than declared`,
      detail: mistyped.join('\n'),
      hint: 'Serve each referenced document with the media type its catalog entry claims, so a client can dispatch on it without sniffing.',
      learnMoreUrl: guideUrl(meta.id, 'entry-mistyped'),
    });
    score -= 5;
  }

  return score;
}
