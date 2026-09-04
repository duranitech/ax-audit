import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult } from './utils.js';

/**
 * "sitemap" — fetch and validate the XML sitemap so AI agents and search crawlers can discover
 * the full URL surface. Sitemaps may be referenced from `robots.txt` (`Sitemap:` directive) or
 * served at the conventional `/sitemap.xml` path. This check covers both, validates the XML
 * shape, and respects sitemap-index files (which point to multiple child sitemaps).
 *
 * Reference: https://www.sitemaps.org/protocol.html
 */
export const meta: CheckMeta = {
  id: 'sitemap',
  name: 'Sitemap',
  description: 'Checks sitemap.xml presence, structure, and freshness',
};

const MAX_URLS_PER_SITEMAP = 50_000;
const MAX_BYTES_PER_SITEMAP = 50 * 1024 * 1024;
const STALE_DAYS = 365;

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const sitemapUrl = await locateSitemap(ctx);
  if (!sitemapUrl) {
    findings.push({
      status: 'fail',
      message: 'No sitemap found',
      detail: 'Tried robots.txt Sitemap: directive and /sitemap.xml',
      hint: 'Publish an XML sitemap at /sitemap.xml and reference it from robots.txt with: Sitemap: https://your-site.com/sitemap.xml',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  findings.push({ status: 'pass', message: `Sitemap located: ${sitemapUrl.url}` });

  const res = sitemapUrl.response;
  if (res.body.length > MAX_BYTES_PER_SITEMAP) {
    findings.push({
      status: 'warn',
      message: `Sitemap exceeds 50 MB (${formatBytes(res.body.length)})`,
      hint: 'Split the sitemap into a sitemap-index referencing multiple smaller sitemaps. The sitemaps.org spec caps individual sitemaps at 50 MB.',
      learnMoreUrl: guideUrl(meta.id, 'too-large'),
    });
    score -= 10;
  }

  if (!isXml(res.body)) {
    findings.push({
      status: 'fail',
      message: 'Sitemap response does not look like XML',
      detail: snippet(res.body),
      hint: 'Serve the sitemap with valid XML and Content-Type: application/xml. Confirm the file starts with <?xml ...?> and contains <urlset> or <sitemapindex>.',
      learnMoreUrl: guideUrl(meta.id, 'not-xml'),
    });
    return buildResult(meta, 20, findings, start);
  }

  const contentType = res.headers['content-type'] ?? '';
  if (/(application|text)\/xml/i.test(contentType)) {
    findings.push({ status: 'pass', message: `Content-Type is XML (${contentType.split(';')[0]})` });
  } else {
    findings.push({
      status: 'warn',
      message: `Unexpected Content-Type: ${contentType || '(missing)'}`,
      hint: 'Serve the sitemap with Content-Type: application/xml so AI agents and search crawlers parse it correctly.',
      learnMoreUrl: guideUrl(meta.id, 'wrong-content-type'),
    });
    score -= 5;
  }

  const isIndex = /<sitemapindex\b/i.test(res.body);
  if (isIndex) {
    const childRefs = [...res.body.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)].map(
      (m) => m[1].trim(),
    );
    if (childRefs.length === 0) {
      findings.push({
        status: 'fail',
        message: '<sitemapindex> contains no <sitemap> entries',
        hint: 'A sitemap-index must contain at least one <sitemap><loc>...</loc></sitemap> child entry.',
        learnMoreUrl: guideUrl(meta.id, 'empty-index'),
      });
      score -= 20;
      return buildResult(meta, score, findings, start);
    }

    findings.push({ status: 'pass', message: `Sitemap-index references ${childRefs.length} child sitemap(s)` });

    const sample = childRefs.slice(0, 3);
    const reachable: string[] = [];
    let totalUrls = 0;
    let newestLastmod: Date | null = null;
    for (const childUrl of sample) {
      const child = await ctx.fetch(childUrl);
      if (!child.ok || !isXml(child.body)) continue;
      reachable.push(childUrl);
      const stats = analyzeUrlset(child.body);
      totalUrls += stats.urlCount;
      if (stats.newestLastmod && (!newestLastmod || stats.newestLastmod > newestLastmod)) {
        newestLastmod = stats.newestLastmod;
      }
    }

    if (reachable.length === sample.length) {
      findings.push({
        status: 'pass',
        message: `${reachable.length}/${sample.length} sample child sitemap(s) reachable`,
      });
    } else {
      findings.push({
        status: 'warn',
        message: `${reachable.length}/${sample.length} sample child sitemap(s) reachable`,
        detail: 'Some referenced child sitemaps could not be fetched.',
        hint: 'Make sure every <loc> URL inside the sitemap-index returns 200 OK and is publicly accessible.',
        learnMoreUrl: guideUrl(meta.id, 'unreachable-children'),
      });
      score -= 10;
    }

    findings.push({
      status: 'pass',
      message: `Sample yielded ${totalUrls} URL(s) across ${reachable.length} child(ren)`,
    });
    reportLastmod(newestLastmod, findings, () => {
      score -= 5;
    });
  } else {
    const stats = analyzeUrlset(res.body);
    if (stats.urlCount === 0) {
      findings.push({
        status: 'fail',
        message: '<urlset> contains no <url> entries',
        hint: 'Populate the sitemap with at least one <url><loc>...</loc></url> entry per page you want crawlers to index.',
        learnMoreUrl: guideUrl(meta.id, 'empty-urlset'),
      });
      score -= 30;
    } else if (stats.urlCount > MAX_URLS_PER_SITEMAP) {
      findings.push({
        status: 'warn',
        message: `Sitemap declares ${stats.urlCount} URLs (above 50,000 limit)`,
        hint: 'Split into a sitemap-index referencing multiple sitemaps, each below 50,000 URLs.',
        learnMoreUrl: guideUrl(meta.id, 'too-many-urls'),
      });
      score -= 10;
    } else {
      findings.push({ status: 'pass', message: `${stats.urlCount} URL(s) declared` });
    }

    if (stats.urlCount > 0) {
      const lastmodCoverage = stats.lastmodCount / stats.urlCount;
      if (lastmodCoverage >= 0.5) {
        findings.push({
          status: 'pass',
          message: `${(lastmodCoverage * 100).toFixed(0)}% of URLs have <lastmod>`,
        });
      } else {
        findings.push({
          status: 'warn',
          message: `Only ${(lastmodCoverage * 100).toFixed(0)}% of URLs have <lastmod>`,
          hint: 'Add a <lastmod>YYYY-MM-DD</lastmod> child to each <url>. AI agents use lastmod to prioritize re-fetching.',
          learnMoreUrl: guideUrl(meta.id, 'low-lastmod'),
        });
        score -= 5;
      }
      reportLastmod(stats.newestLastmod, findings, () => {
        score -= 5;
      });
    }
  }

  return buildResult(meta, score, findings, start);
}

interface SitemapLocation {
  url: string;
  response: FetchResponse;
}

async function locateSitemap(ctx: CheckContext): Promise<SitemapLocation | null> {
  const robots = await ctx.fetch(`${ctx.url}/robots.txt`);
  if (robots.ok) {
    const declared = [...robots.body.matchAll(/^Sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
    for (const url of declared) {
      const res = await ctx.fetch(url);
      if (res.ok) return { url, response: res };
    }
  }
  const fallback = `${ctx.url}/sitemap.xml`;
  const res = await ctx.fetch(fallback);
  if (res.ok) return { url: fallback, response: res };
  return null;
}

interface UrlsetStats {
  urlCount: number;
  lastmodCount: number;
  newestLastmod: Date | null;
}

function analyzeUrlset(xml: string): UrlsetStats {
  let urlCount = 0;
  let lastmodCount = 0;
  let newestLastmod: Date | null = null;

  for (const m of xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)) {
    urlCount++;
    const block = m[0];
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i);
    if (lastmod) {
      lastmodCount++;
      const date = new Date(lastmod[1]);
      if (!isNaN(date.getTime())) {
        if (!newestLastmod || date > newestLastmod) {
          newestLastmod = date;
        }
      }
    }
  }

  return { urlCount, lastmodCount, newestLastmod };
}

function reportLastmod(newest: Date | null, findings: Finding[], onStale: () => void): void {
  if (!newest) return;
  const ageMs = Date.now() - newest.getTime();
  const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
  if (ageDays > STALE_DAYS) {
    findings.push({
      status: 'warn',
      message: `Newest <lastmod> is ${ageDays} days old`,
      hint: 'Refresh <lastmod> on URLs that have changed. A stale sitemap signals to crawlers that nothing on the site has updated.',
      learnMoreUrl: guideUrl(meta.id, 'stale'),
    });
    onStale();
  } else {
    findings.push({
      status: 'pass',
      message: `Newest <lastmod> is recent (${ageDays} day(s) ago)`,
    });
  }
}

function isXml(body: string): boolean {
  const head = body.slice(0, 512).trim();
  return /^<\?xml/i.test(head) || /^<(urlset|sitemapindex)\b/i.test(head);
}

function snippet(value: string): string {
  const trimmed = value.trim().slice(0, 80);
  return trimmed.replace(/\s+/g, ' ');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
