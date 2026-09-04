/**
 * Does this site have the surface a protocol check is about?
 *
 * From 4.0, protocol checks carry weight. That is only defensible if they apply
 * to the site being audited. A blog has no API to describe and is not an agent;
 * scoring it zero for publishing no OpenAPI document or Agent Card would say
 * something false about the blog and make the overall number useless as a
 * signal.
 *
 * So each protocol check asks first whether the site has the corresponding
 * surface. When it does not, the check reports N/A — visible in the report,
 * excluded from the score — and says what publishing one would enable. When it
 * does, a missing description is a real finding, because the capability exists
 * and agents cannot find it.
 *
 * A `--profile` flag overrides the detection, so a site can be audited against
 * what it intends to become rather than only what it already is.
 */
import type { CheckContext } from '../types.js';
import { isHtmlDocument } from './utils.js';
import { parseLinkHeader } from './http-headers.js';

/** Surfaces a site can have, each gating one or more protocol checks. */
export type Surface = 'api' | 'mcp' | 'agent' | 'docs' | 'commerce';

/**
 * Profiles a user can force with `--profile`. `all` makes every protocol check
 * applicable, which is what a site planning its agent integration wants.
 */
export type Profile = 'auto' | 'api' | 'mcp' | 'agent' | 'docs' | 'commerce' | 'all';

export interface SurfaceEvidence {
  found: boolean;
  /** What made the check applicable, for the report. */
  reason: string;
}

const NOT_FOUND: SurfaceEvidence = { found: false, reason: '' };

/** Read the profile a run was invoked with, defaulting to automatic detection. */
export function profileFrom(ctx: CheckContext): Profile {
  return ctx.profile ?? 'auto';
}

/** Whether the active profile forces this surface applicable. */
export function forcedBy(profile: Profile, surface: Surface): boolean {
  return profile === 'all' || profile === surface;
}

async function exists(ctx: CheckContext, path: string): Promise<boolean> {
  const res = await ctx.fetch(`${ctx.url}${path}`);
  return res.ok && res.body.trim().length > 0 && !isHtmlDocument(res.body);
}

/** Links and headers pointing at a named area of the site. */
function linksTo(ctx: CheckContext, pattern: RegExp): boolean {
  if (pattern.test(ctx.html ?? '')) return true;
  return parseLinkHeader(ctx.headers?.['link'] ?? '').some((entry) => pattern.test(entry.url));
}

/**
 * Does this site offer an HTTP API?
 *
 * Evidence: a description at a conventional location, an RFC 9727 catalog, a
 * `service-desc` relation, or navigation into an API or developer area. The
 * last is the loosest and the most common: a site with a "Developers" link
 * almost certainly has an API worth describing.
 */
export async function hasApiSurface(ctx: CheckContext): Promise<SurfaceEvidence> {
  if (forcedBy(profileFrom(ctx), 'api')) return { found: true, reason: '--profile api' };

  for (const path of ['/openapi.json', '/.well-known/openapi.json', '/.well-known/api-catalog', '/swagger.json']) {
    if (await exists(ctx, path)) return { found: true, reason: `a document at ${path}` };
  }

  if (linksTo(ctx, /rel\s*=\s*["'][^"']*service-desc/i)) {
    return { found: true, reason: 'a service-desc link relation' };
  }
  if (linksTo(ctx, /href\s*=\s*["'][^"']*\/(api|developers?|api-docs|reference)\b/i)) {
    return { found: true, reason: 'navigation into an API or developer area' };
  }
  if (/\bapi\.[a-z0-9-]+\.[a-z]{2,}/i.test(ctx.html ?? '')) {
    return { found: true, reason: 'references to an API subdomain' };
  }

  return NOT_FOUND;
}

/** Does this site run an MCP server? */
export async function hasMcpSurface(ctx: CheckContext): Promise<SurfaceEvidence> {
  if (forcedBy(profileFrom(ctx), 'mcp')) return { found: true, reason: '--profile mcp' };

  for (const path of ['/.well-known/mcp/server-card.json', '/mcp/server-card', '/.well-known/mcp.json']) {
    if (await exists(ctx, path)) return { found: true, reason: `a document at ${path}` };
  }

  const catalog = await ctx.fetch(`${ctx.url}/.well-known/ai-catalog.json`);
  if (catalog.ok && /application\/mcp-server-card\+json/.test(catalog.body)) {
    return { found: true, reason: 'an MCP entry in the AI catalog' };
  }

  if (linksTo(ctx, /href\s*=\s*["'][^"']*\/mcp\b/i)) {
    return { found: true, reason: 'navigation referencing an MCP endpoint' };
  }

  return NOT_FOUND;
}

/**
 * Is this site agent-facing — something an agent would call rather than only
 * read?
 *
 * An Agent Card describes capabilities another agent can invoke. Most sites do
 * not have any, and asking a restaurant to publish one is noise. A site that
 * runs an MCP server, offers an API, or already publishes a card is a different
 * matter.
 */
export async function hasAgentSurface(ctx: CheckContext): Promise<SurfaceEvidence> {
  if (forcedBy(profileFrom(ctx), 'agent')) return { found: true, reason: '--profile agent' };

  for (const path of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
    if (await exists(ctx, path)) return { found: true, reason: `a document at ${path}` };
  }

  const catalog = await ctx.fetch(`${ctx.url}/.well-known/ai-catalog.json`);
  if (catalog.ok && /application\/a2a-agent-card\+json/.test(catalog.body)) {
    return { found: true, reason: 'an A2A entry in the AI catalog' };
  }

  const mcp = await hasMcpSurface(ctx);
  if (mcp.found) return { found: true, reason: `an MCP surface (${mcp.reason})` };

  const api = await hasApiSurface(ctx);
  if (api.found) return { found: true, reason: `an API surface (${api.reason})` };

  return NOT_FOUND;
}

/** Does this site have documentation an agent could be taught to follow? */
export async function hasDocsSurface(ctx: CheckContext): Promise<SurfaceEvidence> {
  if (forcedBy(profileFrom(ctx), 'docs')) return { found: true, reason: '--profile docs' };

  if (linksTo(ctx, /href\s*=\s*["'][^"']*\/(docs|documentation|guides?|reference|developers?)\b/i)) {
    return { found: true, reason: 'navigation into a documentation area' };
  }
  for (const path of ['/llms.txt', '/openapi.json']) {
    if (await exists(ctx, path)) return { found: true, reason: `a document at ${path}` };
  }

  return NOT_FOUND;
}
