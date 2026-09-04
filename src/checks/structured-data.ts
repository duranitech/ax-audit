import { guideUrl } from '../guide-urls.js';
import { extractVisibleText } from './html-utils.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

export const meta: CheckMeta = {
  id: 'structured-data',
  name: 'Structured Data',
  description: 'Checks JSON-LD structured data on homepage',
  weight: 9,
};

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const html = ctx.html;
  if (!html) {
    findings.push({ status: 'fail', message: 'Could not fetch homepage HTML' });
    return buildResult(meta, 0, findings, start);
  }

  const jsonLdPattern = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks = [...html.matchAll(jsonLdPattern)];

  if (blocks.length === 0) {
    findings.push({
      status: 'fail',
      message: 'No JSON-LD structured data found',
      hint: 'Add a <script type="application/ld+json"> block in your HTML <head> with schema.org structured data describing your site, organization, or person.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({ status: 'pass', message: `${blocks.length} JSON-LD block(s) found` });

  const parsed: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const raw = unescapeHtml(block[1]);
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      findings.push({
        status: 'warn',
        message: 'Invalid JSON in a JSON-LD block',
        hint: 'Validate your JSON-LD syntax. Check for trailing commas, missing quotes, or unescaped characters. Use https://validator.schema.org/ to test.',
        learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
      });
      score -= 10;
    }
  }

  if (parsed.length === 0) {
    findings.push({
      status: 'fail',
      message: 'All JSON-LD blocks have invalid JSON',
      hint: 'Fix the JSON syntax errors in your JSON-LD blocks. Use a JSON linter or https://validator.schema.org/ to validate.',
      learnMoreUrl: guideUrl(meta.id, 'all-invalid'),
    });
    return buildResult(meta, 10, findings, start);
  }

  const hasContext = parsed.some((d) => isSchemaOrgContext(d['@context']));
  if (hasContext) {
    findings.push({ status: 'pass', message: '@context references schema.org' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No @context referencing schema.org',
      hint: 'Add "@context": "https://schema.org" to your JSON-LD root object.',
      learnMoreUrl: guideUrl(meta.id, 'missing-context'),
    });
    score -= 15;
  }

  const hasGraph = parsed.some((d) => Array.isArray(d['@graph']));
  if (hasGraph) {
    findings.push({ status: 'pass', message: '@graph array present (multi-entity structured data)' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No @graph array (single-entity only)',
      hint: 'Use an @graph array to define multiple entities in one JSON-LD block: { "@context": "https://schema.org", "@graph": [...] }',
      learnMoreUrl: guideUrl(meta.id, 'no-graph'),
    });
    score -= 5;
  }

  const allTypes = new Set<string>();
  for (const d of parsed) {
    collectTypes(d, allTypes);
  }

  const importantTypes = ['Person', 'Organization', 'WebSite', 'WebPage', 'ProfilePage'];
  const foundTypes = importantTypes.filter((t) => allTypes.has(t));

  if (foundTypes.length >= 2) {
    findings.push({ status: 'pass', message: `Key types found: ${foundTypes.join(', ')}` });
  } else if (foundTypes.length === 1) {
    findings.push({
      status: 'warn',
      message: `Only 1 key type found: ${foundTypes[0]}`,
      detail: `Consider adding: ${importantTypes.filter((t) => !allTypes.has(t)).join(', ')}`,
      hint: 'Add more entity types to your @graph. AI agents use these to understand site structure. Common types: Person, Organization, WebSite, WebPage.',
      learnMoreUrl: guideUrl(meta.id, 'few-types'),
    });
    score -= 10;
  } else {
    findings.push({
      status: 'warn',
      message: 'No key entity types (Person, Organization, WebSite, etc.)',
      hint: 'Add @type to your JSON-LD entities. Use Person or Organization for the owner, WebSite for the site, and WebPage for individual pages.',
      learnMoreUrl: guideUrl(meta.id, 'no-types'),
    });
    score -= 15;
  }

  if (allTypes.has('BreadcrumbList')) {
    findings.push({ status: 'pass', message: 'BreadcrumbList present' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No BreadcrumbList found',
      hint: 'Add a BreadcrumbList entity to help AI agents understand your site navigation hierarchy.',
      learnMoreUrl: guideUrl(meta.id, 'no-breadcrumb'),
    });
    score -= 5;
  }

  // Informational in 3.x: new findings inside a weighted check must not deduct.
  reportProvenance(parsed, findings);
  reportFreshness(parsed, findings);
  reportVisibleTextAgreement(parsed, html, findings);

  return buildResult(meta, score, findings, start);
}

/* ── Provenance and freshness (informational in 3.x) ────────────────────── */

/** Walk a JSON-LD tree, yielding every object node. */
function* nodes(value: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  yield obj;
  for (const child of Object.values(obj)) yield* nodes(child, depth + 1);
}

/** Read a property that may be a string, an object with a name, or a list of either. */
function readNames(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(readNames);
  if (value !== null && typeof value === 'object') {
    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' ? [name] : [];
  }
  return [];
}

/**
 * Who wrote this, and can it be tied to an entity that exists elsewhere?
 *
 * An assistant deciding whether to cite a page weighs where it came from. A
 * byline with no `sameAs` is a string; a byline linked to Wikidata, an ORCID or
 * a company page is an entity a model can already have an opinion about.
 */
function reportProvenance(parsed: Record<string, unknown>[], findings: Finding[]): void {
  const authors = new Set<string>();
  const sameAs = new Set<string>();
  let publisher = false;
  let organizationDetail = false;

  for (const root of parsed) {
    for (const node of nodes(root)) {
      for (const name of readNames(node.author)) authors.add(name);
      if (node.publisher !== undefined) publisher = true;
      for (const url of readNames(node.sameAs)) sameAs.add(url);
      if (Array.isArray(node.sameAs)) {
        for (const url of node.sameAs) if (typeof url === 'string') sameAs.add(url);
      } else if (typeof node.sameAs === 'string') {
        sameAs.add(node.sameAs);
      }
      if (
        node.companyRegistration !== undefined ||
        node.legalAddress !== undefined ||
        node.contactPoint !== undefined
      ) {
        organizationDetail = true;
      }
    }
  }

  if (authors.size > 0) {
    findings.push({ status: 'pass', message: `Authorship declared: ${[...authors].slice(0, 3).join(', ')}` });
  } else {
    findings.push({
      status: 'warn',
      message: 'No author declared in structured data',
      hint:
        'An assistant deciding whether to cite a page weighs where it came from. Add author as a Person or ' +
        'Organization, not a bare string.',
      learnMoreUrl: guideUrl(meta.id, 'no-author'),
    });
  }

  if (sameAs.size > 0) {
    findings.push({
      status: 'pass',
      message: `${sameAs.size} sameAs link(s) tie your entity to external identifiers`,
      detail: [...sameAs].slice(0, 4).join(', '),
    });
  } else {
    findings.push({
      status: 'warn',
      message: 'No sameAs links',
      hint:
        'sameAs is what turns a name into an entity. Link your Organization or Person to Wikidata, LinkedIn, GitHub ' +
        'or Crunchbase so a model can connect this page to what it already knows.',
      learnMoreUrl: guideUrl(meta.id, 'no-same-as'),
    });
  }

  if (!publisher && authors.size > 0) {
    findings.push({
      status: 'warn',
      message: 'Author declared but no publisher',
      hint: 'Declare publisher as well, so a citation can name the outlet as well as the writer.',
      learnMoreUrl: guideUrl(meta.id, 'no-publisher'),
    });
  }

  if (organizationDetail) {
    findings.push({
      status: 'pass',
      message: 'Organization carries disambiguating detail (registration, legal address or contact point)',
    });
  }
}

/** Freshness buckets, in days. */
const FRESH_DAYS = 90;
const STALE_DAYS = 730;

/**
 * When did this page last change?
 *
 * Assistants answering time-sensitive questions weigh recency, and a page with
 * no date at all cannot be weighed. The check reports rather than penalises:
 * an evergreen reference page is legitimately old.
 */
function reportFreshness(parsed: Record<string, unknown>[], findings: Finding[]): void {
  const dates: { field: string; value: Date }[] = [];

  for (const root of parsed) {
    for (const node of nodes(root)) {
      for (const field of ['dateModified', 'datePublished', 'uploadDate']) {
        const raw = node[field];
        if (typeof raw !== 'string') continue;
        const parsedDate = new Date(raw);
        if (Number.isNaN(parsedDate.getTime())) {
          findings.push({
            status: 'warn',
            message: `${field} is not a parseable date: "${raw}"`,
            hint: 'Use ISO 8601, for example 2026-09-04 or 2026-09-04T12:00:00Z.',
            learnMoreUrl: guideUrl(meta.id, 'invalid-date'),
          });
          continue;
        }
        dates.push({ field, value: parsedDate });
      }
    }
  }

  if (dates.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No dateModified or datePublished in structured data',
      hint:
        'Assistants weigh recency when they answer time-sensitive questions, and a page with no date cannot be ' +
        'weighed at all. Add dateModified to anything that changes.',
      learnMoreUrl: guideUrl(meta.id, 'no-dates'),
    });
    return;
  }

  const newest = dates.reduce((a, b) => (a.value > b.value ? a : b));
  const days = Math.round((Date.now() - newest.value.getTime()) / 86_400_000);

  if (days < 0) {
    findings.push({
      status: 'warn',
      message: `${newest.field} is in the future (${newest.value.toISOString().slice(0, 10)})`,
      hint: 'A future date reads as a mistake or as manipulation. Use the real modification time.',
      learnMoreUrl: guideUrl(meta.id, 'future-date'),
    });
    return;
  }

  findings.push({
    status: days > STALE_DAYS ? 'warn' : 'pass',
    message: `Content last dated ${newest.value.toISOString().slice(0, 10)} (${days} days ago)`,
    ...(days > STALE_DAYS
      ? {
          hint: 'Over two years without a recorded update. If the page is still accurate, refresh dateModified so an assistant knows that; if it is not, it is answering with stale facts.',
          learnMoreUrl: guideUrl(meta.id, 'stale-content'),
        }
      : days < FRESH_DAYS
        ? {}
        : { detail: 'Fine for reference material; worth refreshing on anything time-sensitive.' }),
  });
}

/**
 * Google's one explicit ask about structured data and AI features is that it
 * match the visible text. Markup describing a page that is not there is the
 * oldest form of spam, and it is now graded by systems that quote it.
 */
function reportVisibleTextAgreement(parsed: Record<string, unknown>[], html: string, findings: Finding[]): void {
  const visible = extractVisibleText(html).toLowerCase();
  if (visible.length < 200) return;

  const claims: { field: string; value: string }[] = [];
  for (const root of parsed) {
    for (const node of nodes(root)) {
      for (const field of ['headline', 'name']) {
        const value = node[field];
        if (typeof value === 'string' && value.length >= 12 && value.length <= 110) {
          claims.push({ field, value });
        }
      }
    }
  }
  if (claims.length === 0) return;

  const missing = claims.filter((c) => !visible.includes(c.value.toLowerCase())).slice(0, 3);
  if (missing.length === 0) {
    findings.push({ status: 'pass', message: 'Structured-data headings appear in the visible text' });
    return;
  }

  findings.push({
    status: 'warn',
    message: `${missing.length} structured-data value(s) do not appear in the visible text`,
    detail: missing.map((c) => `${c.field}: "${c.value}"`).join('\n'),
    hint:
      'Google\u2019s one explicit requirement for structured data and AI features is that it match what a reader sees. ' +
      'Markup describing a page that is not there is the oldest form of spam, and it is now graded by systems that ' +
      'quote it. Note this compares the static HTML, so text rendered by script will read as missing here too.',
    learnMoreUrl: guideUrl(meta.id, 'markup-mismatch'),
  });
}

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function isSchemaOrgContext(context: unknown): boolean {
  if (typeof context === 'string') {
    return /^https?:\/\/schema\.org\/?$/.test(context);
  }
  if (Array.isArray(context)) {
    return context.some((item) => isSchemaOrgContext(item));
  }
  if (context && typeof context === 'object') {
    const record = context as Record<string, unknown>;
    if (typeof record['@vocab'] === 'string') {
      return /^https?:\/\/schema\.org\/?$/.test(record['@vocab']);
    }
  }
  return false;
}

function collectTypes(obj: unknown, types: Set<string>, depth = 0): void {
  if (!obj || typeof obj !== 'object' || depth > 10) return;

  if (Array.isArray(obj)) {
    obj.forEach((item) => collectTypes(item, types, depth + 1));
    return;
  }

  const record = obj as Record<string, unknown>;
  if (record['@type']) {
    const t = Array.isArray(record['@type']) ? (record['@type'] as string[]) : [record['@type'] as string];
    t.forEach((type) => types.add(type));
  }

  if (Array.isArray(record['@graph'])) {
    (record['@graph'] as unknown[]).forEach((item) => collectTypes(item, types, depth + 1));
  }

  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('@')) continue;
    if (value && typeof value === 'object') {
      collectTypes(value, types, depth + 1);
    }
  }
}
