/**
 * Classify what actually happened to a request, beyond `res.ok`.
 *
 * An audit that probes a site with a crawler user agent gets back a status code
 * and has to answer one question honestly: *does this site block AI crawlers?*
 * A bare 403 does not answer it. The same 403 can mean:
 *
 * - a deliberate AI-crawler block in the WAF (a real finding);
 * - a JavaScript challenge that any fetch-only client fails, real crawler
 *   included (a different, usually accidental, finding);
 * - anti-spoofing: the edge verifies crawlers by IP range or by Web Bot Auth
 *   signature, so it rejects *this* probe precisely because the probe is
 *   unsigned and comes from the wrong network, while admitting the genuine
 *   crawler (not a finding at all — the site is behaving correctly).
 *
 * Reporting all three as "blocks AI crawlers" would be wrong often enough to
 * make the check untrustworthy. So every classification carries the evidence
 * that produced it and an `inconclusive` flag for the cases an unauthenticated
 * probe genuinely cannot settle.
 *
 * Header signatures verified 2026-09-04:
 * - Cloudflare challenge: `cf-mitigated: challenge`, always `text/html`.
 *   https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
 * - AWS WAF challenge: HTTP **202** with `x-amzn-waf-action: challenge`.
 *   https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html
 * - Vercel challenge: `x-vercel-mitigated: challenge` plus `x-vercel-challenge-token`.
 * - Cloudflare pay-per-crawl: 402 with `crawler-price`.
 *   https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/
 * - AWS WAF / x402 monetization: 402 with `payment-signature` or an x402 body.
 * - Web Bot Auth required: 403 with `Accept-Signature`.
 *   https://datatracker.ietf.org/doc/html/draft-ietf-webbotauth-httpsig-protocol
 * - RSL Open Licensing Protocol: 401/402 with `WWW-Authenticate: License`.
 */
import type { FetchResponse } from '../types.js';

export type ResponseKind =
  | 'ok'
  /** An interstitial that requires running JavaScript. Fetch-only clients never get past it. */
  | 'challenge'
  /** 402 with a crawler price attached: content is monetised, not blocked. */
  | 'paywall'
  /** 403 asking the client to re-request with an HTTP Message Signature. */
  | 'needs-signature'
  /** 401/402 pointing at a machine-readable licence (RSL Open Licensing Protocol). */
  | 'license-required'
  | 'rate-limited'
  /** A plain refusal with no negotiation offered. */
  | 'blocked'
  | 'not-found'
  | 'server-error'
  | 'network-error';

export interface ResponseClass {
  kind: ResponseKind;
  /** Edge or WAF vendor implicated, when the response identifies one. */
  vendor?: string;
  /** One sentence describing the outcome, written for a report. */
  label: string;
  /** Header names, values or body markers that produced this classification. */
  evidence: string[];
  /**
   * True when this response cannot settle whether the site blocks AI crawlers.
   * A challenge and a signature demand both reject an unsigned probe from a
   * non-vendor IP while potentially admitting the genuine crawler.
   */
  inconclusive: boolean;
  /** Price string from a pay-per-crawl response, e.g. `USD 0.01`. */
  price?: string;
}

/** Body markers for challenge interstitials that do not set a header. */
const CHALLENGE_BODY_MARKERS: { marker: RegExp; vendor: string }[] = [
  { marker: /\/cdn-cgi\/challenge-platform\//i, vendor: 'Cloudflare' },
  { marker: /<title>\s*Just a moment/i, vendor: 'Cloudflare' },
  { marker: /Vercel Security Checkpoint/i, vendor: 'Vercel' },
  { marker: /challenges\.cloudflare\.com\/turnstile/i, vendor: 'Cloudflare Turnstile' },
  { marker: /www\.google\.com\/recaptcha\//i, vendor: 'reCAPTCHA' },
  { marker: /\bhcaptcha\.com\/(1\/api\.js|captcha)/i, vendor: 'hCaptcha' },
  { marker: /_Incapsula_Resource|Incapsula incident ID/i, vendor: 'Imperva' },
  { marker: /Checking your browser before accessing/i, vendor: 'Cloudflare' },
  { marker: /Please enable (JS|JavaScript) and disable any ad ?blocker/i, vendor: 'Cloudflare' },
  { marker: /Request unsuccessful\. Incapsula/i, vendor: 'Imperva' },
  { marker: /Pardon Our Interruption/i, vendor: 'Imperva' },
  { marker: /PerimeterX|px-captcha/i, vendor: 'HUMAN (PerimeterX)' },
  { marker: /Access Denied.*Reference #[0-9a-f.]+/is, vendor: 'Akamai' },
];

/** Identify the CDN or edge from response headers, for context in findings. */
export function detectEdgeVendor(headers: Record<string, string>): string | undefined {
  if (headers['cf-ray'] !== undefined || /cloudflare/i.test(headers['server'] ?? '')) return 'Cloudflare';
  if (headers['x-vercel-id'] !== undefined || /vercel/i.test(headers['server'] ?? '')) return 'Vercel';
  if (headers['x-amzn-waf-action'] !== undefined || headers['x-amz-cf-id'] !== undefined) return 'AWS';
  if (headers['x-served-by']?.includes('cache-') || /varnish/i.test(headers['via'] ?? '')) return 'Fastly';
  if (headers['x-akamai-transformed'] !== undefined || /akamai/i.test(headers['server'] ?? '')) return 'Akamai';
  if (/netlify/i.test(headers['server'] ?? '')) return 'Netlify';
  return undefined;
}

function withVendor(base: string, vendor: string | undefined): string {
  return vendor === undefined ? base : `${base} (${vendor})`;
}

/**
 * Classify a fetch result. Pure and total: any response produces a
 * classification, and unknown shapes fall back to status-based buckets.
 */
export function classifyResponse(res: FetchResponse): ResponseClass {
  const h = res.headers ?? {};
  const edge = detectEdgeVendor(h);
  const body = res.body ?? '';

  if (res.status === 0) {
    return {
      kind: 'network-error',
      label: res.error ? `Network error: ${res.error}` : 'Network error',
      evidence: res.error ? [res.error] : [],
      inconclusive: true,
    };
  }

  /* ── Challenges: an interstitial, not a policy decision ───────────────── */

  if ((h['cf-mitigated'] ?? '').toLowerCase() === 'challenge') {
    return {
      kind: 'challenge',
      vendor: 'Cloudflare',
      label: 'Cloudflare served a challenge page',
      evidence: ['cf-mitigated: challenge'],
      inconclusive: true,
    };
  }

  if ((h['x-vercel-mitigated'] ?? '').toLowerCase() === 'challenge' || h['x-vercel-challenge-token'] !== undefined) {
    return {
      kind: 'challenge',
      vendor: 'Vercel',
      label: 'Vercel served a security checkpoint',
      evidence: [
        h['x-vercel-mitigated'] !== undefined ? `x-vercel-mitigated: ${h['x-vercel-mitigated']}` : '',
        h['x-vercel-challenge-token'] !== undefined ? 'x-vercel-challenge-token present' : '',
      ].filter(Boolean),
      inconclusive: true,
    };
  }

  if ((h['x-amzn-waf-action'] ?? '').toLowerCase() === 'challenge') {
    return {
      kind: 'challenge',
      vendor: 'AWS WAF',
      label: `AWS WAF served a challenge (HTTP ${res.status})`,
      evidence: [`x-amzn-waf-action: challenge`, `status ${res.status}`],
      inconclusive: true,
    };
  }

  /* ── Payment and licensing: an offer, not a refusal ───────────────────── */

  if (res.status === 402) {
    const price = h['crawler-price'];
    if (price !== undefined) {
      return {
        kind: 'paywall',
        vendor: 'Cloudflare pay-per-crawl',
        label: `Content is priced for crawlers at ${price}`,
        evidence: [`crawler-price: ${price}`],
        inconclusive: false,
        price,
      };
    }
    if (h['payment-signature'] !== undefined || /"(payTo|maxTimeoutSeconds|x402Version)"/.test(body)) {
      return {
        kind: 'paywall',
        vendor: withVendor('x402', edge),
        label: 'Content is monetised through an x402 payment challenge',
        evidence: [h['payment-signature'] !== undefined ? 'payment-signature header' : 'x402 fields in body'],
        inconclusive: false,
      };
    }
    if (/^License\b/i.test(h['www-authenticate'] ?? '')) {
      return {
        kind: 'license-required',
        vendor: 'RSL Open Licensing Protocol',
        label: 'A licence is required before this content may be used',
        evidence: [`www-authenticate: ${h['www-authenticate']}`],
        inconclusive: false,
      };
    }
    return {
      kind: 'blocked',
      vendor: edge,
      label: withVendor('Refused with 402 but no payment mechanism advertised', edge),
      evidence: ['status 402 with no crawler-price, x402 fields, or licence challenge'],
      inconclusive: false,
    };
  }

  if (res.status === 401 && /^License\b/i.test(h['www-authenticate'] ?? '')) {
    return {
      kind: 'license-required',
      vendor: 'RSL Open Licensing Protocol',
      label: 'A licence is required before this content may be used',
      evidence: [`www-authenticate: ${h['www-authenticate']}`],
      inconclusive: false,
    };
  }

  /* ── Signature demands: the site wants a verifiable agent ─────────────── */

  if ((res.status === 401 || res.status === 403) && h['accept-signature'] !== undefined) {
    return {
      kind: 'needs-signature',
      vendor: withVendor('Web Bot Auth', edge),
      label: 'The origin requires a signed request (Web Bot Auth)',
      evidence: [`accept-signature: ${h['accept-signature']}`],
      inconclusive: true,
    };
  }

  if (res.status === 429) {
    return {
      kind: 'rate-limited',
      vendor: edge,
      label: h['retry-after'] !== undefined ? `Rate limited, retry after ${h['retry-after']}` : 'Rate limited',
      evidence: h['retry-after'] !== undefined ? [`retry-after: ${h['retry-after']}`] : ['status 429'],
      inconclusive: true,
    };
  }

  /* ── Body-marker challenges, on any status ────────────────────────────── */

  const bodyChallenge = CHALLENGE_BODY_MARKERS.find((m) => m.marker.test(body));
  if (bodyChallenge !== undefined) {
    return {
      kind: 'challenge',
      vendor: bodyChallenge.vendor,
      label: `${bodyChallenge.vendor} interstitial served instead of the page`,
      evidence: [`body matched ${bodyChallenge.vendor} challenge markup`, `status ${res.status}`],
      inconclusive: true,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      kind: 'blocked',
      vendor: edge,
      label: withVendor(`Refused with HTTP ${res.status}`, edge),
      evidence: [`status ${res.status}`],
      // An edge that verifies bots by IP range or signature rejects an unsigned
      // probe on principle, so a bare 403 from a known bot-managing CDN cannot
      // prove a policy block.
      inconclusive: edge !== undefined,
    };
  }

  if (res.status === 404 || res.status === 410) {
    return { kind: 'not-found', vendor: edge, label: `HTTP ${res.status}`, evidence: [], inconclusive: false };
  }

  if (res.status >= 500) {
    return {
      kind: 'server-error',
      vendor: edge,
      label: `Server error (HTTP ${res.status})`,
      evidence: [`status ${res.status}`],
      inconclusive: true,
    };
  }

  if (res.ok) {
    return { kind: 'ok', vendor: edge, label: `HTTP ${res.status}`, evidence: [], inconclusive: false };
  }

  return {
    kind: 'blocked',
    vendor: edge,
    label: `Unexpected HTTP ${res.status}`,
    evidence: [`status ${res.status}`],
    inconclusive: true,
  };
}

/**
 * Standard caveat for classifications an unauthenticated probe cannot settle.
 * Appended to hints so a report never overstates what it observed.
 */
export const INCONCLUSIVE_CAVEAT =
  'ax-audit sends this user agent from its own network without a Web Bot Auth signature, so an edge that verifies ' +
  'crawlers by IP range or signature will reject the probe while admitting the real crawler. Confirm against your ' +
  'WAF logs before changing any rule.';
