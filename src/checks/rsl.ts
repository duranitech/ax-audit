import {
  RSL_MIME,
  RSL_NAMESPACE,
  RSL_PAYMENT_TYPES,
  RSL_PERMIT_TYPES,
  RSL_USAGE_TOKENS,
  RSL_USER_TOKENS,
} from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult, checkContentType } from './utils.js';
import { findLinkTags, getAttribute, getTagAttribute } from './html-utils.js';
import { parseLinkHeader } from './http-headers.js';

export const meta: CheckMeta = {
  id: 'rsl',
  name: 'RSL License',
  description: 'Checks Really Simple Licensing (RSL) discovery and license document validity',
  weight: 0, // Informational in 3.x — will gain weight in v4.0 (score-affecting changes are treated as breaking).
};

/** Score when discovery exists but the referenced license document cannot be fetched. */
const UNREACHABLE_DOC_SCORE = 25;

interface Discovery {
  mechanism: 'robots.txt License directive' | 'Link header' | 'HTML <link rel="license">';
  url: string;
}

/** Extract `License:` directive values from robots.txt (RSL 1.0 §4.4.1). */
export function parseRobotsLicenseDirectives(text: string): string[] {
  const values: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^License:\s*(.+)$/i);
    if (m) values.push(m[1].trim());
  }
  return values;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  /* ── Discovery (RSL 1.0 §4.4–4.6) ─────────────────────────────────── */

  const discoveries: Discovery[] = [];

  const robotsRes = await ctx.fetch(`${ctx.url}/robots.txt`);
  const directives = robotsRes.ok ? parseRobotsLicenseDirectives(robotsRes.body) : [];
  for (const value of directives) {
    discoveries.push({ mechanism: 'robots.txt License directive', url: value });
  }

  const linkEntries = parseLinkHeader(ctx.headers['link'] ?? '');
  for (const entry of linkEntries) {
    if (entry.params['rel'] === 'license' && (entry.params['type'] ?? '').includes(RSL_MIME)) {
      discoveries.push({ mechanism: 'Link header', url: entry.url });
    }
  }

  for (const tag of findLinkTags(ctx.html, 'license')) {
    const type = getAttribute(tag, 'type');
    const href = getAttribute(tag, 'href');
    if (type !== null && type.toLowerCase().includes(RSL_MIME) && href !== null) {
      discoveries.push({ mechanism: 'HTML <link rel="license">', url: href });
    }
  }

  if (discoveries.length === 0) {
    findings.push({
      status: 'fail',
      message: 'No RSL license discovery found',
      detail: 'Checked robots.txt License directive, Link header, and <link rel="license" type="application/rsl+xml">',
      hint:
        'Declare machine-readable licensing terms for your content with Really Simple Licensing. ' +
        'Add to robots.txt: License: https://your-site.com/license.xml — then publish the RSL document. ' +
        'See https://rslstandard.org.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const mechanisms = [...new Set(discoveries.map((d) => d.mechanism))];
  findings.push({
    status: 'pass',
    message: `RSL license discovered via ${mechanisms.join(' + ')} (${discoveries.length} reference(s))`,
  });

  // The robots.txt directive value MUST be an absolute URI (RSL 1.0 §4.4.1).
  const relativeDirectives = directives.filter((d) => !isAbsoluteUrl(d));
  if (relativeDirectives.length > 0) {
    findings.push({
      status: 'warn',
      message: 'robots.txt License directive must be an absolute URI',
      detail: relativeDirectives.join(', '),
      hint: 'Use a fully qualified URL: License: https://your-site.com/license.xml',
      learnMoreUrl: guideUrl(meta.id, 'relative-license-url'),
    });
    score -= 10;
  }

  /* ── Fetch and validate the license document ──────────────────────── */

  const target = discoveries[0];
  const docUrl = isAbsoluteUrl(target.url) ? target.url : new URL(target.url, `${ctx.url}/`).toString();
  const docRes = await ctx.fetch(docUrl);

  if (!docRes.ok) {
    findings.push({
      status: 'fail',
      message: `RSL license document could not be fetched (${docUrl})`,
      detail: `HTTP ${docRes.status || 'network error'}`,
      hint: 'The discovery reference points to a missing document. Publish the RSL XML at the referenced URL.',
      learnMoreUrl: guideUrl(meta.id, 'fetch-failed'),
    });
    return buildResult(meta, Math.min(score, UNREACHABLE_DOC_SCORE), findings, start);
  }

  const ctFinding = checkContentType(docRes, [RSL_MIME], {
    checkId: meta.id,
    resourceLabel: 'RSL license document',
    anchor: 'wrong-content-type',
  });
  if (ctFinding) {
    findings.push(ctFinding);
    score -= 5;
  } else {
    findings.push({ status: 'pass', message: `RSL document Content-Type OK (${RSL_MIME})` });
  }

  score = validateRslDocument(docRes.body, findings, score);

  return buildResult(meta, score, findings, start);
}

/**
 * Regex-based structural validation of an RSL 1.0 document. Not a full XML parse —
 * consistent with the dependency-free approach used across all checks — but covers
 * the conformance points of §2.2 and §3: root element + namespace, <content url>,
 * <license> presence, permits/prohibits vocabulary, and payment types.
 */
function validateRslDocument(rawBody: string, findings: Finding[], score: number): number {
  const body = rawBody.replace(/<!--[\s\S]*?-->/g, '');

  if (!/<rsl[\s>]/i.test(body)) {
    findings.push({
      status: 'fail',
      message: 'Root <rsl> element not found in license document',
      hint: 'An RSL document must have <rsl xmlns="https://rslstandard.org/rsl"> as its root element.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-root'),
    });
    return score - 40;
  }

  const xmlns = getTagAttribute(body, 'rsl', 'xmlns');
  if (xmlns === RSL_NAMESPACE) {
    findings.push({ status: 'pass', message: 'Root <rsl> element with correct namespace' });
  } else {
    findings.push({
      status: 'warn',
      message: xmlns === null ? 'Missing xmlns on <rsl> root element' : `Wrong RSL namespace: "${xmlns}"`,
      hint: `Declare the default namespace: <rsl xmlns="${RSL_NAMESPACE}">`,
      learnMoreUrl: guideUrl(meta.id, 'wrong-namespace'),
    });
    score -= 15;
  }

  const contentTags = [...body.matchAll(/<content\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  if (contentTags.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No <content> elements found in license document',
      hint: 'Declare at least one <content url="/"> element wrapping a <license>.',
      learnMoreUrl: guideUrl(meta.id, 'no-content-elements'),
    });
    return score - 20;
  }

  // `url` is required on every <content>; an empty value is legal for HTML pages (§3.3).
  const missingUrl = contentTags.filter((attrs) => getAttribute(attrs, 'url') === null).length;
  if (missingUrl > 0) {
    findings.push({
      status: 'warn',
      message: `${missingUrl}/${contentTags.length} <content> element(s) missing the required url attribute`,
      hint: 'Every <content> element must carry a url attribute identifying the licensed asset (url="" is allowed for pages linked via <link rel="license">).',
      learnMoreUrl: guideUrl(meta.id, 'missing-content-url'),
    });
    score -= 10;
  } else {
    findings.push({ status: 'pass', message: `${contentTags.length} <content> element(s), all with url attribute` });
  }

  if (!/<license[\s>]/i.test(body)) {
    findings.push({
      status: 'warn',
      message: 'No <license> elements found in license document',
      hint: 'Each <content> element must contain at least one <license> element with its terms.',
      learnMoreUrl: guideUrl(meta.id, 'no-license-elements'),
    });
    score -= 15;
  }

  score = validatePermits(body, findings, score);
  score = validatePayments(body, findings, score);

  return score;
}

function validatePermits(body: string, findings: Finding[], score: number): number {
  const invalidTypes: string[] = [];
  const unknownTokens: string[] = [];
  const validSummaries: string[] = [];

  for (const m of body.matchAll(/<(permits|prohibits)\b([^>]*)>([^<]*)</gi)) {
    const element = m[1].toLowerCase();
    const type = (getAttribute(m[2], 'type') ?? '').toLowerCase();
    const tokens = m[3].trim().split(/\s+/).filter(Boolean);

    if (!RSL_PERMIT_TYPES.includes(type)) {
      invalidTypes.push(`<${element} type="${type || '(none)'}">`);
      continue;
    }
    const vocabulary = type === 'usage' ? RSL_USAGE_TOKENS : type === 'user' ? RSL_USER_TOKENS : null;
    const bad =
      vocabulary !== null
        ? tokens.filter((t) => !vocabulary.includes(t.toLowerCase()))
        : tokens.filter((t) => !/^[A-Z]{2}$/.test(t)); // geo: ISO 3166-1 alpha-2
    if (bad.length > 0) {
      unknownTokens.push(`<${element} type="${type}">: ${bad.join(' ')}`);
    } else if (tokens.length > 0) {
      validSummaries.push(`${element}[${type}]: ${tokens.join(' ')}`);
    }
  }

  if (validSummaries.length > 0) {
    findings.push({ status: 'pass', message: `License terms declared — ${validSummaries.join('; ')}` });
  }
  if (invalidTypes.length > 0) {
    findings.push({
      status: 'warn',
      message: 'permits/prohibits with invalid type attribute',
      detail: invalidTypes.join(', '),
      hint: `Valid types are: ${RSL_PERMIT_TYPES.join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'invalid-permits'),
    });
    score -= 5;
  }
  if (unknownTokens.length > 0) {
    findings.push({
      status: 'warn',
      message: 'permits/prohibits with tokens outside the RSL vocabulary',
      detail: unknownTokens.join('; '),
      hint:
        `Usage tokens: ${RSL_USAGE_TOKENS.join(', ')}. User tokens: ${RSL_USER_TOKENS.join(', ')}. ` +
        'Geo tokens: ISO 3166-1 alpha-2 codes. Pre-1.0 draft tokens (train-ai, train-genai, ai-use, ai-summarize) ' +
        'were replaced in RSL 1.0 by ai-train, ai-input, and ai-index.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-permits'),
    });
    score -= 5;
  }

  return score;
}

function validatePayments(body: string, findings: Finding[], score: number): number {
  const invalid: string[] = [];
  for (const m of body.matchAll(/<payment\b([^>]*?)\/?>/gi)) {
    const type = getAttribute(m[1], 'type');
    if (type !== null && !RSL_PAYMENT_TYPES.includes(type.toLowerCase())) {
      invalid.push(type);
    }
  }
  if (invalid.length > 0) {
    findings.push({
      status: 'warn',
      message: 'payment element(s) with invalid type attribute',
      detail: invalid.join(', '),
      hint: `Valid payment types are: ${RSL_PAYMENT_TYPES.join(', ')}. Omitting type means free.`,
      learnMoreUrl: guideUrl(meta.id, 'invalid-payment-type'),
    });
    score -= 5;
  }
  return score;
}
