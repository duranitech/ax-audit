import {
  AI_CATALOG_ENTRY_TYPES,
  MCP_PROTOCOL_VERSIONS,
  MCP_REMOTE_TYPES,
  MCP_SERVER_CARD_MEDIA_TYPE,
  MCP_SERVER_CARD_REQUIRED,
  MCP_STALE_PROTOCOL_VERSIONS,
} from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult, checkContentType, isHtmlDocument, notApplicable } from './utils.js';
import { hasMcpSurface } from './surface.js';
import { standingNote } from './well-known.js';

/**
 * "mcp-discovery" — how an agent finds this site's MCP server.
 *
 * ax-audit used to look for `/.well-known/mcp.json` and validate a `tools[]`
 * array inside it. That path was never part of the Model Context Protocol
 * specification — it was a plausible-looking convention that several tools,
 * this one included, recommended before the ecosystem settled. Advertising
 * static tool lists was the wrong idea anyway: tools come from a live
 * `tools/list` call, and a copy in a static file starts drifting the day it is
 * written.
 *
 * What actually emerged is the **server card**: a small document identifying
 * the server and listing its remote endpoints, deliberately without tools.
 * SEP-2127 and the `experimental-ext-server-card` repository recommend serving
 * it at `<streamable-http-url>/server-card`, or referencing it from
 * `/.well-known/ai-catalog.json`. Cloudflare and Mintlify serve one at
 * `/.well-known/mcp/server-card.json`.
 *
 * All of that is still draft, and drafts get renamed — so this check probes the
 * whole chain, labels each hit with its standing, and never treats one draft
 * path as the single correct answer.
 *
 * Scoring note for 3.x: a site whose only MCP document is the legacy
 * `/.well-known/mcp.json` is validated with the pre-3.7 rules, so its score is
 * exactly what 3.6 produced. The path itself is reported, not penalised.
 */
export const meta: CheckMeta = {
  id: 'mcp-discovery',
  name: 'MCP Discovery',
  description: 'Checks how AI agents discover this site’s Model Context Protocol server',
  category: 'protocols',
  aliases: ['mcp'],
};

/** How a document was found, and how much weight that mechanism carries. */
type Mechanism =
  | 'ai-catalog'
  | 'well-known-server-card'
  | 'well-known-server-cards'
  | 'endpoint-server-card'
  | 'legacy-manifest';

interface Located {
  mechanism: Mechanism;
  path: string;
  res: FetchResponse;
}

const MECHANISM_LABEL: Record<Mechanism, string> = {
  'ai-catalog': '/.well-known/ai-catalog.json entry',
  'well-known-server-card': '/.well-known/mcp/server-card.json',
  'well-known-server-cards': '/.well-known/mcp/server-cards.json',
  'endpoint-server-card': '<endpoint>/server-card',
  'legacy-manifest': '/.well-known/mcp.json',
};

/** Endpoint paths worth trying a server card against, in order of convention strength. */
const ENDPOINT_CANDIDATES = ['/mcp', '/api/mcp', '/sse'];

/**
 * Fetch a probe path, treating an HTML response as "not present". An SPA
 * catch-all answers every unknown path with its index shell, and accepting one
 * would report a malformed server card on a site that has no MCP server at all.
 */
async function fetchIfPresent(ctx: CheckContext, path: string): Promise<FetchResponse | null> {
  const res = await ctx.fetch(`${ctx.url}${path}`);
  if (!res.ok || res.body.trim().length === 0) return null;
  return isHtmlDocument(res.body) ? null : res;
}

/**
 * Walk the discovery chain. Returns every mechanism that produced a document,
 * so the report can say which ones work and which are missing rather than
 * stopping at the first hit.
 */
async function locate(ctx: CheckContext): Promise<Located[]> {
  const found: Located[] = [];

  const catalog = await fetchIfPresent(ctx, '/.well-known/ai-catalog.json');
  if (catalog !== null && mentionsMcpEntry(catalog.body)) {
    found.push({ mechanism: 'ai-catalog', path: '/.well-known/ai-catalog.json', res: catalog });
  }

  for (const [mechanism, path] of [
    ['well-known-server-card', '/.well-known/mcp/server-card.json'],
    ['well-known-server-cards', '/.well-known/mcp/server-cards.json'],
  ] as [Mechanism, string][]) {
    const res = await fetchIfPresent(ctx, path);
    if (res !== null) found.push({ mechanism, path, res });
  }

  for (const endpoint of ENDPOINT_CANDIDATES) {
    const path = `${endpoint}/server-card`;
    const res = await fetchIfPresent(ctx, path);
    if (res !== null) {
      found.push({ mechanism: 'endpoint-server-card', path, res });
      break;
    }
  }

  const legacy = await fetchIfPresent(ctx, '/.well-known/mcp.json');
  if (legacy !== null) found.push({ mechanism: 'legacy-manifest', path: '/.well-known/mcp.json', res: legacy });

  return found;
}

/** Does an ai-catalog document reference an MCP server card? */
function mentionsMcpEntry(body: string): boolean {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const entries = Array.isArray(data.entries) ? (data.entries as Record<string, unknown>[]) : [];
    return entries.some((e) => String(e.type ?? '') === MCP_SERVER_CARD_MEDIA_TYPE);
  } catch {
    return false;
  }
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];

  const found = await locate(ctx);

  if (found.length === 0) {
    const surface = await hasMcpSurface(ctx);
    if (!surface.found) {
      findings.push({
        status: 'pass',
        message: 'No MCP server — MCP discovery does not apply to this site',
        detail:
          'A server card describes an MCP server so agents can find it. A site that runs none has nothing to ' +
          'advertise. Run with --profile mcp to audit as though it did.',
      });
      return notApplicable(meta, findings, start);
    }

    findings.push({
      status: 'fail',
      message: 'MCP server present but not discoverable',
      detail: `Evidence of a server: ${surface.reason}.`,
      hint:
        'Agents have to be told the URL by a human. Publish a server card so they can find it. ' +
        'Serve it at <your-mcp-endpoint>/server-card with Content-Type: application/mcp-server-card+json, and ' +
        'reference it from /.well-known/ai-catalog.json. A card declares $schema, name (reverse-DNS), version, ' +
        'description and remotes[] — not tools, which agents read live from tools/list.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const modern = found.filter((f) => f.mechanism !== 'legacy-manifest');

  // A site whose only document is the pre-standard manifest is scored exactly
  // as 3.6 scored it, so the correction to the discovery model cannot move an
  // existing score. The path itself is reported, not penalised.
  if (modern.length === 0) {
    return validateLegacyManifest(found[0], findings, start);
  }

  findings.push({
    status: 'pass',
    message: `MCP server discoverable via ${modern.map((m) => MECHANISM_LABEL[m.mechanism]).join(' + ')}`,
    detail: standingNote(modern[0].path),
  });

  if (found.some((f) => f.mechanism === 'legacy-manifest')) {
    findings.push({
      status: 'warn',
      message: '/.well-known/mcp.json is also served, and is not a specified path',
      detail: standingNote('/.well-known/mcp.json'),
      hint: 'Now that a server card is published, the ad-hoc manifest can be removed to avoid two sources of truth.',
      learnMoreUrl: guideUrl(meta.id, 'legacy-manifest'),
    });
  }

  return validateServerCard(modern[0], findings, start);
}

/** Validate a server card per the MCP server-card extension schema. */
function validateServerCard(located: Located, findings: Finding[], start: number): CheckResult {
  let score = 100;
  const { res, path, mechanism } = located;

  const acceptable =
    mechanism === 'ai-catalog'
      ? ['application/json', 'application/ai-catalog+json']
      : ['application/json', MCP_SERVER_CARD_MEDIA_TYPE];
  const ctFinding = checkContentType(res, acceptable, {
    checkId: meta.id,
    resourceLabel: path,
    anchor: 'wrong-content-type',
  });
  if (ctFinding) {
    findings.push(ctFinding);
    score -= 5;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'fail',
      message: `Invalid JSON in ${path}`,
      hint: 'Fix the JSON syntax. Validate with a JSON linter.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }
  findings.push({ status: 'pass', message: 'Valid JSON' });

  if (mechanism === 'ai-catalog') {
    return validateCatalog(data, findings, score, start);
  }

  // `server-cards.json` holds an array; a single card is the object itself.
  const cards = Array.isArray(data.servers)
    ? (data.servers as Record<string, unknown>[])
    : Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : [data];

  if (cards.length > 1) {
    findings.push({ status: 'pass', message: `${cards.length} server cards declared` });
  }

  for (const card of cards) {
    score = validateOneCard(card, cards.length > 1, findings, score);
  }

  if (res.headers['access-control-allow-origin']) {
    findings.push({ status: 'pass', message: 'CORS enabled on the server card' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No CORS headers on the server card',
      hint: 'Add Access-Control-Allow-Origin: * so browser-based agents can read the card. The extension recommends it alongside Cache-Control: public, max-age=3600.',
      learnMoreUrl: guideUrl(meta.id, 'no-cors'),
    });
    score -= 10;
  }

  return buildResult(meta, score, findings, start);
}

/** Fields required of every server card. */
function validateOneCard(card: Record<string, unknown>, multiple: boolean, findings: Finding[], score: number): number {
  const label = multiple ? `"${String(card.name ?? 'unnamed')}"` : 'Server card';

  for (const field of MCP_SERVER_CARD_REQUIRED) {
    if (card[field] !== undefined && card[field] !== null && card[field] !== '') continue;
    findings.push({
      status: 'fail',
      message: `${label}: required field "${field}" missing`,
      hint: `A server card must declare ${MCP_SERVER_CARD_REQUIRED.join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'missing-field'),
    });
    score -= 15;
  }

  // Names are reverse-DNS so servers from different publishers cannot collide
  // in a registry: `io.github.acme/weather`, `com.example.docs`.
  const name = typeof card.name === 'string' ? card.name : '';
  if (name !== '' && !/^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+(\/[a-z0-9._-]+)?$/i.test(name)) {
    findings.push({
      status: 'warn',
      message: `${label}: name "${name}" is not in reverse-DNS form`,
      hint: 'Use a reverse-DNS name such as com.example/docs or io.github.owner/server, so the server is globally unambiguous in a registry.',
      learnMoreUrl: guideUrl(meta.id, 'name-format'),
    });
    score -= 5;
  } else if (name !== '') {
    findings.push({ status: 'pass', message: `${label}: name "${name}"` });
  }

  score = validateRemotes(card, label, findings, score);

  if (card.tools !== undefined) {
    findings.push({
      status: 'warn',
      message: `${label}: declares tools[], which a server card does not carry`,
      hint: 'Tool lists come from a live tools/list call. A static copy drifts from the server, so the card schema deliberately omits it.',
      learnMoreUrl: guideUrl(meta.id, 'tools-in-card'),
    });
  }

  if (typeof card.websiteUrl === 'string' || typeof card.repository === 'object') {
    findings.push({ status: 'pass', message: `${label}: provenance declared (websiteUrl / repository)` });
  }

  return score;
}

/** Remote endpoints: how an agent actually connects. */
function validateRemotes(card: Record<string, unknown>, label: string, findings: Finding[], score: number): number {
  const remotes = Array.isArray(card.remotes) ? (card.remotes as Record<string, unknown>[]) : [];

  if (remotes.length === 0) {
    findings.push({
      status: 'warn',
      message: `${label}: no remotes[] declared`,
      hint: 'Declare at least one remote so an agent knows where to connect: { "type": "streamable-http", "url": "https://example.com/mcp", "supportedProtocolVersions": ["2026-07-28"] }.',
      learnMoreUrl: guideUrl(meta.id, 'no-remotes'),
    });
    return score - 15;
  }

  findings.push({ status: 'pass', message: `${label}: ${remotes.length} remote endpoint(s) declared` });

  const badType = remotes.map((r) => String(r.type ?? '')).filter((t) => !MCP_REMOTE_TYPES.includes(t));
  if (badType.length > 0) {
    findings.push({
      status: 'warn',
      message: `${label}: remote with an unrecognised transport type`,
      detail: badType.map((t) => t || '(missing)').join(', '),
      hint: `Transports are ${MCP_REMOTE_TYPES.join(' and ')}. SSE is the legacy transport; new servers use streamable-http.`,
      learnMoreUrl: guideUrl(meta.id, 'remote-type'),
    });
    score -= 5;
  }

  const noUrl = remotes.filter((r) => typeof r.url !== 'string' || r.url === '').length;
  if (noUrl > 0) {
    findings.push({
      status: 'fail',
      message: `${label}: ${noUrl} remote(s) missing a url`,
      hint: 'Every remote needs an absolute https:// URL.',
      learnMoreUrl: guideUrl(meta.id, 'remote-url'),
    });
    score -= 10;
  }

  const declaredVersions = remotes.flatMap((r) =>
    Array.isArray(r.supportedProtocolVersions) ? (r.supportedProtocolVersions as unknown[]).map(String) : [],
  );

  if (declaredVersions.length === 0) {
    findings.push({
      status: 'warn',
      message: `${label}: no supportedProtocolVersions declared`,
      hint: `Declare which MCP revisions the server speaks, newest first. Current: ${MCP_PROTOCOL_VERSIONS[0]}.`,
      learnMoreUrl: guideUrl(meta.id, 'no-protocol-version'),
    });
    score -= 10;
    return score;
  }

  const unknown = declaredVersions.filter((v) => !MCP_PROTOCOL_VERSIONS.includes(v));
  if (unknown.length > 0) {
    findings.push({
      status: 'warn',
      message: `${label}: unrecognised MCP protocol version(s)`,
      detail: unknown.join(', '),
      hint: `Released revisions are ${MCP_PROTOCOL_VERSIONS.join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'unknown-protocol-version'),
    });
    score -= 5;
  }

  const known = declaredVersions.filter((v) => MCP_PROTOCOL_VERSIONS.includes(v));
  if (known.length > 0 && known.every((v) => MCP_STALE_PROTOCOL_VERSIONS.includes(v))) {
    findings.push({
      status: 'warn',
      message: `${label}: only pre-2025-06 protocol revisions supported`,
      detail: known.join(', '),
      hint: `The current revision is ${MCP_PROTOCOL_VERSIONS[0]}, which removed sessions and initialize and added server/discover. Clients on newer revisions may not negotiate down.`,
      learnMoreUrl: guideUrl(meta.id, 'stale-protocol-version'),
    });
    score -= 10;
  } else if (known.includes(MCP_PROTOCOL_VERSIONS[0])) {
    findings.push({
      status: 'pass',
      message: `${label}: supports the current MCP revision (${MCP_PROTOCOL_VERSIONS[0]})`,
    });
  }

  return score;
}

/** Validate an ai-catalog document that points at MCP entries. */
function validateCatalog(
  data: Record<string, unknown>,
  findings: Finding[],
  score: number,
  start: number,
): CheckResult {
  const entries = Array.isArray(data.entries) ? (data.entries as Record<string, unknown>[]) : [];
  const mcpEntries = entries.filter((e) => String(e.type ?? '') === MCP_SERVER_CARD_MEDIA_TYPE);

  findings.push({
    status: 'pass',
    message: `AI catalog lists ${mcpEntries.length} MCP server card entry(ies) of ${entries.length} total`,
  });

  if (data.specVersion === undefined) {
    findings.push({
      status: 'warn',
      message: 'AI catalog has no specVersion',
      hint: 'Declare "specVersion": "1.0" so consumers know which catalog revision to expect.',
      learnMoreUrl: guideUrl(meta.id, 'catalog-no-version'),
    });
    score -= 5;
  }

  const incomplete = mcpEntries.filter((e) => !e.identifier || (!e.url && !e.data));
  if (incomplete.length > 0) {
    findings.push({
      status: 'warn',
      message: `${incomplete.length} catalog entry(ies) missing identifier or url/data`,
      hint: 'Each entry needs an identifier, a type, and either an inline data object or a url pointing at the document.',
      learnMoreUrl: guideUrl(meta.id, 'catalog-entry'),
    });
    score -= 10;
  }

  const unknownTypes = entries
    .map((e) => String(e.type ?? ''))
    .filter((t) => t !== '' && !Object.keys(AI_CATALOG_ENTRY_TYPES).includes(t));
  if (unknownTypes.length > 0) {
    findings.push({
      status: 'warn',
      message: 'Catalog entry with an unrecognised type',
      detail: [...new Set(unknownTypes)].join(', '),
      hint: `Known entry types: ${Object.keys(AI_CATALOG_ENTRY_TYPES).join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'catalog-entry-type'),
    });
    score -= 5;
  }

  return buildResult(meta, score, findings, start);
}

/**
 * The pre-3.7 validation, applied unchanged to a site whose only MCP document
 * is `/.well-known/mcp.json`. Reproducing the old rules exactly is what lets
 * 3.7 correct the discovery model without moving anybody's score.
 */
function validateLegacyManifest(located: Located, findings: Finding[], start: number): CheckResult {
  let score = 100;
  const { res } = located;

  findings.push({ status: 'pass', message: '/.well-known/mcp.json exists' });
  findings.push({
    status: 'warn',
    message: '/.well-known/mcp.json is not a specified discovery path',
    detail: standingNote('/.well-known/mcp.json'),
    hint:
      'Publish a server card at <your-mcp-endpoint>/server-card with Content-Type: application/mcp-server-card+json, ' +
      'and reference it from /.well-known/ai-catalog.json. Keep this file until your clients have migrated.',
    learnMoreUrl: guideUrl(meta.id, 'legacy-manifest'),
  });

  const ctFinding = checkContentType(res, ['application/json'], {
    checkId: meta.id,
    resourceLabel: '/.well-known/mcp.json',
    anchor: 'wrong-content-type',
  });
  if (ctFinding) {
    findings.push(ctFinding);
    score -= 5;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'fail',
      message: 'Invalid JSON',
      hint: 'Fix the JSON syntax in your mcp.json file. Validate with a JSON linter.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }
  findings.push({ status: 'pass', message: 'Valid JSON' });

  if (data.name) {
    findings.push({ status: 'pass', message: `Server name: "${String(data.name)}"` });
  } else {
    findings.push({
      status: 'warn',
      message: 'Missing server name',
      hint: 'Add a "name" field identifying your MCP server.',
      learnMoreUrl: guideUrl(meta.id, 'missing-name'),
    });
    score -= 10;
  }

  if (data.description) {
    findings.push({ status: 'pass', message: 'Server description present' });
  } else {
    findings.push({
      status: 'warn',
      message: 'Missing server description',
      hint: 'Add a "description" field explaining what your MCP server does.',
      learnMoreUrl: guideUrl(meta.id, 'missing-description'),
    });
    score -= 5;
  }

  if (Array.isArray(data.tools) && data.tools.length > 0) {
    const tools = data.tools as Record<string, unknown>[];
    findings.push({ status: 'pass', message: `${tools.length} tool(s) defined` });

    const described = tools.filter((t) => t.description);
    if (described.length === tools.length) {
      findings.push({ status: 'pass', message: 'All tools have descriptions' });
    } else if (described.length > 0) {
      findings.push({
        status: 'warn',
        message: `${described.length}/${tools.length} tools have descriptions`,
        hint: 'Add a "description" to each tool so agents understand what it does.',
        learnMoreUrl: guideUrl(meta.id, 'missing-tool-descriptions'),
      });
      score -= 5;
    } else {
      findings.push({
        status: 'warn',
        message: 'No tools have descriptions',
        hint: 'Add a "description" to each tool. Descriptions are how an agent decides which tool to call.',
        learnMoreUrl: guideUrl(meta.id, 'no-tool-descriptions'),
      });
      score -= 10;
    }
  } else if (Array.isArray(data.tools)) {
    findings.push({
      status: 'warn',
      message: 'Tools array is empty',
      hint: 'Add at least one tool with name, description and inputSchema.',
      learnMoreUrl: guideUrl(meta.id, 'empty-tools'),
    });
    score -= 15;
  } else {
    findings.push({
      status: 'warn',
      message: 'No tools array defined',
      hint: 'Add a "tools" array. Each tool should have name, description and inputSchema.',
      learnMoreUrl: guideUrl(meta.id, 'no-tools'),
    });
    score -= 15;
  }

  if (Array.isArray(data.resources) && data.resources.length > 0) {
    findings.push({ status: 'pass', message: `${data.resources.length} resource(s) defined` });
  } else {
    findings.push({
      status: 'warn',
      message: 'No resources defined',
      hint: 'Add a "resources" array listing the data your MCP server exposes.',
      learnMoreUrl: guideUrl(meta.id, 'no-resources'),
    });
    score -= 5;
  }

  if (Array.isArray(data.prompts) && data.prompts.length > 0) {
    findings.push({ status: 'pass', message: `${data.prompts.length} prompt(s) defined` });
  }

  if (data.version || data.protocolVersion) {
    findings.push({ status: 'pass', message: `Protocol version: ${String(data.protocolVersion ?? data.version)}` });
  } else {
    findings.push({
      status: 'warn',
      message: 'No protocol version specified',
      hint: `Add a "protocolVersion" field declaring MCP spec compatibility. Current revision: ${MCP_PROTOCOL_VERSIONS[0]}.`,
      learnMoreUrl: guideUrl(meta.id, 'no-version'),
    });
    score -= 5;
  }

  if (data.authentication) {
    findings.push({ status: 'pass', message: 'Authentication configuration present' });
  }

  if (res.headers['access-control-allow-origin']) {
    findings.push({ status: 'pass', message: 'CORS enabled on MCP endpoint' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No CORS headers on MCP endpoint',
      hint: 'Add Access-Control-Allow-Origin: * so browser-based agents can fetch the document.',
      learnMoreUrl: guideUrl(meta.id, 'no-cors'),
    });
    score -= 10;
  }

  return buildResult(meta, score, findings, start);
}
