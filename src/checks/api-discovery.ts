import { API_DESCRIPTION_PATHS, LINKSET_MEDIA_TYPE } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult, checkContentType } from './utils.js';
import { findLinkTags, getAttribute } from './html-utils.js';
import { parseLinkHeader } from './http-headers.js';
import { standingNote } from './well-known.js';

/**
 * "api-discovery" — can an agent find, and read, this site's API description?
 *
 * The check used to probe exactly one path, `/.well-known/openapi.json`. That
 * path is a folk convention: it is not in the IANA well-known registry, and the
 * OpenAPI specification itself recommends the file be named `openapi.json` or
 * `openapi.yaml` without prescribing a location. So a site doing everything
 * right at `/openapi.json` scored zero.
 *
 * There *is* a registered mechanism: RFC 9727 defines `/.well-known/api-catalog`,
 * a linkset of the APIs a publisher offers, each entry pointing at a
 * machine-readable description via `service-desc` and human documentation via
 * `service-doc` (RFC 8631). Adoption is tiny — a handful of publishers — but it
 * is the only standards-track answer, and checking it costs one request.
 *
 * The check therefore walks discovery in order of authority: the registered
 * catalog, then RFC 8631 link relations in headers and HTML, then the
 * conventional file locations. Whatever it finds, it validates the same way, so
 * broadening discovery can only raise a score, never lower one.
 */
export const meta: CheckMeta = {
  id: 'api-discovery',
  name: 'API Discovery',
  description: 'Checks how agents discover an API description (RFC 9727 catalog, service-desc links, OpenAPI)',
  weight: 6,
  category: 'protocols',
  aliases: ['openapi'],
};

type Mechanism = 'api-catalog' | 'link-header' | 'html-link' | 'conventional-path';

const MECHANISM_LABEL: Record<Mechanism, string> = {
  'api-catalog': '/.well-known/api-catalog (RFC 9727)',
  'link-header': 'Link header rel="service-desc"',
  'html-link': '<link rel="service-desc">',
  'conventional-path': 'conventional file path',
};

interface Located {
  mechanism: Mechanism;
  path: string;
  res: FetchResponse;
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, `${base}/`).toString();
  } catch {
    return url;
  }
}

/**
 * Follow the discovery chain. Returns the description document plus how it was
 * found, and separately whether a catalog exists at all, since a catalog is
 * worth reporting even when its entries lead nowhere.
 */
async function locate(ctx: CheckContext): Promise<{ found: Located | null; catalog: FetchResponse | null }> {
  // 1. RFC 9727 — the registered mechanism.
  const catalogRes = await ctx.fetch(`${ctx.url}/.well-known/api-catalog`);
  const catalog = catalogRes.ok && catalogRes.body.trim().length > 0 ? catalogRes : null;

  if (catalog !== null) {
    for (const href of serviceDescsFromLinkset(catalog.body)) {
      const res = await ctx.fetch(absolute(href, ctx.url));
      if (res.ok && res.body.trim().length > 0) {
        return { found: { mechanism: 'api-catalog', path: href, res }, catalog };
      }
    }
  }

  // 2. RFC 8631 link relations, in the response header then the HTML head.
  for (const entry of parseLinkHeader(ctx.headers['link'] ?? '')) {
    if (entry.params['rel'] !== 'service-desc') continue;
    const res = await ctx.fetch(absolute(entry.url, ctx.url));
    if (res.ok && res.body.trim().length > 0) {
      return { found: { mechanism: 'link-header', path: entry.url, res }, catalog };
    }
  }

  for (const tag of findLinkTags(ctx.html, 'service-desc')) {
    const href = getAttribute(tag, 'href');
    if (href === null) continue;
    const res = await ctx.fetch(absolute(href, ctx.url));
    if (res.ok && res.body.trim().length > 0) {
      return { found: { mechanism: 'html-link', path: href, res }, catalog };
    }
  }

  // 3. Conventional locations, registered path first.
  for (const path of API_DESCRIPTION_PATHS) {
    const res = await ctx.fetch(`${ctx.url}${path}`);
    if (res.ok && res.body.trim().length > 0 && looksLikeApiDescription(res.body)) {
      return { found: { mechanism: 'conventional-path', path, res }, catalog };
    }
  }

  return { found: null, catalog };
}

/** Pull `service-desc` hrefs out of an RFC 9264 linkset document. */
export function serviceDescsFromLinkset(body: string): string[] {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const linkset = Array.isArray(data.linkset) ? (data.linkset as Record<string, unknown>[]) : [];
    return linkset.flatMap((entry) => {
      const descs = Array.isArray(entry['service-desc']) ? (entry['service-desc'] as Record<string, unknown>[]) : [];
      return descs.map((d) => String(d.href ?? '')).filter((h) => h !== '');
    });
  } catch {
    return [];
  }
}

/**
 * Guard against a conventional path returning a web page rather than a
 * description. A 200 from `/api-docs` is usually a Swagger UI page, and on an
 * SPA every unknown path returns the index shell — accepting either would turn
 * "no API description" into a confusing validation failure.
 *
 * Anything that is not HTML is handed to validation, which reports its own
 * problems precisely. This guard only rejects documents that are definitely a
 * page.
 */
function looksLikeApiDescription(body: string): boolean {
  const head = body.slice(0, 4096).trimStart();
  return !/^(<!doctype html|<html[\s>])/i.test(head) && !/<html[\s>]/i.test(head.slice(0, 512));
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const { found, catalog } = await locate(ctx);

  if (catalog !== null) {
    score = reportCatalog(catalog, findings, score);
  }

  if (found === null) {
    findings.push({
      status: 'fail',
      message: 'No machine-readable API description found',
      detail: `Checked /.well-known/api-catalog, Link and <link> rel="service-desc", and ${API_DESCRIPTION_PATHS.join(', ')}`,
      hint:
        'If your site offers an API, publish an OpenAPI description an agent can read without a human reading your docs. ' +
        'Serve it at /openapi.json and advertise it with a Link header: Link: </openapi.json>; rel="service-desc". ' +
        'For several APIs, publish an RFC 9727 catalog at /.well-known/api-catalog.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({
    status: 'pass',
    message: `API description found at ${found.path} via ${MECHANISM_LABEL[found.mechanism]}`,
    detail: standingNote(found.path),
  });

  if (found.mechanism === 'conventional-path' && catalog === null) {
    findings.push({
      status: 'warn',
      message: 'API description is only discoverable by guessing its path',
      hint:
        'Nothing on the site points at it, so an agent has to try known filenames. Advertise it with a Link header ' +
        '(Link: <…>; rel="service-desc") or a <link rel="service-desc"> tag, and for multiple APIs an RFC 9727 catalog.',
      learnMoreUrl: guideUrl(meta.id, 'undiscoverable'),
    });
  }

  return validateDescription(found, findings, score, start);
}

/** Report an RFC 9727 catalog: its media type, shape, and entry completeness. */
function reportCatalog(res: FetchResponse, findings: Finding[], score: number): number {
  const ct = (res.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes(LINKSET_MEDIA_TYPE) && !ct.includes('application/json')) {
    findings.push({
      status: 'warn',
      message: `/.well-known/api-catalog served as "${ct.split(';')[0] || 'no Content-Type'}"`,
      detail: `RFC 9727 requires support for ${LINKSET_MEDIA_TYPE}.`,
      hint: `Serve the catalog as ${LINKSET_MEDIA_TYPE}.`,
      learnMoreUrl: guideUrl(meta.id, 'catalog-content-type'),
    });
    return score;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'warn',
      message: '/.well-known/api-catalog is not valid JSON',
      hint: 'The catalog must be a JSON linkset per RFC 9264.',
      learnMoreUrl: guideUrl(meta.id, 'catalog-invalid'),
    });
    return score;
  }

  const linkset = Array.isArray(data.linkset) ? (data.linkset as Record<string, unknown>[]) : [];
  if (linkset.length === 0) {
    findings.push({
      status: 'warn',
      message: 'API catalog present but its linkset is empty',
      hint: 'Each linkset entry needs an anchor and at least one service-desc or service-doc link.',
      learnMoreUrl: guideUrl(meta.id, 'catalog-empty'),
    });
    return score;
  }

  findings.push({
    status: 'pass',
    message: `RFC 9727 API catalog lists ${linkset.length} API(s)`,
    detail: standingNote('/.well-known/api-catalog'),
  });

  const noAnchor = linkset.filter((e) => typeof e.anchor !== 'string' || e.anchor === '').length;
  if (noAnchor > 0) {
    findings.push({
      status: 'warn',
      message: `${noAnchor} catalog entry(ies) missing an anchor`,
      hint: 'Every linkset entry needs an "anchor" identifying the API it describes.',
      learnMoreUrl: guideUrl(meta.id, 'catalog-anchor'),
    });
  }

  const noDocs = linkset.filter((e) => !Array.isArray(e['service-doc'])).length;
  if (noDocs > 0) {
    findings.push({
      status: 'warn',
      message: `${noDocs} catalog entry(ies) have no service-doc link`,
      hint: 'Pair each service-desc (machine-readable) with a service-doc (human-readable). Agents surface the latter to users.',
      learnMoreUrl: guideUrl(meta.id, 'catalog-service-doc'),
    });
  }

  return score;
}

/**
 * Validate the description document. The deduction table is unchanged from the
 * pre-3.7 OpenAPI check, so a site that scored under the old single-path check
 * scores identically now.
 */
function validateDescription(located: Located, findings: Finding[], score: number, start: number): CheckResult {
  const { res, path } = located;
  const isYaml = /\.ya?ml$/i.test(path) || /^\s*openapi\s*:/im.test(res.body);

  if (!isYaml) {
    const ctFinding = checkContentType(res, ['application/json'], {
      checkId: meta.id,
      resourceLabel: path,
      anchor: 'wrong-content-type',
    });
    if (ctFinding) {
      findings.push(ctFinding);
      score -= 5;
    }
  }

  if (isYaml) {
    // ax-audit carries no YAML parser (zero runtime dependencies beyond chalk
    // and commander). Report what can be read from the surface and say plainly
    // that the document was not fully validated, rather than guessing.
    return reportYamlDescription(res.body, path, findings, score, start);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'fail',
      message: `Invalid JSON in ${path}`,
      hint: 'Fix the JSON syntax. Validate with a JSON linter or an OpenAPI validator.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }
  findings.push({ status: 'pass', message: 'Valid JSON' });

  score = validateOpenApi(data, findings, score);
  return buildResult(meta, score, findings, start);
}

/** Shared OpenAPI/Swagger field rules. */
function validateOpenApi(data: Record<string, unknown>, findings: Finding[], score: number): number {
  const version =
    typeof data.openapi === 'string' ? data.openapi : typeof data.swagger === 'string' ? data.swagger : null;

  if (version === null) {
    findings.push({
      status: 'fail',
      message: 'No "openapi" or "swagger" version field',
      hint: 'Add an "openapi" field naming the specification version, for example "3.1.0".',
      learnMoreUrl: guideUrl(meta.id, 'no-version'),
    });
    score -= 20;
  } else if (typeof data.swagger === 'string') {
    findings.push({
      status: 'warn',
      message: `Swagger ${version} rather than OpenAPI 3.x`,
      hint: 'Convert to OpenAPI 3.1 or 3.2. Tooling support for Swagger 2.0 is fading, and 3.1 aligns with JSON Schema.',
      learnMoreUrl: guideUrl(meta.id, 'swagger-2'),
    });
    score -= 10;
  } else {
    findings.push({ status: 'pass', message: `OpenAPI ${version}` });
    if (version.startsWith('3.2') && data.$self !== undefined) {
      findings.push({ status: 'pass', message: '$self declared (OpenAPI 3.2 self-identifying document)' });
    }
  }

  const info = (data.info ?? {}) as Record<string, unknown>;
  if (info.title) {
    findings.push({ status: 'pass', message: `API title: "${String(info.title)}"` });
  } else {
    findings.push({
      status: 'warn',
      message: 'Missing info.title',
      hint: 'Add info.title naming the API. Agents show it when choosing between tools.',
      learnMoreUrl: guideUrl(meta.id, 'no-title'),
    });
    score -= 10;
  }

  if (info.description) {
    findings.push({ status: 'pass', message: 'API description present' });
  } else {
    findings.push({
      status: 'warn',
      message: 'Missing info.description',
      hint: 'Add info.description explaining what the API does. This is the text an agent reads to decide whether to use it.',
      learnMoreUrl: guideUrl(meta.id, 'no-description'),
    });
    score -= 5;
  }

  const paths = (data.paths ?? {}) as Record<string, unknown>;
  const pathCount = Object.keys(paths).length;
  if (pathCount > 0) {
    findings.push({ status: 'pass', message: `${pathCount} path(s) documented` });
    reportOperationIds(paths, findings);
  } else {
    findings.push({
      status: 'warn',
      message: 'No paths documented',
      hint: 'Document your endpoints under "paths". A description with no operations tells an agent nothing it can act on.',
      learnMoreUrl: guideUrl(meta.id, 'no-paths'),
    });
    score -= 15;
  }

  if (Array.isArray(data.servers) && data.servers.length > 0) {
    findings.push({ status: 'pass', message: `${data.servers.length} server URL(s) declared` });
  } else {
    findings.push({
      status: 'warn',
      message: 'No servers declared',
      hint: 'Add a "servers" array with the base URL. Without it an agent has to guess where to send requests.',
      learnMoreUrl: guideUrl(meta.id, 'no-servers'),
    });
    score -= 5;
  }

  const components = (data.components ?? {}) as Record<string, unknown>;
  if (components.securitySchemes !== undefined || data.security !== undefined) {
    findings.push({ status: 'pass', message: 'Authentication requirements declared' });
  }

  return score;
}

/**
 * Operation ids are how an agent names a call. Informational in 3.x: this is a
 * new finding inside a weighted check, so it must not deduct.
 */
function reportOperationIds(paths: Record<string, unknown>, findings: Finding[]): void {
  const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
  let total = 0;
  let named = 0;

  for (const item of Object.values(paths)) {
    if (typeof item !== 'object' || item === null) continue;
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!methods.has(method.toLowerCase())) continue;
      total++;
      if (typeof (op as Record<string, unknown>)?.operationId === 'string') named++;
    }
  }

  if (total === 0) return;
  if (named === total) {
    findings.push({ status: 'pass', message: `All ${total} operations have an operationId` });
  } else {
    findings.push({
      status: 'warn',
      message: `${named}/${total} operations have an operationId`,
      hint: 'Give every operation a stable operationId. Agents and code generators use it as the function name; without one they invent one from the path and it changes under them.',
      learnMoreUrl: guideUrl(meta.id, 'operation-ids'),
    });
  }
}

/** Surface-level reporting for a YAML description, clearly labelled as partial. */
function reportYamlDescription(
  body: string,
  path: string,
  findings: Finding[],
  score: number,
  start: number,
): CheckResult {
  const version = body.match(/^\s*openapi\s*:\s*["']?([\d.]+)/im);
  const hasTitle = /^\s{2,}title\s*:/im.test(body);
  const hasPaths = /^paths\s*:/im.test(body);
  const hasServers = /^servers\s*:/im.test(body);

  findings.push({
    status: 'pass',
    message: version ? `OpenAPI ${version[1]} (YAML)` : 'YAML API description',
    detail:
      'ax-audit ships no YAML parser, so a YAML description is reported but not fully validated. Publish JSON alongside it for complete checking.',
  });

  if (!hasTitle) {
    findings.push({
      status: 'warn',
      message: 'No info.title found in the YAML description',
      hint: 'Add info.title naming the API.',
      learnMoreUrl: guideUrl(meta.id, 'no-title'),
    });
    score -= 10;
  }
  if (!hasPaths) {
    findings.push({
      status: 'warn',
      message: 'No paths section found in the YAML description',
      hint: 'Document your endpoints under "paths".',
      learnMoreUrl: guideUrl(meta.id, 'no-paths'),
    });
    score -= 15;
  }
  if (!hasServers) {
    findings.push({
      status: 'warn',
      message: 'No servers section found in the YAML description',
      hint: 'Add a "servers" list with the base URL.',
      learnMoreUrl: guideUrl(meta.id, 'no-servers'),
    });
    score -= 5;
  }
  if (!version) {
    findings.push({
      status: 'warn',
      message: 'No openapi version field found in the YAML description',
      hint: 'Add an "openapi" field naming the specification version.',
      learnMoreUrl: guideUrl(meta.id, 'no-version'),
    });
    score -= 20;
  }

  void path;
  return buildResult(meta, score, findings, start);
}
