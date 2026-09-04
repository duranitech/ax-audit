import { SECURITY_TXT_REQUIRED_FIELDS } from '../constants.js';
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

export const meta: CheckMeta = {
  id: 'security-txt',
  name: 'Security.txt',
  description: 'Checks /.well-known/security.txt RFC 9116 compliance',
};

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const res = await ctx.fetch(`${ctx.url}/.well-known/security.txt`);

  if (!res.ok) {
    findings.push({
      status: 'fail',
      message: '/.well-known/security.txt not found',
      detail: `HTTP ${res.status || 'network error'}`,
      hint: 'Create a /.well-known/security.txt file per RFC 9116. At minimum, include Contact: and Expires: fields. See https://securitytxt.org/ for a generator.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({ status: 'pass', message: '/.well-known/security.txt exists' });
  const text = res.body;

  for (const field of SECURITY_TXT_REQUIRED_FIELDS) {
    const regex = new RegExp(`^${field}:`, 'mi');
    if (regex.test(text)) {
      findings.push({ status: 'pass', message: `Required field "${field}" present` });
    } else {
      findings.push({
        status: 'fail',
        message: `Required field "${field}" missing (RFC 9116)`,
        hint: `Add "${field}:" to your security.txt. ${field === 'Contact' ? 'Use a mailto: or https: URI, e.g., Contact: mailto:security@example.com' : 'Use an ISO 8601 date, e.g., Expires: 2026-12-31T23:59:59.000Z'}`,
        learnMoreUrl: guideUrl(meta.id, 'missing-field'),
      });
      score -= 25;
    }
  }

  const expiresMatch = text.match(/^Expires:\s*(.+)/im);
  if (expiresMatch) {
    const expiresDate = new Date(expiresMatch[1].trim());
    if (!isNaN(expiresDate.getTime())) {
      if (expiresDate > new Date()) {
        findings.push({
          status: 'pass',
          message: `Expires date is in the future (${expiresDate.toISOString().split('T')[0]})`,
        });
      } else {
        findings.push({
          status: 'fail',
          message: 'Expires date is in the past — security.txt is expired',
          hint: 'Update the Expires field to a future date. RFC 9116 requires security.txt to have a valid, non-expired date.',
          learnMoreUrl: guideUrl(meta.id, 'expired'),
        });
        score -= 20;
      }
    }
  }

  const optionalFields = ['Canonical', 'Preferred-Languages', 'Policy', 'Encryption', 'Hiring'];
  const present = optionalFields.filter((f) => new RegExp(`^${f}:`, 'mi').test(text));
  if (present.length >= 3) {
    findings.push({ status: 'pass', message: `${present.length}/${optionalFields.length} optional fields present` });
  } else if (present.length > 0) {
    findings.push({ status: 'pass', message: `${present.length}/${optionalFields.length} optional fields present` });
  } else {
    findings.push({
      status: 'warn',
      message: 'No optional fields (Canonical, Preferred-Languages, Policy, etc.)',
      hint: 'Consider adding Canonical: (canonical URL), Preferred-Languages: (e.g., en), and Policy: (link to your security policy).',
      learnMoreUrl: guideUrl(meta.id, 'missing-optional'),
    });
    score -= 5;
  }

  return buildResult(meta, score, findings, start);
}
