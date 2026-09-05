import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { countExecutableScripts, extractVisibleText, findOpeningTag, getMetaContent, structuralMarkupLength } from './html-utils.js';
import { buildResult } from './utils.js';

/**
 * "html-rendering" — does the HTML delivered to a non-JS agent actually contain content?
 *
 * Most AI crawlers (GPTBot, ClaudeBot, CCBot, etc.) do **not** execute JavaScript. A site
 * built as a client-rendered SPA returns an empty `<div id="root"></div>` shell to those
 * agents, and is effectively invisible regardless of how good its `llms.txt` and structured
 * data are. This check estimates server-side rendering by inspecting the static HTML body.
 *
 * Signals (each contributes to the score):
 * - Visible text length and word count (low → likely JS-rendered shell)
 * - Text-to-markup ratio against structural markup (high JS, no text → SPA)
 * - Presence of semantic landmarks (`<main>`, `<article>`, `<header>`, `<footer>`, `<nav>`)
 * - Single, meaningful `<h1>`
 * - `<noscript>` fallback for JS-only frameworks
 * - Non-empty SPA root containers (`#root`, `#app`, `#__next`)
 * - Image `alt` attribute coverage
 */
export const meta: CheckMeta = {
  id: 'html-rendering',
  name: 'HTML Rendering',
  description: 'Checks server-rendered content, semantic landmarks, and SPA-shell heuristics',
};

const MIN_TEXT_LENGTH = 500;
const MIN_WORD_COUNT = 80;
const MIN_TEXT_TO_HTML_RATIO = 0.05;
const SPA_ROOT_IDS = ['root', 'app', '__next', '__nuxt', 'svelte', 'gatsby', 'gatsby-focus-wrapper'];

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const html = ctx.html;
  if (!html) {
    findings.push({
      status: 'fail',
      message: 'Could not fetch homepage HTML',
      hint: 'The homepage did not return any HTML body. Verify your server returns 200 OK with a non-empty response on the root URL.',
      learnMoreUrl: guideUrl(meta.id, 'no-html'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const visibleText = extractVisibleText(html);
  const wordCount = visibleText ? visibleText.split(/\s+/).filter(Boolean).length : 0;
  const textOk = visibleText.length >= MIN_TEXT_LENGTH && wordCount >= MIN_WORD_COUNT;

  // Against the markup that could have carried text — script and style
  // bodies, svg interiors and the head excluded (see structuralMarkupLength).
  const markup = structuralMarkupLength(html);
  const ratio = markup > 0 ? visibleText.length / markup : 0;

  if (textOk) {
    findings.push({
      status: 'pass',
      message: `Server-rendered content detected (${wordCount} words, ${visibleText.length} chars of visible text)`,
    });
  } else if (visibleText.length > 0) {
    findings.push({
      status: 'warn',
      message: `Sparse server-rendered content (${wordCount} words, ${visibleText.length} chars)`,
      detail: `Below thresholds: ${MIN_WORD_COUNT} words, ${MIN_TEXT_LENGTH} chars`,
      hint: 'Render at least the main page content server-side. Many AI crawlers (GPTBot, ClaudeBot, CCBot) do not execute JavaScript and will see only the static HTML.',
      learnMoreUrl: guideUrl(meta.id, 'sparse-content'),
    });
    score -= 25;
  } else {
    findings.push({
      status: 'fail',
      message: 'No visible text content in static HTML',
      hint: 'Your homepage appears to be a JavaScript-only shell. Add server-side rendering (Next.js SSR/SSG, Astro, Remix, or a static prerender) so AI agents that do not execute JS can read your content.',
      learnMoreUrl: guideUrl(meta.id, 'js-shell'),
    });
    score -= 50;
  }

  if (ratio >= MIN_TEXT_TO_HTML_RATIO) {
    findings.push({
      status: 'pass',
      message: `Text-to-markup ratio is healthy (${(ratio * 100).toFixed(1)}% of structural markup)`,
    });
  } else if (textOk) {
    // The ratio exists as a shell symptom, and the text thresholds just
    // proved this page is not a shell: the words are demonstrably there.
    // What a low ratio still says is that the structure around them is
    // expensive for an agent consuming raw HTML — worth saying, not
    // worth charging for twice.
    findings.push({
      status: 'warn',
      message: `Markup-heavy page (text is ${(ratio * 100).toFixed(1)}% of structural markup)`,
      detail: `Recommended minimum: ${(MIN_TEXT_TO_HTML_RATIO * 100).toFixed(0)}%. The content thresholds are met, so this does not move the score.`,
      hint: 'The visible text clears the content thresholds, so agents can read this page. Trimming wrapper markup would still make it cheaper to consume.',
      learnMoreUrl: guideUrl(meta.id, 'low-ratio'),
    });
  } else {
    findings.push({
      status: 'warn',
      message: `Low text-to-markup ratio (${(ratio * 100).toFixed(1)}%)`,
      detail: `Recommended minimum: ${(MIN_TEXT_TO_HTML_RATIO * 100).toFixed(0)}% of structural markup (script/style bodies and svg interiors excluded)`,
      hint: 'A very low text-to-markup ratio is a typical SPA-shell symptom. Inline more content directly into the HTML response.',
      learnMoreUrl: guideUrl(meta.id, 'low-ratio'),
    });
    score -= 10;
  }

  const emptyShell = SPA_ROOT_IDS.find((id) => {
    const re = new RegExp(`<[^>]+\\bid\\s*=\\s*["']${id}["'][^>]*>\\s*</[^>]+>`, 'i');
    return re.test(html);
  });
  if (emptyShell) {
    findings.push({
      status: 'fail',
      message: `Empty SPA mount point detected: #${emptyShell}`,
      hint: 'The static HTML contains an empty SPA mount node, which means content is rendered only client-side. Enable SSR/SSG so the initial HTML response includes meaningful content.',
      learnMoreUrl: guideUrl(meta.id, 'empty-spa'),
    });
    score -= 20;
  }

  const semanticLandmarks = ['main', 'article', 'section', 'header', 'footer', 'nav'];
  const presentLandmarks = semanticLandmarks.filter((tag) => findOpeningTag(html, tag) !== null);
  if (presentLandmarks.length >= 3) {
    findings.push({
      status: 'pass',
      message: `Semantic landmarks present (${presentLandmarks.join(', ')})`,
    });
  } else if (presentLandmarks.length > 0) {
    findings.push({
      status: 'warn',
      message: `Only ${presentLandmarks.length} semantic landmark(s) found`,
      detail: `Found: ${presentLandmarks.join(', ')}. Missing: ${semanticLandmarks.filter((t) => !presentLandmarks.includes(t)).join(', ')}`,
      hint: 'Use semantic HTML tags so AI agents can understand page structure: <header>, <nav>, <main>, <article>, <section>, <footer>.',
      learnMoreUrl: guideUrl(meta.id, 'few-landmarks'),
    });
    score -= 10;
  } else {
    findings.push({
      status: 'warn',
      message: 'No semantic HTML landmarks found',
      hint: 'Replace generic <div> structures with semantic tags: <main>, <article>, <header>, <nav>, <footer>. Agents use these to identify the primary content region.',
      learnMoreUrl: guideUrl(meta.id, 'no-landmarks'),
    });
    score -= 15;
  }

  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (h1Matches.length === 1) {
    const h1Text = extractVisibleText(h1Matches[0][1]);
    if (h1Text.length > 0) {
      findings.push({ status: 'pass', message: `Single <h1> heading: "${truncate(h1Text, 60)}"` });
    } else {
      findings.push({
        status: 'warn',
        message: '<h1> is empty',
        hint: 'Add meaningful text inside your <h1> element so agents can identify the page topic.',
        learnMoreUrl: guideUrl(meta.id, 'empty-h1'),
      });
      score -= 5;
    }
  } else if (h1Matches.length > 1) {
    findings.push({
      status: 'warn',
      message: `${h1Matches.length} <h1> headings found (recommend exactly 1)`,
      hint: 'Use a single <h1> per page to clearly mark the primary topic. Demote secondary headings to <h2>+.',
      learnMoreUrl: guideUrl(meta.id, 'multiple-h1'),
    });
    score -= 5;
  } else {
    findings.push({
      status: 'warn',
      message: 'No <h1> heading found',
      hint: 'Add a single <h1> describing the page. Agents and search engines treat the H1 as the primary topic indicator.',
      learnMoreUrl: guideUrl(meta.id, 'no-h1'),
    });
    score -= 10;
  }

  const heavyJs = countExecutableScripts(html) > 15;
  const hasNoscript = /<noscript\b[^>]*>[\s\S]*?<\/noscript>/i.test(html);
  if (heavyJs && !hasNoscript) {
    findings.push({
      status: 'warn',
      message: 'Heavy JavaScript with no <noscript> fallback',
      detail: `${countExecutableScripts(html)} executable <script> tags`,
      hint: 'Provide a <noscript> fallback that explains the site or links to a non-JS variant. This helps agents that disable JS.',
      learnMoreUrl: guideUrl(meta.id, 'no-noscript'),
    });
    score -= 5;
  }

  const imgs = [...html.matchAll(/<img\b([^>]*)>/gi)];
  if (imgs.length > 0) {
    const withAlt = imgs.filter((m) => /\balt\s*=/i.test(m[1])).length;
    const coverage = withAlt / imgs.length;
    if (coverage >= 0.9) {
      findings.push({
        status: 'pass',
        message: `${withAlt}/${imgs.length} <img> tags have alt attributes`,
      });
    } else {
      findings.push({
        status: 'warn',
        message: `Only ${withAlt}/${imgs.length} <img> tags have alt attributes`,
        hint: 'Add descriptive alt="" to every <img>. Agents use alt text to understand images they cannot process visually.',
        learnMoreUrl: guideUrl(meta.id, 'missing-alt'),
      });
      score -= 5;
    }
  }

  const generator = getMetaContent(html, 'generator');
  if (generator) {
    findings.push({ status: 'pass', message: `Generator: ${generator}` });
  }

  return buildResult(meta, score, findings, start);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
