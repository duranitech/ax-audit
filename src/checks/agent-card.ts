import {
  A2A_MEDIA_TYPE,
  AGENT_CARD_REQUIRED_V03,
  AGENT_CARD_REQUIRED_V1,
  A2A_PROTOCOL_BINDINGS,
} from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult, checkContentType, isHtmlDocument, notApplicable } from './utils.js';
import { hasAgentSurface } from './surface.js';
import { WELL_KNOWN, standingNote } from './well-known.js';

/**
 * "agent-card" — the A2A (Agent2Agent) Agent Card.
 *
 * Two things changed since this check was written, and both matter:
 *
 * 1. **The path moved.** A2A v0.3.0 (2025-07-30) relocated the card from
 *    `/.well-known/agent.json` to `/.well-known/agent-card.json`, which is now
 *    an IANA-registered well-known URI. A site serving only the old path is
 *    invisible to a current client.
 *
 * 2. **The shape changed.** A2A 1.0 (2026-03-12, breaking) folded the
 *    top-level `url`, `protocolVersion`, `preferredTransport` and
 *    `additionalInterfaces` fields into a single `supportedInterfaces[]` array,
 *    and renamed `supportsAuthenticatedExtendedCard` to
 *    `capabilities.extendedAgentCard`. Most deployed cards are still 0.3-shaped.
 *
 * Validating a 1.0 card against 0.3 rules (or the reverse) produces nonsense,
 * so the check detects which generation a card belongs to from its own
 * structure and applies the matching rules. `authentication`, dropped back in
 * 0.2.x in favour of `securitySchemes`, is flagged wherever it appears.
 *
 * Spec: https://a2a-protocol.org/latest/specification/
 * Normative field list: specification/a2a.proto in github.com/a2aproject/A2A
 */
export const meta: CheckMeta = {
  id: 'agent-card',
  name: 'Agent Card (A2A)',
  description: 'Checks the A2A Agent Card at /.well-known/agent-card.json',
  weight: 7,
  category: 'protocols',
  aliases: ['agent-json'],
};

const CANONICAL_PATH = '/.well-known/agent-card.json';
const LEGACY_PATH = '/.well-known/agent.json';

/** Which generation of the A2A spec a card was written against. */
type Generation = 'v1' | 'v0.3' | 'unknown';

/**
 * Detect the card generation from its own structure rather than from a version
 * field, because 0.3 cards state `protocolVersion` at the top level and 1.0
 * cards state it per interface.
 */
export function detectGeneration(data: Record<string, unknown>): Generation {
  if (Array.isArray(data.supportedInterfaces)) return 'v1';
  if (typeof data.url === 'string' || typeof data.protocolVersion === 'string') return 'v0.3';
  return 'unknown';
}

interface Located {
  res: FetchResponse;
  path: string;
}

/**
 * Try the registered path first, then the pre-0.3 one. An HTML response counts
 * as absent: an SPA catch-all returns its index shell for every unknown path,
 * and reporting that as a malformed card would send an operator looking for a
 * bug in a file they never wrote.
 */
async function locateCard(ctx: CheckContext): Promise<Located | null> {
  for (const path of [CANONICAL_PATH, LEGACY_PATH]) {
    const res = await ctx.fetch(`${ctx.url}${path}`);
    if (res.ok && res.body.trim().length > 0 && !isHtmlDocument(res.body)) return { res, path };
  }
  return null;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const found = await locateCard(ctx);

  if (found === null) {
    // An Agent Card describes capabilities another agent can invoke. Most sites
    // have none, and asking a restaurant to publish one is noise — so the check
    // only applies where the site is already agent-facing.
    const surface = await hasAgentSurface(ctx);
    if (!surface.found) {
      findings.push({
        status: 'pass',
        message: 'No agent-facing surface — an Agent Card does not apply to this site',
        detail:
          'No API, MCP server or existing card was found. An Agent Card advertises capabilities another agent can ' +
          'invoke; a site that offers none has nothing to put in it. Run with --profile agent to audit as though it did.',
      });
      return notApplicable(meta, findings, start);
    }

    findings.push({
      status: 'fail',
      message: `${CANONICAL_PATH} not found`,
      detail:
        `Site is agent-facing (${surface.reason}). Also tried the pre-0.3 path ${LEGACY_PATH}. ${standingNote(CANONICAL_PATH) ?? ''}`.trim(),
      hint:
        'This site offers something an agent could call, but nothing tells an agent what. Publish an A2A Agent Card ' +
        'at /.well-known/agent-card.json. A minimal 1.0 card needs name, description, version, capabilities, ' +
        `supportedInterfaces, defaultInputModes, defaultOutputModes and skills. Spec: ${WELL_KNOWN[CANONICAL_PATH].specUrl}`,
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const { res, path } = found;

  if (path === LEGACY_PATH) {
    findings.push({
      status: 'warn',
      message: `Agent Card served only from the pre-0.3 path ${LEGACY_PATH}`,
      detail: standingNote(LEGACY_PATH),
      hint:
        'A2A moved the card to /.well-known/agent-card.json in v0.3.0 (2025-07-30), and that path is the one ' +
        'registered with IANA. Serve the card there; keep the old path as a redirect if existing clients depend on it.',
      learnMoreUrl: guideUrl(meta.id, 'legacy-path'),
    });
  } else {
    findings.push({ status: 'pass', message: `${CANONICAL_PATH} exists` });
  }

  const ctFinding = checkContentType(res, ['application/json', A2A_MEDIA_TYPE], {
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
      message: 'Invalid JSON',
      hint: 'Fix the JSON syntax in your Agent Card. Validate it with a JSON linter.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }
  findings.push({ status: 'pass', message: 'Valid JSON' });

  const generation = detectGeneration(data);
  score = validateGeneration(generation, data, ctx, findings, score);
  score = validateCommon(data, findings, score);

  return buildResult(meta, score, findings, start);
}

/** Apply the field rules of whichever spec generation this card was written against. */
function validateGeneration(
  generation: Generation,
  data: Record<string, unknown>,
  ctx: CheckContext,
  findings: Finding[],
  score: number,
): number {
  if (generation === 'unknown') {
    findings.push({
      status: 'fail',
      message: 'Card shape matches neither A2A 1.0 nor 0.3',
      detail: 'Expected either supportedInterfaces[] (1.0) or a top-level url + protocolVersion (0.3).',
      hint: 'Rebuild the card against the current specification. A 1.0 card declares every endpoint inside supportedInterfaces[].',
      learnMoreUrl: guideUrl(meta.id, 'unknown-generation'),
    });
    return score - 30;
  }

  const required = generation === 'v1' ? AGENT_CARD_REQUIRED_V1 : AGENT_CARD_REQUIRED_V03;

  findings.push({
    status: 'pass',
    message:
      generation === 'v1' ? 'Card follows A2A 1.0 (supportedInterfaces)' : 'Card follows A2A 0.3 (top-level url)',
    ...(generation === 'v0.3'
      ? {
          detail:
            'A2A 1.0 (2026-03-12) replaced the top-level url, protocolVersion, preferredTransport and ' +
            'additionalInterfaces fields with a single supportedInterfaces[] array.',
        }
      : {}),
  });

  for (const field of required) {
    if (data[field] !== undefined && data[field] !== null) {
      findings.push({ status: 'pass', message: `Required field "${field}" present` });
    } else {
      findings.push({
        status: 'fail',
        message: `Required field "${field}" missing`,
        hint: `Add "${field}" to your Agent Card. A2A ${generation === 'v1' ? '1.0' : '0.3'} requires it.`,
        learnMoreUrl: guideUrl(meta.id, 'missing-field'),
      });
      score -= 15;
    }
  }

  return generation === 'v1'
    ? validateInterfaces(data, ctx, findings, score)
    : validateLegacyUrl(data, ctx, findings, score);
}

/** A2A 1.0: every entry in `supportedInterfaces[]` needs url, binding and version. */
function validateInterfaces(
  data: Record<string, unknown>,
  ctx: CheckContext,
  findings: Finding[],
  score: number,
): number {
  const interfaces = Array.isArray(data.supportedInterfaces)
    ? (data.supportedInterfaces as Record<string, unknown>[])
    : [];
  if (interfaces.length === 0) {
    findings.push({
      status: 'fail',
      message: 'supportedInterfaces[] is empty',
      hint: 'Declare at least one interface: { "url": "https://…", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }.',
      learnMoreUrl: guideUrl(meta.id, 'empty-interfaces'),
    });
    return score - 15;
  }

  const incomplete = interfaces.filter((i) => !i.url || !i.protocolBinding || !i.protocolVersion);
  if (incomplete.length > 0) {
    findings.push({
      status: 'warn',
      message: `${incomplete.length}/${interfaces.length} interface(s) missing url, protocolBinding or protocolVersion`,
      hint: 'Each entry in supportedInterfaces[] must declare all three so a client knows where to connect and how to speak.',
      learnMoreUrl: guideUrl(meta.id, 'incomplete-interface'),
    });
    score -= 10;
  } else {
    findings.push({ status: 'pass', message: `${interfaces.length} interface(s) fully declared` });
  }

  const badBinding = interfaces
    .map((i) => String(i.protocolBinding ?? ''))
    .filter((b) => b !== '' && !A2A_PROTOCOL_BINDINGS.includes(b));
  if (badBinding.length > 0) {
    findings.push({
      status: 'warn',
      message: 'Interface with an unrecognised protocolBinding',
      detail: badBinding.join(', '),
      hint: `A2A 1.0 defines: ${A2A_PROTOCOL_BINDINGS.join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'unknown-binding'),
    });
    score -= 5;
  }

  const offOrigin = interfaces
    .map((i) => String(i.url ?? ''))
    .filter((u) => u !== '' && sameHost(u, ctx.url) === false);
  if (offOrigin.length > 0) {
    findings.push({
      status: 'warn',
      message: `${offOrigin.length} interface URL(s) point to a different origin`,
      detail: offOrigin.join(', '),
      hint: 'Interfaces on another origin can be intentional, but agents treat the card as authoritative for this site. Confirm the endpoints are yours.',
      learnMoreUrl: guideUrl(meta.id, 'url-mismatch'),
    });
    score -= 5;
  }

  return score;
}

/** A2A 0.3: the single top-level `url` should be absolute and on this origin. */
function validateLegacyUrl(
  data: Record<string, unknown>,
  ctx: CheckContext,
  findings: Finding[],
  score: number,
): number {
  if (typeof data.url !== 'string' || data.url.length === 0) return score;

  const sameOrigin = sameHost(data.url, ctx.url);
  if (sameOrigin === false) {
    findings.push({
      status: 'warn',
      message: `Agent Card "url" points to a different origin: ${data.url}`,
      hint: 'The url field should match the audited site origin. Pointing it elsewhere can confuse agents about the canonical agent endpoint.',
      learnMoreUrl: guideUrl(meta.id, 'url-mismatch'),
    });
    score -= 5;
  } else if (sameOrigin === null) {
    findings.push({
      status: 'warn',
      message: `Agent Card "url" is not a valid absolute URL: ${data.url}`,
      hint: 'Provide an absolute https:// URL for the url field.',
      learnMoreUrl: guideUrl(meta.id, 'url-invalid'),
    });
    score -= 5;
  }

  return score;
}

/** Rules that hold across both generations. */
function validateCommon(data: Record<string, unknown>, findings: Finding[], score: number): number {
  if (Array.isArray(data.skills) && data.skills.length > 0) {
    const skills = data.skills as Record<string, unknown>[];
    findings.push({ status: 'pass', message: `${skills.length} skill(s) defined` });
    const incomplete = skills.filter((s) => !s.id || !s.description);
    if (incomplete.length === 0) {
      findings.push({ status: 'pass', message: 'All skills have id + description' });
    } else {
      findings.push({
        status: 'warn',
        message: `${incomplete.length}/${skills.length} skill(s) missing id or description`,
        hint: 'Each entry in skills[] should include both an id and a description so agents can address it and reason about its purpose.',
        learnMoreUrl: guideUrl(meta.id, 'incomplete-skills'),
      });
      score -= 5;
    }
  } else if (Array.isArray(data.skills)) {
    findings.push({
      status: 'warn',
      message: 'Skills array is empty',
      hint: 'Add at least one skill to the skills array describing what your agent can do.',
      learnMoreUrl: guideUrl(meta.id, 'empty-skills'),
    });
    score -= 10;
  }

  // `authentication` was replaced by `securitySchemes` in A2A 0.2.x. A card
  // still carrying it is describing its auth to nobody.
  if (data.authentication !== undefined) {
    findings.push({
      status: 'warn',
      message: 'Card uses "authentication", removed from the A2A spec',
      hint: 'Replace it with "securitySchemes" (OpenAPI-style scheme definitions) plus the matching security requirements.',
      learnMoreUrl: guideUrl(meta.id, 'deprecated-authentication'),
    });
    score -= 5;
  }

  if (data.securitySchemes !== undefined) {
    findings.push({ status: 'pass', message: 'securitySchemes declared' });
  }

  if (Array.isArray(data.signatures) && data.signatures.length > 0) {
    findings.push({
      status: 'pass',
      message: `Card carries ${data.signatures.length} JWS signature(s)`,
      detail: 'Signed cards let a client verify the card was issued by the domain it claims.',
    });
  }

  const capabilities = (data.capabilities ?? {}) as Record<string, unknown>;
  const extensions = Array.isArray(capabilities.extensions)
    ? (capabilities.extensions as Record<string, unknown>[])
    : [];
  if (extensions.length > 0) {
    findings.push({
      status: 'pass',
      message: `${extensions.length} capability extension(s) declared`,
      detail: extensions.map((e) => String(e.uri ?? '(no uri)')).join(', '),
    });
  }

  const optionalFields = ['provider', 'documentationUrl', 'iconUrl'];
  const presentOptional = optionalFields.filter((f) => data[f] !== undefined);
  if (presentOptional.length === optionalFields.length) {
    findings.push({
      status: 'pass',
      message: 'All optional descriptive fields present (provider, documentationUrl, iconUrl)',
    });
  } else if (presentOptional.length > 0) {
    findings.push({
      status: 'pass',
      message: `${presentOptional.length}/${optionalFields.length} optional descriptive fields present`,
    });
  } else {
    findings.push({
      status: 'warn',
      message: 'No optional descriptive fields (provider, documentationUrl, iconUrl)',
      hint: 'Add provider (who runs this agent), documentationUrl (where to read more) and iconUrl. Agents surface these to users when choosing between agents.',
      learnMoreUrl: guideUrl(meta.id, 'missing-optional'),
    });
    score -= 5;
  }

  return score;
}

/** Returns `true` when the two URLs share host, `false` if hosts differ, `null` on parse error. */
function sameHost(a: string, b: string): boolean | null {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return null;
  }
}
