import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { findLinkTags, findMetaTagsByPrefix, getMetaContent } from './html-utils.js';
import { buildResult } from './utils.js';

/**
 * "meta-tags" — AI-discovery and identity meta/link tags inside the HTML <head>.
 *
 * Scope:
 * - Custom AI namespace (`ai:summary`, `ai:content_type`, `ai:author`, `ai:api`, `ai:agent_card`)
 * - `<link rel="alternate">` pointing to llms.txt and agent.json
 * - `rel="me"` identity links (IndieAuth / Mastodon-style verification)
 * - OpenGraph completeness (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`)
 * - Twitter Card completeness (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`)
 *
 * Title/description quality and canonical/lang/charset live in the `seo-basics` check
 * to avoid double-penalty.
 */
export const meta: CheckMeta = {
  id: 'meta-tags',
  name: 'Meta Tags',
  description: 'Checks AI meta tags, rel="alternate", rel="me", and Open Graph / Twitter Card completeness',
  weight: 6,
};

const AI_META_NAMES = ['ai:summary', 'ai:content_type', 'ai:author', 'ai:api', 'ai:agent_card'];

const OG_REQUIRED = ['og:title', 'og:description', 'og:url', 'og:type'];
const OG_RECOMMENDED = ['og:image', 'og:site_name'];

const TWITTER_REQUIRED = ['twitter:card', 'twitter:title', 'twitter:description'];
const TWITTER_RECOMMENDED = ['twitter:image'];

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const html = ctx.html;
  if (!html) {
    findings.push({ status: 'fail', message: 'Could not fetch homepage HTML' });
    return buildResult(meta, 0, findings, start);
  }

  const foundAiMeta = AI_META_NAMES.filter((name) => getMetaContent(html, name) !== null);

  if (foundAiMeta.length >= 3) {
    findings.push({
      status: 'pass',
      message: `${foundAiMeta.length}/${AI_META_NAMES.length} AI meta tags found`,
      detail: foundAiMeta.join(', '),
    });
  } else if (foundAiMeta.length > 0) {
    findings.push({
      status: 'warn',
      message: `${foundAiMeta.length}/${AI_META_NAMES.length} AI meta tags found`,
      detail: foundAiMeta.join(', '),
      hint: 'Add more AI meta tags to your <head>: <meta name="ai:summary" content="...">, <meta name="ai:content_type" content="...">, <meta name="ai:author" content="...">, etc.',
      learnMoreUrl: guideUrl(meta.id, 'few-ai-meta'),
    });
    score -= 12;
  } else {
    findings.push({
      status: 'warn',
      message: 'No AI meta tags (ai:*) found',
      hint: 'Add AI meta tags to your HTML <head>: <meta name="ai:summary" content="Brief description">, <meta name="ai:content_type" content="website">, <meta name="ai:author" content="Your Name">.',
      learnMoreUrl: guideUrl(meta.id, 'no-ai-meta'),
    });
    score -= 18;
  }

  const alternateTags = findLinkTags(html, 'alternate');
  const hasLlmsAlternate = alternateTags.some((tag) => /href\s*=\s*["'][^"']*llms\.txt/i.test(tag));
  if (hasLlmsAlternate) {
    findings.push({ status: 'pass', message: 'rel="alternate" link to llms.txt present' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No rel="alternate" link to llms.txt in HTML',
      hint: 'Add to your <head>: <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM-optimized content">',
      learnMoreUrl: guideUrl(meta.id, 'no-llms-alternate'),
    });
    score -= 12;
  }

  // Either card path counts: A2A moved to agent-card.json in v0.3.0, and a site
  // still on the pre-0.3 path is flagged by the agent-card check, not here.
  const hasAgentAlternate = alternateTags.some((tag) => /href\s*=\s*["'][^"']*agent(-card)?\.json/i.test(tag));
  if (hasAgentAlternate) {
    findings.push({ status: 'pass', message: 'rel="alternate" link to the Agent Card present' });
  } else {
    findings.push({
      status: 'warn',
      message: 'No rel="alternate" link to the Agent Card in HTML',
      hint: 'Add to your <head>: <link rel="alternate" type="application/json" href="/.well-known/agent-card.json" title="Agent Card">',
      learnMoreUrl: guideUrl(meta.id, 'no-agent-alternate'),
    });
    score -= 8;
  }

  const relMeCount = findLinkTags(html, 'me').length;
  if (relMeCount > 0) {
    findings.push({ status: 'pass', message: `${relMeCount} rel="me" identity link(s) found` });
  } else {
    findings.push({
      status: 'warn',
      message: 'No rel="me" identity links found',
      hint: 'Add rel="me" links to verify your identity across platforms: <link rel="me" href="https://github.com/yourname">, <link rel="me" href="https://twitter.com/yourname">.',
      learnMoreUrl: guideUrl(meta.id, 'no-rel-me'),
    });
    score -= 8;
  }

  const ogPresent = countMetaPresence(html, OG_REQUIRED);
  const ogRecommendedPresent = countMetaPresence(html, OG_RECOMMENDED);
  if (findMetaTagsByPrefix(html, 'og:').length === 0) {
    findings.push({
      status: 'warn',
      message: 'No OpenGraph meta tags found',
      hint: 'Add at minimum og:title, og:description, og:url, og:type, and og:image. Agents and link previews depend on these.',
      learnMoreUrl: guideUrl(meta.id, 'no-opengraph'),
    });
    score -= 12;
  } else if (ogPresent.missing.length === 0) {
    findings.push({
      status: 'pass',
      message: `OpenGraph required tags present (${OG_REQUIRED.join(', ')})`,
    });
    if (ogRecommendedPresent.missing.length > 0) {
      findings.push({
        status: 'warn',
        message: `OpenGraph recommended tags missing: ${ogRecommendedPresent.missing.join(', ')}`,
        hint: `Add these for richer previews: ${ogRecommendedPresent.missing.join(', ')}.`,
        learnMoreUrl: guideUrl(meta.id, 'og-recommended-missing'),
      });
      score -= 3;
    }
  } else {
    findings.push({
      status: 'warn',
      message: `OpenGraph required tags missing: ${ogPresent.missing.join(', ')}`,
      hint: `Add these meta tags: ${ogPresent.missing.map((t) => `<meta property="${t}" content="...">`).join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'og-required-missing'),
    });
    score -= 8;
  }

  const twitterPresent = countMetaPresence(html, TWITTER_REQUIRED);
  const twitterRecommendedPresent = countMetaPresence(html, TWITTER_RECOMMENDED);
  if (findMetaTagsByPrefix(html, 'twitter:').length === 0) {
    findings.push({
      status: 'warn',
      message: 'No Twitter Card meta tags found',
      hint: 'Add twitter:card, twitter:title, twitter:description, and twitter:image so X / Threads / Bluesky / Discord agents render link previews correctly.',
      learnMoreUrl: guideUrl(meta.id, 'no-twitter'),
    });
    score -= 6;
  } else if (twitterPresent.missing.length === 0) {
    findings.push({
      status: 'pass',
      message: `Twitter Card required tags present (${TWITTER_REQUIRED.join(', ')})`,
    });
    if (twitterRecommendedPresent.missing.length > 0) {
      findings.push({
        status: 'warn',
        message: `Twitter Card recommended tags missing: ${twitterRecommendedPresent.missing.join(', ')}`,
        hint: 'Add twitter:image for richer previews.',
        learnMoreUrl: guideUrl(meta.id, 'twitter-recommended-missing'),
      });
      score -= 2;
    }
  } else {
    findings.push({
      status: 'warn',
      message: `Twitter Card required tags missing: ${twitterPresent.missing.join(', ')}`,
      hint: `Add these meta tags: ${twitterPresent.missing.map((t) => `<meta name="${t}" content="...">`).join(', ')}.`,
      learnMoreUrl: guideUrl(meta.id, 'twitter-required-missing'),
    });
    score -= 5;
  }

  return buildResult(meta, score, findings, start);
}

interface MetaPresence {
  present: string[];
  missing: string[];
}

function countMetaPresence(html: string, names: string[]): MetaPresence {
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    if (getMetaContent(html, name) !== null) present.push(name);
    else missing.push(name);
  }
  return { present, missing };
}
