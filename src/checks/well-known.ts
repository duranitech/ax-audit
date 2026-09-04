/**
 * Standing of every well-known URI and discovery convention ax-audit probes.
 *
 * The agent web is a mix of IETF-registered URIs, vendor conventions that are
 * widely deployed but unregistered, and drafts that may be renamed next month.
 * Reporting them all as equally authoritative would be misleading, so every
 * probe carries its standing and audiences can weigh a miss accordingly:
 *
 * - `registered` — in the IANA Well-Known URI registry (permanent or provisional).
 * - `convention` — no registration, but shipped by multiple independent vendors.
 * - `draft`      — an open spec PR, individual I-D, or origin-trial-era proposal.
 * - `legacy`     — superseded or abandoned; recognised so we can advise removal.
 *
 * Registry snapshot: https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml
 * (last verified 2026-09-04, registry last updated 2026-08-19).
 */
export type Standing = 'registered' | 'convention' | 'draft' | 'legacy';

export interface WellKnownEntry {
  /** Path as probed, root-relative. */
  path: string;
  standing: Standing;
  /** Short human label used in findings. */
  label: string;
  /** Authoritative reference for the path. */
  specUrl: string;
  /** Free-text note surfaced in `detail` when the standing is not `registered`. */
  note?: string;
}

/**
 * Every path ax-audit knows about, keyed by path. Checks look up their probe
 * targets here so a rename in a draft spec is a one-line change in one file.
 */
export const WELL_KNOWN: Record<string, WellKnownEntry> = {
  /* ── IANA-registered ────────────────────────────────────────────────── */
  '/.well-known/agent-card.json': {
    path: '/.well-known/agent-card.json',
    standing: 'registered',
    label: 'A2A Agent Card',
    specUrl: 'https://a2a-protocol.org/latest/specification/',
  },
  '/.well-known/api-catalog': {
    path: '/.well-known/api-catalog',
    standing: 'registered',
    label: 'API Catalog (RFC 9727)',
    specUrl: 'https://www.rfc-editor.org/rfc/rfc9727.html',
  },
  '/.well-known/oauth-protected-resource': {
    path: '/.well-known/oauth-protected-resource',
    standing: 'registered',
    label: 'OAuth Protected Resource Metadata (RFC 9728)',
    specUrl: 'https://www.rfc-editor.org/rfc/rfc9728.html',
  },
  '/.well-known/oauth-authorization-server': {
    path: '/.well-known/oauth-authorization-server',
    standing: 'registered',
    label: 'OAuth Authorization Server Metadata (RFC 8414)',
    specUrl: 'https://www.rfc-editor.org/rfc/rfc8414.html',
  },
  '/.well-known/openid-configuration': {
    path: '/.well-known/openid-configuration',
    standing: 'registered',
    label: 'OpenID Provider Configuration',
    specUrl: 'https://openid.net/specs/openid-connect-discovery-1_0.html',
  },
  '/.well-known/security.txt': {
    path: '/.well-known/security.txt',
    standing: 'registered',
    label: 'security.txt (RFC 9116)',
    specUrl: 'https://www.rfc-editor.org/rfc/rfc9116',
  },
  '/.well-known/tdmrep.json': {
    path: '/.well-known/tdmrep.json',
    standing: 'registered',
    label: 'TDM Reservation Protocol',
    specUrl: 'https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/',
    note: 'Provisional registration. W3C Community Group Final Report; referenced by the EU GPAI Code of Practice.',
  },
  '/.well-known/http-message-signatures-directory': {
    path: '/.well-known/http-message-signatures-directory',
    standing: 'registered',
    label: 'Web Bot Auth key directory',
    specUrl: 'https://datatracker.ietf.org/doc/html/draft-ietf-webbotauth-httpsig-protocol',
    note: 'Path registered; the protocol itself was adopted by the IETF webbotauth WG on 2026-09-01.',
  },

  /* ── Vendor conventions (unregistered, multi-vendor) ────────────────── */
  '/llms.txt': {
    path: '/llms.txt',
    standing: 'convention',
    label: 'llms.txt',
    specUrl: 'https://llmstxt.org/',
    note: 'Community proposal (v2, 2026-08-10). Read by coding agents (Claude Code, Cursor, OpenCode); Google Search states it ignores the file.',
  },
  '/.well-known/mcp/server-card.json': {
    path: '/.well-known/mcp/server-card.json',
    standing: 'convention',
    label: 'MCP Server Card (well-known path)',
    specUrl: 'https://github.com/modelcontextprotocol/experimental-ext-server-card',
    note: 'Served by Cloudflare and Mintlify. The MCP extension recommends <endpoint>/server-card instead.',
  },
  '/.well-known/skills/index.json': {
    path: '/.well-known/skills/index.json',
    standing: 'convention',
    label: 'Agent Skills index (Mintlify variant)',
    specUrl: 'https://www.mintlify.com/docs/ai/skillmd',
  },
  '/.well-known/ucp': {
    path: '/.well-known/ucp',
    standing: 'convention',
    label: 'Universal Commerce Protocol profile',
    specUrl: 'https://developers.google.com/merchant/ucp/guides/ucp-profile',
    note: 'Google-led, adopted by Shopify, Etsy, Walmart and Stripe. Not IANA-registered.',
  },
  '/openapi.json': {
    path: '/openapi.json',
    standing: 'convention',
    label: 'OpenAPI description',
    specUrl: 'https://spec.openapis.org/oas/latest.html',
    note: 'The OpenAPI spec recommends the file name openapi.json / openapi.yaml. No well-known path is registered.',
  },
  '/.well-known/openai-apps-challenge': {
    path: '/.well-known/openai-apps-challenge',
    standing: 'convention',
    label: 'OpenAI Apps domain verification',
    specUrl: 'https://developers.openai.com/plugins/deploy/submission.md',
  },
  '/.well-known/gpc.json': {
    path: '/.well-known/gpc.json',
    standing: 'registered',
    label: 'Global Privacy Control',
    specUrl: 'https://privacycg.github.io/gpc-spec/',
  },

  /* ── Drafts ─────────────────────────────────────────────────────────── */
  '/.well-known/agent-skills/index.json': {
    path: '/.well-known/agent-skills/index.json',
    standing: 'draft',
    label: 'Agent Skills discovery index',
    specUrl: 'https://github.com/cloudflare/agent-skills-discovery-rfc',
    note: 'Cloudflare RFC v0.2.0 (2026-03-12). Not registered; a competing shorter path (/.well-known/skills/) also ships.',
  },
  '/.well-known/ai-catalog.json': {
    path: '/.well-known/ai-catalog.json',
    standing: 'draft',
    label: 'AI Catalog',
    specUrl: 'https://ai-catalog.io/',
    note: 'Linux Foundation Agent Card WG draft. Adoption pending steering-committee votes.',
  },
  '/.well-known/ard.json': {
    path: '/.well-known/ard.json',
    standing: 'draft',
    label: 'Agentic Resource Discovery',
    specUrl: 'https://agenticresourcediscovery.org/spec/',
    note: 'Spec v0.91 (2026-08-26). Overlaps with ai-catalog.json; both are probed.',
  },
  '/.well-known/mcp/server-cards.json': {
    path: '/.well-known/mcp/server-cards.json',
    standing: 'draft',
    label: 'MCP Server Cards (multi-server)',
    specUrl: 'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127',
    note: 'SEP-2127 is an open draft; the path has changed twice since 2025-10.',
  },
  '/.well-known/ai.txt': {
    path: '/.well-known/ai.txt',
    standing: 'draft',
    label: 'ai.txt (well-known variant)',
    specUrl: 'https://datatracker.ietf.org/doc/draft-car-ai-txt-wellknown/',
    note: 'Individual I-D (2026-06-12), not adopted by any working group.',
  },

  /* ── Legacy ─────────────────────────────────────────────────────────── */
  '/.well-known/agent.json': {
    path: '/.well-known/agent.json',
    standing: 'legacy',
    label: 'A2A Agent Card (pre-0.3 path)',
    specUrl: 'https://github.com/a2aproject/A2A/releases',
    note: 'A2A moved the card to /.well-known/agent-card.json in v0.3.0 (2025-07-30).',
  },
  '/.well-known/mcp.json': {
    path: '/.well-known/mcp.json',
    standing: 'legacy',
    label: 'MCP manifest (non-standard)',
    specUrl: 'https://modelcontextprotocol.io/specification/versioning',
    note: 'Never part of the MCP specification. Server cards superseded ad-hoc manifests.',
  },
  '/.well-known/ai-plugin.json': {
    path: '/.well-known/ai-plugin.json',
    standing: 'legacy',
    label: 'ChatGPT plugin manifest',
    specUrl: 'https://developers.openai.com/plugins/',
    note: 'ChatGPT plugins were shut down on 2024-04-09 and replaced by GPT Actions, then MCP.',
  },
  '/agents.json': {
    path: '/agents.json',
    standing: 'legacy',
    label: 'agents.json (Wildcard)',
    specUrl: 'https://github.com/wild-card-ai/agents-json',
    note: 'Repository dormant since 2025-08-21; no known consumer.',
  },
  '/.well-known/nlweb.json': {
    path: '/.well-known/nlweb.json',
    standing: 'legacy',
    label: 'NLWeb manifest',
    specUrl: 'https://github.com/nlweb-ai/NLWeb',
    note: 'No such file exists in the NLWeb project. NLWeb exposes /ask and /mcp endpoints instead.',
  },
  '/.well-known/genai.txt': {
    path: '/.well-known/genai.txt',
    standing: 'legacy',
    label: 'genai.txt',
    specUrl: 'https://llmstxt.org/',
    note: 'No specification, repository, or documented consumer was found for this file.',
  },
};

/** Look up a path's standing, defaulting to `convention` for unknown paths. */
export function standingOf(path: string): Standing {
  return WELL_KNOWN[path]?.standing ?? 'convention';
}

/** Human sentence describing a path's standing, for finding details. */
export function standingNote(path: string): string | undefined {
  const entry = WELL_KNOWN[path];
  if (!entry) return undefined;
  const prefix =
    entry.standing === 'registered'
      ? 'IANA-registered well-known URI.'
      : entry.standing === 'convention'
        ? 'Vendor convention, not IANA-registered.'
        : entry.standing === 'draft'
          ? 'Draft specification — the path may still change.'
          : 'Legacy path.';
  return entry.note ? `${prefix} ${entry.note}` : prefix;
}
