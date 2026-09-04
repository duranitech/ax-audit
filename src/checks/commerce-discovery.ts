import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult, isHtmlDocument, notApplicable } from './utils.js';
import { standingNote } from './well-known.js';

/**
 * "commerce-discovery" — can an agent buy from this site without a human
 * driving the checkout?
 *
 * The Universal Commerce Protocol is the one agentic-commerce specification
 * with a published site-side discovery mechanism: a public profile at
 * `/.well-known/ucp` declaring which commerce services the merchant offers,
 * over which transports, against which schemas, and which payment handlers it
 * accepts. Google leads it, with Shopify, Etsy, Walmart and Stripe
 * participating.
 *
 * The alternatives deliberately have nothing to probe. OpenAI and Stripe's
 * Agentic Commerce Protocol states outright that it defines no discovery
 * endpoint or manifest — merchants are onboarded per platform. Google's AP2
 * advertises itself as an A2A capability extension, not a file. So this check
 * covers UCP and says plainly that the others are not discoverable rather than
 * inventing paths for them.
 *
 * It is conditional. Most sites do not sell anything, and scoring a
 * documentation site zero for lacking a commerce profile would be nonsense. The
 * check reports N/A unless the page shows commerce signals: `Product` or `Offer`
 * structured data, or links into a cart or checkout.
 */
export const meta: CheckMeta = {
  id: 'commerce-discovery',
  name: 'Commerce Discovery',
  description: 'Checks the Universal Commerce Protocol profile for agent-driven purchasing',
  weight: 0, // Informational in 3.x — gains weight in 4.0 for commerce sites.
  category: 'protocols',
};

/** UCP profile paths, in the order the specification and Google's docs use. */
const PROFILE_PATHS = ['/.well-known/ucp', '/.well-known/ucp.json'];

/** Capability names the specification defines, for reporting unknown ones. */
const KNOWN_CAPABILITY_PREFIX = 'dev.ucp.';

/**
 * Evidence that this site has a storefront an agent could transact against.
 *
 * The distinction that matters is between selling and pricing. A SaaS landing
 * page routinely carries a lone `Offer` describing its plans; that is a price
 * statement, not a catalog, and telling such a site to publish a commerce
 * profile would be wrong. So a bare `Offer` counts only alongside a second
 * signal, while an unambiguous storefront type stands on its own.
 */
export function hasCommerceSignals(html: string): { found: boolean; evidence: string[] } {
  const evidence: string[] = [];
  let weakOffer = false;

  for (const block of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (/"@type"\s*:\s*"(Product|AggregateOffer|OnlineStore|OnlineMarketplace|ItemList)"/i.test(block[1])) {
      evidence.push('Product or storefront structured data');
      break;
    }
    if (/"@type"\s*:\s*"Offer"/i.test(block[1])) weakOffer = true;
  }

  const hasCart = /<a\b[^>]+href\s*=\s*["'][^"']*\/(cart|checkout|basket|bag)\b/i.test(html);
  if (hasCart) evidence.push('links to a cart or checkout');

  if (/<meta\b[^>]+property\s*=\s*["']product:price:amount["']/i.test(html)) {
    evidence.push('product price Open Graph tags');
  }

  // A lone Offer is a plan price. Paired with a cart, it is a storefront.
  if (weakOffer && evidence.length > 0) evidence.push('Offer structured data');

  return { found: evidence.length > 0, evidence };
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  let profile: { path: string; body: string; headers: Record<string, string> } | null = null;
  for (const path of PROFILE_PATHS) {
    const res = await ctx.fetch(`${ctx.url}${path}`);
    if (res.ok && res.body.trim().length > 0 && !isHtmlDocument(res.body)) {
      profile = { path, body: res.body, headers: res.headers };
      break;
    }
    // A profile behind auth is a specification violation worth reporting, since
    // an agent has no credentials at discovery time.
    if (res.status === 401 || res.status === 403) {
      findings.push({
        status: 'fail',
        message: `${path} requires authentication`,
        detail: `HTTP ${res.status}`,
        hint: 'The UCP profile must be publicly accessible with no authentication. An agent reads it before it has any credentials.',
        learnMoreUrl: guideUrl(meta.id, 'profile-auth'),
      });
      return buildResult(meta, 0, findings, start);
    }
  }

  if (profile === null) {
    const commerce = hasCommerceSignals(ctx.html ?? '');
    if (!commerce.found) {
      findings.push({
        status: 'pass',
        message: 'No commerce surface — agentic-commerce discovery does not apply to this site',
        detail: 'No Product or Offer structured data, cart links, or product price tags found.',
      });
      return notApplicable(meta, findings, start);
    }

    findings.push({
      status: 'warn',
      message: 'Site sells something but publishes no agent-readable commerce profile',
      detail: `Commerce signals found: ${commerce.evidence.join(', ')}. Checked ${PROFILE_PATHS.join(', ')}.`,
      hint:
        'Publish a Universal Commerce Protocol profile at /.well-known/ucp so an agent can find your catalog, cart and ' +
        'checkout without a human. Note that the alternatives are not discoverable by design: the OpenAI and Stripe ' +
        'Agentic Commerce Protocol defines no manifest, and AP2 advertises itself through an A2A card extension.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({
    status: 'pass',
    message: `UCP profile published at ${profile.path}`,
    detail: standingNote(profile.path),
  });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(profile.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'fail',
      message: 'UCP profile is not valid JSON',
      hint: 'Fix the JSON syntax. An agent cannot transact against a profile it cannot parse.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }

  const ucp = (data.ucp ?? {}) as Record<string, unknown>;
  if (Object.keys(ucp).length === 0) {
    findings.push({
      status: 'fail',
      message: 'UCP profile has no "ucp" object',
      hint: 'The profile wraps everything in a top-level "ucp" object carrying version, services and payment_handlers.',
      learnMoreUrl: guideUrl(meta.id, 'no-ucp-object'),
    });
    return buildResult(meta, 20, findings, start);
  }

  score = validateVersion(ucp, findings, score);
  score = await validateServices(ctx, ucp, findings, score);
  score = validatePayments(ucp, findings, score);
  score = validateKeys(data, ucp, findings, score);

  return buildResult(meta, score, findings, start);
}

/** The version is a spec date, and it tells a client which shape to expect. */
function validateVersion(ucp: Record<string, unknown>, findings: Finding[], score: number): number {
  const version = typeof ucp.version === 'string' ? ucp.version : null;
  if (version === null) {
    findings.push({
      status: 'fail',
      message: 'UCP profile declares no version',
      hint: 'Add "version" with the specification date you implement, for example "2026-08-25".',
      learnMoreUrl: guideUrl(meta.id, 'no-version'),
    });
    return score - 20;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
    findings.push({
      status: 'warn',
      message: `UCP version "${version}" is not a specification date`,
      hint: 'UCP versions are dates, for example "2026-08-25". A semantic version here will not match any published revision.',
      learnMoreUrl: guideUrl(meta.id, 'version-format'),
    });
    return score - 10;
  }

  findings.push({ status: 'pass', message: `UCP version ${version}` });
  return score;
}

/** Services declare what an agent may do and where. Their schemas must resolve. */
async function validateServices(
  ctx: CheckContext,
  ucp: Record<string, unknown>,
  findings: Finding[],
  score: number,
): Promise<number> {
  const services = (ucp.services ?? {}) as Record<string, unknown>;
  const names = Object.keys(services);

  if (names.length === 0) {
    findings.push({
      status: 'fail',
      message: 'UCP profile declares no services',
      hint: 'Declare at least one service, for example dev.ucp.shopping, with its transports and schema URLs.',
      learnMoreUrl: guideUrl(meta.id, 'no-services'),
    });
    return score - 25;
  }

  findings.push({ status: 'pass', message: `${names.length} commerce service(s) declared: ${names.join(', ')}` });

  const unprefixed = names.filter((n) => !n.startsWith(KNOWN_CAPABILITY_PREFIX) && !n.includes('.'));
  if (unprefixed.length > 0) {
    findings.push({
      status: 'warn',
      message: 'Service name is not in reverse-DNS form',
      detail: unprefixed.join(', '),
      hint: 'Service names are reverse-DNS so vendors cannot collide, for example dev.ucp.shopping.',
      learnMoreUrl: guideUrl(meta.id, 'service-name'),
    });
    score -= 5;
  }

  // Resolve the schema URLs the profile promises. A profile pointing at a
  // missing schema is a transaction an agent starts and cannot finish.
  const schemas: string[] = [];
  for (const value of Object.values(services)) {
    collectSchemaUrls(value, schemas);
  }

  if (schemas.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No service declares a schema URL',
      hint: 'Each transport should point at the schema describing its operations, so an agent knows the request shapes.',
      learnMoreUrl: guideUrl(meta.id, 'no-schema'),
    });
    return score - 10;
  }

  const dead: string[] = [];
  for (const url of schemas.slice(0, 3)) {
    const head = await ctx.fetch(url, { method: 'HEAD' });
    const res = head.status === 405 || head.status === 501 ? await ctx.fetch(url) : head;
    if (!res.ok) dead.push(`${url} (HTTP ${res.status || 'network error'})`);
  }

  if (dead.length > 0) {
    findings.push({
      status: 'fail',
      message: `${dead.length} declared schema URL(s) cannot be fetched`,
      detail: dead.join('\n'),
      hint: 'An agent reads the schema before it builds a request. A dead schema is a transaction it starts and cannot finish.',
      learnMoreUrl: guideUrl(meta.id, 'dead-schema'),
    });
    score -= 20;
  } else {
    findings.push({ status: 'pass', message: `${Math.min(schemas.length, 3)} declared schema URL(s) resolve` });
  }

  return score;
}

/** Walk a service definition for `schema` URLs, whatever transport shape it uses. */
function collectSchemaUrls(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaUrls(item, into);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'schema' && typeof child === 'string' && /^https?:\/\//.test(child)) {
      into.push(child);
      continue;
    }
    collectSchemaUrls(child, into);
  }
}

/** Without a payment handler, an agent can browse but not buy. */
function validatePayments(ucp: Record<string, unknown>, findings: Finding[], score: number): number {
  const handlers = ucp.payment_handlers ?? (ucp.payment as Record<string, unknown> | undefined)?.handlers;
  const list = Array.isArray(handlers) ? (handlers as Record<string, unknown>[]) : [];

  if (list.length === 0) {
    findings.push({
      status: 'warn',
      message: 'UCP profile declares no payment handlers',
      hint: 'Without a payment handler an agent can read your catalog but cannot complete a purchase. Declare the handlers you accept.',
      learnMoreUrl: guideUrl(meta.id, 'no-payment-handlers'),
    });
    return score - 15;
  }

  const named = list.map((h) => String(h.name ?? '(unnamed)'));
  findings.push({ status: 'pass', message: `${list.length} payment handler(s): ${named.join(', ')}` });

  const unnamed = list.filter((h) => h.name === undefined).length;
  if (unnamed > 0) {
    findings.push({
      status: 'warn',
      message: `${unnamed} payment handler(s) have no name`,
      hint: 'Each handler needs a name so an agent can match it against the payment methods it holds.',
      learnMoreUrl: guideUrl(meta.id, 'unnamed-handler'),
    });
    score -= 5;
  }

  return score;
}

/** Signing keys let an agent verify the profile belongs to the merchant. */
function validateKeys(
  data: Record<string, unknown>,
  ucp: Record<string, unknown>,
  findings: Finding[],
  score: number,
): number {
  const keys = data.keys ?? data.signing_keys ?? ucp.keys ?? ucp.signing_keys;
  const list = Array.isArray(keys) ? keys : [];

  if (list.length === 0) {
    findings.push({
      status: 'warn',
      message: 'UCP profile declares no signing keys',
      hint: 'Publish the public keys an agent uses to verify your responses. Money is moving; identity should not rest on DNS alone.',
      learnMoreUrl: guideUrl(meta.id, 'no-keys'),
    });
    return score - 10;
  }

  findings.push({ status: 'pass', message: `${list.length} signing key(s) published` });
  return score;
}
