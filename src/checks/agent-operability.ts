import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';
import { getAttribute, getTagAttribute } from './html-utils.js';

/**
 * "agent-operability" — can a browser agent work this page, or only look at it?
 *
 * Every major browser agent reads the accessibility tree, not the pixels.
 * Anthropic's browser tool returns the page as `link "Documentation" [ref_1]`,
 * `button "Search" [ref_4]`; ChatGPT Atlas is documented as using ARIA roles and
 * labels; Chrome's own guidance for agent-friendly sites asks for real
 * `<button>` and `<a>` elements, labelled controls and stable layout.
 *
 * Which means the failure mode is specific and old: a `<div onclick>` styled to
 * look like a button has no name and no role, so it does not appear in the tree
 * at all. The agent does not see a button it cannot press. It sees nothing.
 * An unlabelled input is a box the agent must guess the meaning of, which is how
 * an email address ends up in a search field.
 *
 * This is the accessibility work that has been the right thing to do for twenty
 * years, with a new and less patient audience. Every finding here is a genuine
 * accessibility defect too.
 *
 * The check is a static approximation and says so: it reads markup, not a
 * rendered accessibility tree, so it cannot see labels attached by script or
 * roles computed at runtime. It reports proportions rather than absolutes for
 * that reason.
 */
export const meta: CheckMeta = {
  id: 'agent-operability',
  name: 'Agent Operability',
  description: 'Checks whether interactive elements are nameable and operable by a browser agent',
  category: 'content',
};

/** Below this share of named controls, the page is guesswork for an agent. */
const NAMED_CONTROL_THRESHOLD = 0.9;

export interface OperabilityReport {
  buttons: { total: number; named: number; unnamed: string[] };
  controls: { total: number; labelled: number; unlabelled: string[] };
  fakeInteractive: number;
  deadLinks: { noHref: number; javascriptHref: number };
  tables: { total: number; withHeaders: number };
  media: { total: number; sized: number };
  iframes: { total: number; titled: number };
  timeElements: { total: number; withDatetime: number };
  headingSkips: string[];
  lang: string | null;
  blockers: string[];
}

/** Strip comments, scripts and styles: their contents are not part of the page. */
function contentOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
}

/** Text content of an element, with tags removed. */
function innerText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether an element has something an accessibility tree can use as its name:
 * visible text, an ARIA label, a title, or an image with alt text.
 */
function hasAccessibleName(attrs: string, inner: string): boolean {
  if ((getAttribute(attrs, 'aria-label') ?? '').trim() !== '') return true;
  if ((getAttribute(attrs, 'aria-labelledby') ?? '').trim() !== '') return true;
  if ((getAttribute(attrs, 'title') ?? '').trim() !== '') return true;
  if (innerText(inner) !== '') return true;
  // An icon-only control is named by its image's alt text.
  for (const img of inner.matchAll(/<img\b([^>]*)>/gi)) {
    if ((getAttribute(img[1], 'alt') ?? '').trim() !== '') return true;
  }
  // An inline SVG is named by its <title> child.
  if (/<svg\b[^>]*>[\s\S]*?<title\b[^>]*>\s*\S/i.test(inner)) return true;
  return false;
}

/** Analyse the markup for everything a browser agent needs in order to act. */
export function analyseOperability(rawHtml: string): OperabilityReport {
  const html = contentOf(rawHtml);

  const report: OperabilityReport = {
    buttons: { total: 0, named: 0, unnamed: [] },
    controls: { total: 0, labelled: 0, unlabelled: [] },
    fakeInteractive: 0,
    deadLinks: { noHref: 0, javascriptHref: 0 },
    tables: { total: 0, withHeaders: 0 },
    media: { total: 0, sized: 0 },
    iframes: { total: 0, titled: 0 },
    timeElements: { total: 0, withDatetime: 0 },
    headingSkips: [],
    lang: getTagAttribute(rawHtml, 'html', 'lang'),
    blockers: [],
  };

  /* Buttons and links: can the agent name what it is about to press? */
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    report.buttons.total++;
    if (hasAccessibleName(m[1], m[2])) report.buttons.named++;
    else report.buttons.unnamed.push('<button>');
  }
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const type = (getAttribute(m[1], 'type') ?? '').toLowerCase();
    if (type !== 'submit' && type !== 'button' && type !== 'reset' && type !== 'image') continue;
    report.buttons.total++;
    const named =
      (getAttribute(m[1], 'value') ?? '').trim() !== '' ||
      (getAttribute(m[1], 'aria-label') ?? '').trim() !== '' ||
      (getAttribute(m[1], 'alt') ?? '').trim() !== '';
    if (named) report.buttons.named++;
    else report.buttons.unnamed.push(`<input type="${type}">`);
  }

  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = getAttribute(m[1], 'href');
    if (href === null) {
      report.deadLinks.noHref++;
      continue;
    }
    if (/^javascript:/i.test(href.trim())) {
      report.deadLinks.javascriptHref++;
      continue;
    }
    report.buttons.total++;
    if (hasAccessibleName(m[1], m[2])) report.buttons.named++;
    else report.buttons.unnamed.push(`<a href="${href.slice(0, 40)}">`);
  }

  /* Elements dressed as controls that no tree will report. */
  for (const m of html.matchAll(/<(div|span|li|td)\b([^>]*)>/gi)) {
    const attrs = m[2];
    if (!/\bonclick\s*=/i.test(attrs)) continue;
    const role = (getAttribute(attrs, 'role') ?? '').toLowerCase();
    const tabindex = getAttribute(attrs, 'tabindex');
    if (role === '' || tabindex === null) report.fakeInteractive++;
  }

  /* Form controls: does the agent know what each box is for? */
  const labelFor = new Set<string>();
  for (const m of html.matchAll(/<label\b([^>]*)>/gi)) {
    const forAttr = getAttribute(m[1], 'for');
    if (forAttr !== null) labelFor.add(forAttr);
  }
  const wrappedIds = new Set<string>();
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
    for (const inner of m[1].matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const id = getAttribute(inner[2], 'id');
      wrappedIds.add(id ?? `__wrapped-${wrappedIds.size}`);
    }
  }

  const wrappedCount = wrappedIds.size;
  let wrappedSeen = 0;
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const type = (getAttribute(attrs, 'type') ?? '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;

    report.controls.total++;
    const id = getAttribute(attrs, 'id');
    const labelled =
      (id !== null && labelFor.has(id)) ||
      (id !== null && wrappedIds.has(id)) ||
      (getAttribute(attrs, 'aria-label') ?? '').trim() !== '' ||
      (getAttribute(attrs, 'aria-labelledby') ?? '').trim() !== '' ||
      (getAttribute(attrs, 'title') ?? '').trim() !== '' ||
      (id === null && wrappedSeen++ < wrappedCount);

    if (labelled) report.controls.labelled++;
    else report.controls.unlabelled.push(`<${m[1]}${type ? ` type="${type}"` : ''}>`);
  }

  /* Structure an agent reads meaning from. */
  for (const m of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    report.tables.total++;
    if (/<th\b/i.test(m[1])) report.tables.withHeaders++;
  }
  for (const m of html.matchAll(/<(img|iframe|video)\b([^>]*)>/gi)) {
    const attrs = m[2];
    if (m[1].toLowerCase() === 'iframe') {
      report.iframes.total++;
      if ((getAttribute(attrs, 'title') ?? '').trim() !== '') report.iframes.titled++;
    }
    report.media.total++;
    const sized =
      (getAttribute(attrs, 'width') !== null && getAttribute(attrs, 'height') !== null) ||
      /aspect-ratio\s*:/i.test(getAttribute(attrs, 'style') ?? '');
    if (sized) report.media.sized++;
  }
  for (const m of html.matchAll(/<time\b([^>]*)>/gi)) {
    report.timeElements.total++;
    if (getAttribute(m[1], 'datetime') !== null) report.timeElements.withDatetime++;
  }

  /* Heading hierarchy: an agent outlines a page from it. */
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      report.headingSkips.push(`h${levels[i - 1]} → h${levels[i]}`);
    }
  }

  /* Things that stop an agent before it starts. */
  if (/<meta\b[^>]+http-equiv\s*=\s*["']refresh["']/i.test(rawHtml)) {
    report.blockers.push('<meta http-equiv="refresh"> on the page');
  }
  if (/www\.google\.com\/recaptcha\/|js\.hcaptcha\.com\/|challenges\.cloudflare\.com\/turnstile/i.test(rawHtml)) {
    report.blockers.push('a CAPTCHA widget on the entry page');
  }

  return report;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  if (!ctx.html || ctx.html.trim().length === 0) {
    findings.push({
      status: 'fail',
      message: 'Homepage HTML unavailable — cannot assess operability',
      learnMoreUrl: guideUrl(meta.id, 'no-html'),
    });
    return buildResult(meta, 0, findings, start);
  }

  const r = analyseOperability(ctx.html);

  score = reportNames(r, findings, score);
  score = reportFakeControls(r, findings, score);
  score = reportStructure(r, findings, score);
  score = reportBlockers(r, findings, score);

  findings.push({
    status: 'pass',
    message: 'Method note: this reads markup, not a rendered accessibility tree',
    detail:
      'Labels attached by script and roles computed at runtime are invisible here, so treat low proportions as a ' +
      'prompt to check the real tree rather than as a count. Every finding is also a plain accessibility defect.',
  });

  return buildResult(meta, score, findings, start);
}

/** Can the agent name what it is about to click or type into? */
function reportNames(r: OperabilityReport, findings: Finding[], score: number): number {
  if (r.buttons.total > 0) {
    const ratio = r.buttons.named / r.buttons.total;
    if (ratio >= NAMED_CONTROL_THRESHOLD) {
      findings.push({
        status: 'pass',
        message: `${r.buttons.named}/${r.buttons.total} interactive elements have an accessible name`,
      });
    } else {
      findings.push({
        status: 'warn',
        message: `${r.buttons.total - r.buttons.named}/${r.buttons.total} buttons or links have no accessible name`,
        detail: [...new Set(r.buttons.unnamed)].slice(0, 8).join(', '),
        hint:
          'An agent addresses a control by its name: it presses button "Search", not the button at 412×88. ' +
          'Give each one visible text, an aria-label, or an image with alt text.',
        learnMoreUrl: guideUrl(meta.id, 'unnamed-controls'),
      });
      score -= 20;
    }
  }

  if (r.controls.total > 0) {
    const ratio = r.controls.labelled / r.controls.total;
    if (ratio >= NAMED_CONTROL_THRESHOLD) {
      findings.push({
        status: 'pass',
        message: `${r.controls.labelled}/${r.controls.total} form controls are labelled`,
      });
    } else {
      findings.push({
        status: 'warn',
        message: `${r.controls.total - r.controls.labelled}/${r.controls.total} form controls have no label`,
        detail: [...new Set(r.controls.unlabelled)].slice(0, 8).join(', '),
        hint:
          'An unlabelled box is one the agent has to guess the meaning of, which is how an email address ends up in ' +
          'a search field. Use <label for>, wrap the control in a label, or add aria-label.',
        learnMoreUrl: guideUrl(meta.id, 'unlabelled-controls'),
      });
      score -= 20;
    }
  }

  return score;
}

/** Controls that exist visually but not in the tree the agent reads. */
function reportFakeControls(r: OperabilityReport, findings: Finding[], score: number): number {
  if (r.fakeInteractive > 0) {
    findings.push({
      status: 'warn',
      message: `${r.fakeInteractive} clickable element(s) are not buttons or links`,
      hint:
        'A <div onclick> styled as a button has no role and no name, so it does not appear in the accessibility tree ' +
        'at all. The agent does not see a button it cannot press; it sees nothing. Use <button>, or add role="button" ' +
        'and tabindex="0".',
      learnMoreUrl: guideUrl(meta.id, 'fake-controls'),
    });
    score -= 15;
  }

  if (r.deadLinks.javascriptHref > 0 || r.deadLinks.noHref > 0) {
    findings.push({
      status: 'warn',
      message: `${r.deadLinks.javascriptHref + r.deadLinks.noHref} link(s) lead nowhere without JavaScript`,
      detail: `${r.deadLinks.noHref} with no href, ${r.deadLinks.javascriptHref} with a javascript: href`,
      hint:
        'A link with no destination cannot be followed by a fetch-only agent and cannot be opened in a new tab by a ' +
        'browsing one. Give it a real href, or make it a <button> if it is an action rather than a destination.',
      learnMoreUrl: guideUrl(meta.id, 'dead-links'),
    });
    score -= 10;
  }

  return score;
}

/** Structure an agent extracts meaning from. */
function reportStructure(r: OperabilityReport, findings: Finding[], score: number): number {
  if (r.tables.total > 0 && r.tables.withHeaders < r.tables.total) {
    findings.push({
      status: 'warn',
      message: `${r.tables.total - r.tables.withHeaders}/${r.tables.total} tables have no header cells`,
      hint:
        'Without <th>, a table is a grid of strings: an agent reading a price table cannot tell which column is the ' +
        'price. Add header cells, with scope on anything non-trivial.',
      learnMoreUrl: guideUrl(meta.id, 'tables-no-headers'),
    });
    score -= 10;
  }

  if (r.iframes.total > 0 && r.iframes.titled < r.iframes.total) {
    findings.push({
      status: 'warn',
      message: `${r.iframes.total - r.iframes.titled}/${r.iframes.total} iframes have no title`,
      hint: 'An untitled frame is an opaque region. A title tells an agent whether it is worth entering.',
      learnMoreUrl: guideUrl(meta.id, 'iframe-no-title'),
    });
    score -= 5;
  }

  if (r.timeElements.total > 0 && r.timeElements.withDatetime < r.timeElements.total) {
    findings.push({
      status: 'warn',
      message: `${r.timeElements.total - r.timeElements.withDatetime}/${r.timeElements.total} <time> elements have no datetime attribute`,
      hint: 'Without datetime, "last Tuesday" is unparseable. Add the machine-readable value: <time datetime="2026-09-04">.',
      learnMoreUrl: guideUrl(meta.id, 'time-no-datetime'),
    });
    score -= 5;
  }

  if (r.headingSkips.length > 0) {
    findings.push({
      status: 'warn',
      message: `Heading hierarchy skips ${r.headingSkips.length} level(s)`,
      detail: [...new Set(r.headingSkips)].join(', '),
      hint: 'Agents outline a page from its headings. A skipped level puts a section under the wrong parent, so a summary attributes it to the wrong topic.',
      learnMoreUrl: guideUrl(meta.id, 'heading-skips'),
    });
    score -= 5;
  }

  if (r.media.total >= 3) {
    const ratio = r.media.sized / r.media.total;
    if (ratio < 0.5) {
      findings.push({
        status: 'warn',
        message: `${r.media.total - r.media.sized}/${r.media.total} images, frames or videos have no declared dimensions`,
        hint:
          'Undeclared dimensions shift the layout as media loads. An agent working from a screenshot clicks where the ' +
          'button was a moment ago. Set width and height, or aspect-ratio.',
        learnMoreUrl: guideUrl(meta.id, 'unsized-media'),
      });
      score -= 5;
    }
  }

  if (r.lang === null || r.lang.trim() === '') {
    findings.push({
      status: 'warn',
      message: 'No lang attribute on <html>',
      hint: 'Agents route, translate and pick a voice from this. Add lang="en" or whichever applies.',
      learnMoreUrl: guideUrl(meta.id, 'no-lang'),
    });
    score -= 5;
  }

  return score;
}

/** Things that stop an agent at the door. */
function reportBlockers(r: OperabilityReport, findings: Finding[], score: number): number {
  if (r.blockers.length === 0) return score;

  findings.push({
    status: 'warn',
    message: `${r.blockers.length} obstacle(s) on the entry page`,
    detail: r.blockers.join('; '),
    hint:
      'A CAPTCHA or a meta refresh on the landing page stops an agent before it reaches any content. If bot ' +
      'protection is needed, apply it to the actions that need it, not to reading a page.',
    learnMoreUrl: guideUrl(meta.id, 'entry-blockers'),
  });
  return score - 15;
}
