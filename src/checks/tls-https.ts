import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

/**
 * "tls-https" — verify the site is served over HTTPS, that bare HTTP redirects to HTTPS,
 * and that HSTS is properly configured (with `preload` + `includeSubDomains` for full
 * coverage). Many AI agents refuse to fetch plaintext HTTP and downgrade trust on
 * misconfigured TLS.
 *
 * The check intentionally avoids verifying the certificate chain — Node's `fetch` already
 * fails on invalid certificates, so a successful HTTPS fetch is itself a positive signal.
 */
export const meta: CheckMeta = {
  id: 'tls-https',
  name: 'TLS / HTTPS',
  description: 'Checks HTTPS, HTTP→HTTPS redirect, and HSTS configuration',
};

const HSTS_MIN_MAX_AGE = 15_768_000;
const HSTS_PRELOAD_MIN_MAX_AGE = 31_536_000;

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  let parsed: URL;
  try {
    parsed = new URL(ctx.url);
  } catch {
    findings.push({
      status: 'fail',
      message: `Invalid URL: ${ctx.url}`,
      hint: 'Provide a fully qualified URL including scheme (https://...).',
      learnMoreUrl: guideUrl(meta.id, 'invalid-url'),
    });
    return buildResult(meta, 0, findings, start);
  }

  if (parsed.protocol === 'https:') {
    findings.push({ status: 'pass', message: 'Site is served over HTTPS' });
  } else {
    findings.push({
      status: 'fail',
      message: `Site is served over ${parsed.protocol.replace(':', '').toUpperCase()} (not HTTPS)`,
      hint: 'Serve the site over HTTPS. Most AI crawlers refuse plaintext HTTP and downgrade trust on insecure origins.',
      learnMoreUrl: guideUrl(meta.id, 'no-https'),
    });
    score -= 50;
  }

  if (parsed.protocol === 'https:') {
    const httpUrl = `http://${parsed.host}${parsed.pathname || ''}`;
    const httpRes = await ctx.fetch(httpUrl);
    const finalUrl = httpRes.url || '';
    if (httpRes.ok && /^https:\/\//i.test(finalUrl)) {
      findings.push({ status: 'pass', message: 'HTTP requests redirect to HTTPS' });
    } else if (!httpRes.ok && httpRes.status === 0) {
      findings.push({
        status: 'pass',
        message: 'HTTP endpoint not reachable (HTTPS-only — acceptable)',
      });
    } else if (httpRes.ok && /^http:\/\//i.test(finalUrl)) {
      findings.push({
        status: 'fail',
        message: 'HTTP request did not redirect to HTTPS',
        detail: `Final URL: ${finalUrl}`,
        hint: 'Configure your server to 301-redirect every http:// request to https://. Otherwise agents may cache the insecure variant.',
        learnMoreUrl: guideUrl(meta.id, 'no-redirect'),
      });
      score -= 15;
    } else {
      findings.push({
        status: 'warn',
        message: 'Could not verify HTTP→HTTPS redirect',
        detail: `HTTP ${httpRes.status} on ${httpUrl}`,
        hint: 'Test manually: a request to http://your-site.com should respond with 301 → https://your-site.com.',
        learnMoreUrl: guideUrl(meta.id, 'redirect-unknown'),
      });
      score -= 5;
    }
  }

  const hsts = ctx.headers['strict-transport-security'];
  if (!hsts) {
    findings.push({
      status: 'warn',
      message: 'No Strict-Transport-Security header',
      hint: 'Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload. This locks browsers and many agents to HTTPS for 1 year.',
      learnMoreUrl: guideUrl(meta.id, 'no-hsts'),
    });
    score -= 15;
  } else {
    const maxAge = parseHstsMaxAge(hsts);
    const includesSubDomains = /includeSubDomains/i.test(hsts);
    const preload = /preload/i.test(hsts);

    if (maxAge === null) {
      findings.push({
        status: 'warn',
        message: 'HSTS header has no max-age directive',
        detail: hsts,
        hint: 'Set a numeric max-age, e.g., max-age=31536000.',
        learnMoreUrl: guideUrl(meta.id, 'hsts-no-maxage'),
      });
      score -= 10;
    } else if (maxAge < HSTS_MIN_MAX_AGE) {
      findings.push({
        status: 'warn',
        message: `HSTS max-age is short (${maxAge}s = ~${Math.round(maxAge / 86400)} days)`,
        hint: `Use at least max-age=${HSTS_MIN_MAX_AGE} (~6 months); preload list submission requires max-age=${HSTS_PRELOAD_MIN_MAX_AGE} (1 year).`,
        learnMoreUrl: guideUrl(meta.id, 'hsts-short'),
      });
      score -= 5;
    } else {
      findings.push({ status: 'pass', message: `HSTS max-age=${maxAge}` });
    }

    if (includesSubDomains) {
      findings.push({ status: 'pass', message: 'HSTS includes subdomains' });
    } else {
      findings.push({
        status: 'warn',
        message: 'HSTS does not include subdomains',
        hint: 'Add includeSubDomains to apply HSTS across api., docs., etc. Required for preload list submission.',
        learnMoreUrl: guideUrl(meta.id, 'hsts-no-subdomains'),
      });
      score -= 5;
    }

    if (preload) {
      if (maxAge !== null && maxAge >= HSTS_PRELOAD_MIN_MAX_AGE && includesSubDomains) {
        findings.push({ status: 'pass', message: 'HSTS preload-eligible' });
      } else {
        findings.push({
          status: 'warn',
          message: 'HSTS has preload directive but does not satisfy preload-list requirements',
          hint: `Preload requires max-age >= ${HSTS_PRELOAD_MIN_MAX_AGE} and includeSubDomains. See https://hstspreload.org.`,
          learnMoreUrl: guideUrl(meta.id, 'hsts-preload-invalid'),
        });
        score -= 5;
      }
    } else {
      findings.push({
        status: 'warn',
        message: 'HSTS lacks the preload directive',
        hint: 'Add preload (and ensure max-age >= 31536000 + includeSubDomains) and submit the domain at https://hstspreload.org for browser-built-in HTTPS enforcement.',
        learnMoreUrl: guideUrl(meta.id, 'hsts-no-preload'),
      });
      score -= 3;
    }
  }

  return buildResult(meta, score, findings, start);
}

function parseHstsMaxAge(value: string): number | null {
  const m = value.match(/max-age\s*=\s*"?(\d+)"?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
