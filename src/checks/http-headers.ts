import { SECURITY_HEADERS } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

interface LinkEntry {
  url: string;
  params: Record<string, string>;
}

/** Parse an RFC 5988 Link header into structured entries. */
export function parseLinkHeader(header: string): LinkEntry[] {
  if (!header) return [];

  const entries: LinkEntry[] = [];
  const parts = splitLinkHeader(header);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const urlMatch = trimmed.match(/^<([^>]*)>/);
    if (!urlMatch) continue;

    const url = urlMatch[1];
    const rest = trimmed.slice(urlMatch[0].length);
    const params: Record<string, string> = {};

    const paramRegex = /;\s*([^=\s]+)\s*=\s*(?:"([^"]*)"|([^\s;,]*))/g;
    let match;
    while ((match = paramRegex.exec(rest)) !== null) {
      params[match[1].toLowerCase()] = match[2] ?? match[3];
    }

    entries.push({ url, params });
  }

  return entries;
}

/**
 * Report the discovery relations a site advertises beyond llms.txt and the
 * Agent Card. Each one saves an agent a round of path guessing, and several
 * point at resources no amount of guessing would find.
 */
function reportDiscoveryRelations(links: LinkEntry[], headers: Record<string, string>, findings: Finding[]): void {
  const present: string[] = [];
  const missing: { label: string; note: string }[] = [];

  for (const { rel, label, note } of DISCOVERY_RELATIONS) {
    const found = links.some((l) => (l.params['rel'] ?? '').split(/\s+/).includes(rel));
    if (found) present.push(label);
    else missing.push({ label, note });
  }

  const markdownAlternate = links.some(
    (l) =>
      (l.params['rel'] ?? '').split(/\s+/).includes('alternate') && (l.params['type'] ?? '').includes('text/markdown'),
  );
  if (markdownAlternate) present.push('alternate (text/markdown)');

  if (headers['x-llms-txt'] !== undefined) {
    findings.push({
      status: 'pass',
      message: 'X-Llms-Txt header advertises the llms.txt location',
      detail: headers['x-llms-txt'],
    });
  }

  if (present.length > 0) {
    findings.push({
      status: 'pass',
      message: `${present.length} additional discovery relation(s) advertised: ${present.join(', ')}`,
    });
  }

  if (missing.length === DISCOVERY_RELATIONS.length && !markdownAlternate) {
    findings.push({
      status: 'warn',
      message: 'No machine-readable discovery relations beyond llms.txt and the Agent Card',
      detail: DISCOVERY_RELATIONS.map((r) => `${r.label} — ${r.note}`).join('\n'),
      hint:
        'Advertise what you publish with Link relations so agents stop guessing paths. Add the ones that apply, ' +
        'for example: Link: </llms.txt>; rel="describedby", </.well-known/api-catalog>; rel="api-catalog". ' +
        'Informational in 3.x: this does not affect your score.',
      learnMoreUrl: guideUrl(meta.id, 'discovery-relations'),
    });
  }
}

/** Split a Link header value by commas, respecting angle brackets. */
function splitLinkHeader(header: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inAngle = false;
  let inQuote = false;

  for (let i = 0; i < header.length; i++) {
    const ch = header[i];

    if (ch === '"' && !inAngle) {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === '<' && !inQuote) {
      inAngle = true;
      current += ch;
    } else if (ch === '>' && !inQuote) {
      inAngle = false;
      current += ch;
    } else if (ch === ',' && !inAngle && !inQuote) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

export const meta: CheckMeta = {
  id: 'http-headers',
  name: 'HTTP Headers',
  description: 'Checks security headers, AI discovery Link headers, and CORS',
  weight: 9,
  category: 'discovery',
};

/**
 * Link relations that tell an agent where a site's machine-readable resources
 * live. Discovery by link beats discovery by guessing: an agent that has to try
 * known filenames finds only the ones it already knows to look for.
 *
 * Reported, never required — several of these relations come from drafts, and
 * a site that publishes none of them is not doing anything wrong.
 */
const DISCOVERY_RELATIONS: { rel: string; label: string; note: string }[] = [
  {
    rel: 'describedby',
    label: 'describedby',
    note: 'llms.txt v2 uses this relation to point a page at the llms.txt that covers it.',
  },
  { rel: 'api-catalog', label: 'api-catalog', note: 'RFC 9727: the catalog of APIs this publisher offers.' },
  { rel: 'service-desc', label: 'service-desc', note: 'RFC 8631: a machine-readable API description.' },
  { rel: 'service-doc', label: 'service-doc', note: 'RFC 8631: human documentation for the API.' },
  { rel: 'ai-catalog', label: 'ai-catalog', note: 'Draft: the AI catalog listing agent cards and MCP server cards.' },
  { rel: 'c2pa-manifest', label: 'c2pa-manifest', note: 'C2PA 2.4: content provenance for media on the page.' },
  { rel: 'license', label: 'license', note: 'RSL and other machine-readable licensing terms.' },
];

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const headers = ctx.headers;
  if (!headers || Object.keys(headers).length === 0) {
    findings.push({ status: 'fail', message: 'Could not fetch homepage headers' });
    return buildResult(meta, 0, findings, start);
  }

  let securityCount = 0;
  for (const header of SECURITY_HEADERS) {
    if (headers[header.name]) {
      securityCount++;
    } else if (header.critical) {
      findings.push({
        status: 'fail',
        message: `Missing critical header: ${header.label}`,
        hint: `Add the ${header.label} response header to your server configuration. This is a critical security header.`,
        learnMoreUrl: guideUrl(meta.id, 'missing-critical-header'),
      });
      score -= 10;
    }
  }

  if (securityCount === SECURITY_HEADERS.length) {
    findings.push({ status: 'pass', message: `All ${SECURITY_HEADERS.length} security headers present` });
  } else if (securityCount >= 4) {
    findings.push({ status: 'pass', message: `${securityCount}/${SECURITY_HEADERS.length} security headers present` });
  } else {
    findings.push({
      status: 'warn',
      message: `Only ${securityCount}/${SECURITY_HEADERS.length} security headers present`,
      hint: 'Add security headers like Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, and Referrer-Policy to your server response.',
      learnMoreUrl: guideUrl(meta.id, 'low-security-headers'),
    });
    score -= 5;
  }

  const linkHeader = headers['link'] ?? '';
  const links = parseLinkHeader(linkHeader);
  const hasLlmsLink = links.some((l) => /llms\.txt/i.test(l.url));
  // A2A moved the card to agent-card.json in v0.3.0; both paths count as a
  // discovery link so a site that upgraded is not marked down for it.
  const hasAgentLink = links.some((l) => /agent(-card)?\.json/i.test(l.url));

  if (hasLlmsLink && hasAgentLink) {
    findings.push({ status: 'pass', message: 'Link header references both llms.txt and the Agent Card' });
  } else if (hasLlmsLink) {
    findings.push({ status: 'pass', message: 'Link header references llms.txt' });
    findings.push({
      status: 'warn',
      message: 'Link header does not reference the Agent Card',
      hint: 'Add the Agent Card to your Link header: Link: </.well-known/agent-card.json>; rel="alternate"; type="application/json"',
      learnMoreUrl: guideUrl(meta.id, 'missing-agent-link'),
    });
    score -= 5;
  } else if (hasAgentLink) {
    findings.push({ status: 'pass', message: 'Link header references the Agent Card' });
    findings.push({
      status: 'warn',
      message: 'Link header does not reference llms.txt',
      hint: 'Add llms.txt to your Link header: Link: </llms.txt>; rel="alternate"; type="text/plain"',
      learnMoreUrl: guideUrl(meta.id, 'missing-llms-link'),
    });
    score -= 5;
  } else if (linkHeader) {
    findings.push({
      status: 'warn',
      message: 'Link header present but does not reference AI discovery files',
      hint: 'Add AI discovery entries to your Link header: Link: </llms.txt>; rel="alternate"; type="text/plain", </.well-known/agent-card.json>; rel="alternate"; type="application/json"',
      learnMoreUrl: guideUrl(meta.id, 'no-ai-discovery'),
    });
    score -= 15;
  } else {
    findings.push({
      status: 'warn',
      message: 'No Link header for AI discovery (llms.txt, Agent Card)',
      hint: 'Add a Link response header pointing to your AI discovery files: Link: </llms.txt>; rel="alternate"; type="text/plain", </.well-known/agent-card.json>; rel="alternate"; type="application/json"',
      learnMoreUrl: guideUrl(meta.id, 'no-link-header'),
    });
    score -= 15;
  }

  // Probe the registered path first, falling back to the pre-0.3 one, so CORS
  // is evaluated against whichever card the site actually serves.
  let wellKnownRes = await ctx.fetch(`${ctx.url}/.well-known/agent-card.json`);
  if (!wellKnownRes.ok) wellKnownRes = await ctx.fetch(`${ctx.url}/.well-known/agent.json`);
  if (wellKnownRes.ok) {
    const cors = wellKnownRes.headers['access-control-allow-origin'];
    if (cors) {
      findings.push({ status: 'pass', message: 'CORS enabled on .well-known resources' });
    } else {
      findings.push({
        status: 'warn',
        message: 'No CORS headers on .well-known resources',
        hint: 'Add Access-Control-Allow-Origin: * to responses from /.well-known/* so AI agents from other domains can fetch your discovery files.',
        learnMoreUrl: guideUrl(meta.id, 'no-cors'),
      });
      score -= 10;
    }
  }

  const llmsRes = await ctx.fetch(`${ctx.url}/llms.txt`);
  if (llmsRes.ok && llmsRes.headers['x-robots-tag']?.includes('noindex')) {
    findings.push({
      status: 'pass',
      message: 'X-Robots-Tag: noindex on /llms.txt (prevents search indexing of raw text)',
    });
  }

  // Informational in 3.x: new findings inside a weighted check must not deduct.
  reportDiscoveryRelations(links, headers, findings);

  return buildResult(meta, score, findings, start);
}
