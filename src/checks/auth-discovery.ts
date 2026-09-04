import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult, isHtmlDocument, notApplicable } from './utils.js';
import { standingNote } from './well-known.js';

/**
 * "auth-discovery" — if an agent needs credentials here, can it work out how to
 * get them?
 *
 * A human hitting a 401 goes and reads the documentation. An agent cannot. It
 * needs the answer in the response: which authorization server to talk to, what
 * scopes exist, where to register. That is what RFC 9728 Protected Resource
 * Metadata is for, and the MCP specification makes it mandatory for remote
 * servers precisely because agents cannot read docs.
 *
 * The chain is: a `401` carrying `WWW-Authenticate` with a `resource_metadata`
 * parameter, or `/.well-known/oauth-protected-resource`, naming one or more
 * authorization servers; each of those exposing RFC 8414 metadata at
 * `/.well-known/oauth-authorization-server` or OpenID discovery at
 * `/.well-known/openid-configuration`.
 *
 * This check is conditional. A site with no API, no MCP server and no commerce
 * profile has nothing to authorize, and demanding OAuth metadata from a blog
 * would be noise. It reports N/A unless one of those surfaces exists.
 */
export const meta: CheckMeta = {
  id: 'auth-discovery',
  name: 'Auth Discovery',
  description: 'Checks OAuth metadata (RFC 9728 / RFC 8414) so agents can authenticate without documentation',
  category: 'protocols',
};

const PROTECTED_RESOURCE = '/.well-known/oauth-protected-resource';
const AUTHORIZATION_SERVER = '/.well-known/oauth-authorization-server';
const OPENID_CONFIGURATION = '/.well-known/openid-configuration';

/** Paths that indicate the site has something worth authorizing. */
const SURFACE_PROBES = [
  { path: '/openapi.json', label: 'an OpenAPI description' },
  { path: '/.well-known/openapi.json', label: 'an OpenAPI description' },
  { path: '/.well-known/api-catalog', label: 'an API catalog' },
  { path: '/.well-known/mcp/server-card.json', label: 'an MCP server card' },
  { path: '/mcp/server-card', label: 'an MCP server card' },
  { path: '/.well-known/ucp', label: 'a commerce profile' },
];

async function fetchJson(ctx: CheckContext, url: string): Promise<Record<string, unknown> | null> {
  const res = await ctx.fetch(url);
  if (!res.ok || res.body.trim().length === 0 || isHtmlDocument(res.body)) return null;
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Does this site expose anything an agent would need credentials for? */
async function findSurface(ctx: CheckContext): Promise<string | null> {
  for (const probe of SURFACE_PROBES) {
    const res = await ctx.fetch(`${ctx.url}${probe.path}`);
    if (res.ok && res.body.trim().length > 0 && !isHtmlDocument(res.body)) return probe.label;
  }
  return null;
}

/** Read the `resource_metadata` parameter out of a `WWW-Authenticate` challenge. */
export function resourceMetadataFromChallenge(header: string): string | null {
  const match = header.match(/resource_metadata\s*=\s*"([^"]+)"/i);
  return match ? match[1] : null;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  // A 401 on the homepage means the whole site is gated, which is the strongest
  // possible signal that auth discovery matters here.
  const challenge = ctx.headers?.['www-authenticate'];
  const metadataUrl = challenge === undefined ? null : resourceMetadataFromChallenge(challenge);
  if (metadataUrl !== null) {
    findings.push({
      status: 'pass',
      message: 'WWW-Authenticate points at protected-resource metadata',
      detail: metadataUrl,
    });
  }

  const resource =
    (metadataUrl !== null ? await fetchJson(ctx, metadataUrl) : null) ??
    (await fetchJson(ctx, `${ctx.url}${PROTECTED_RESOURCE}`));

  if (resource === null) {
    const surface = await findSurface(ctx);
    if (surface === null) {
      findings.push({
        status: 'pass',
        message: 'Nothing on this site requires authorization — auth discovery does not apply',
        detail: 'No API description, API catalog, MCP server card or commerce profile found.',
      });
      return notApplicable(meta, findings, start);
    }

    findings.push({
      status: 'warn',
      message: `Site exposes ${surface} but publishes no OAuth metadata`,
      detail:
        `Checked WWW-Authenticate resource_metadata and ${PROTECTED_RESOURCE}. ${standingNote(PROTECTED_RESOURCE) ?? ''}`.trim(),
      hint:
        'If any of that surface needs credentials, an agent hitting a 401 has nowhere to look — it cannot read your ' +
        'documentation. Publish RFC 9728 metadata at /.well-known/oauth-protected-resource naming your authorization ' +
        'server. If everything is public, this is nothing to fix.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({
    status: 'pass',
    message: 'Protected-resource metadata published (RFC 9728)',
    detail: standingNote(PROTECTED_RESOURCE),
  });

  const servers = Array.isArray(resource.authorization_servers)
    ? (resource.authorization_servers as unknown[]).map(String)
    : [];

  if (servers.length === 0) {
    findings.push({
      status: 'fail',
      message: 'Protected-resource metadata names no authorization server',
      hint: 'Add "authorization_servers": ["https://auth.example.com"]. Without it the metadata says a token is needed but not where to get one.',
      learnMoreUrl: guideUrl(meta.id, 'no-authorization-servers'),
    });
    return buildResult(meta, 40, findings, start);
  }

  findings.push({ status: 'pass', message: `${servers.length} authorization server(s) named` });

  if (resource.resource === undefined) {
    findings.push({
      status: 'warn',
      message: 'Protected-resource metadata declares no "resource" identifier',
      hint: 'Declare the canonical resource URI so a client can request a token audienced correctly.',
      learnMoreUrl: guideUrl(meta.id, 'no-resource'),
    });
    score -= 10;
  }

  score = await validateAuthorizationServer(ctx, servers[0], findings, score);

  return buildResult(meta, score, findings, start);
}

/** Follow the first authorization server and check it can actually be used. */
async function validateAuthorizationServer(
  ctx: CheckContext,
  issuer: string,
  findings: Finding[],
  score: number,
): Promise<number> {
  let base: string;
  try {
    base = new URL(issuer).origin;
  } catch {
    findings.push({
      status: 'fail',
      message: `Authorization server "${issuer}" is not a valid URL`,
      hint: 'Authorization server entries are absolute https URLs.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-issuer'),
    });
    return score - 25;
  }

  const metadata =
    (await fetchJson(ctx, `${base}${AUTHORIZATION_SERVER}`)) ??
    (await fetchJson(ctx, `${base}${OPENID_CONFIGURATION}`));

  if (metadata === null) {
    findings.push({
      status: 'fail',
      message: `Authorization server ${base} publishes no discovery metadata`,
      detail: `Checked ${AUTHORIZATION_SERVER} and ${OPENID_CONFIGURATION}`,
      hint: 'The chain stops here: an agent knows which server to ask but not which endpoints it has. Publish RFC 8414 or OpenID discovery metadata.',
      learnMoreUrl: guideUrl(meta.id, 'no-server-metadata'),
    });
    return score - 30;
  }

  findings.push({ status: 'pass', message: `Authorization server ${base} publishes discovery metadata` });

  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint']) {
    if (metadata[field] !== undefined) continue;
    findings.push({
      status: 'fail',
      message: `Authorization server metadata is missing "${field}"`,
      hint: `An OAuth client cannot complete a flow without ${field}.`,
      learnMoreUrl: guideUrl(meta.id, 'incomplete-server-metadata'),
    });
    score -= 15;
  }

  const pkce = Array.isArray(metadata.code_challenge_methods_supported)
    ? (metadata.code_challenge_methods_supported as unknown[]).map(String)
    : [];
  if (!pkce.includes('S256')) {
    findings.push({
      status: 'warn',
      message: 'Authorization server does not advertise PKCE with S256',
      hint:
        'Agents are public clients: they hold no secret, so PKCE is the only thing standing between an intercepted ' +
        'authorization code and a stolen session. Advertise code_challenge_methods_supported: ["S256"].',
      learnMoreUrl: guideUrl(meta.id, 'no-pkce'),
    });
    score -= 15;
  } else {
    findings.push({ status: 'pass', message: 'PKCE with S256 supported' });
  }

  // Agents appear without warning and cannot fill in a registration form, so
  // either dynamic registration or client-ID metadata documents keeps them out
  // of a manual onboarding queue.
  const dynamic = metadata.registration_endpoint !== undefined;
  const cimd = metadata.client_id_metadata_document_supported === true;
  if (dynamic || cimd) {
    findings.push({
      status: 'pass',
      message: dynamic ? 'Dynamic client registration supported' : 'Client ID Metadata Documents supported',
    });
  } else {
    findings.push({
      status: 'warn',
      message: 'No automated client registration',
      hint:
        'Without dynamic registration or Client ID Metadata Documents, every new agent needs a human to register it ' +
        'first. That is a queue, not an integration.',
      learnMoreUrl: guideUrl(meta.id, 'no-registration'),
    });
    score -= 10;
  }

  return score;
}

/** Exposed for tests that build a metadata response directly. */
export type { FetchResponse };
