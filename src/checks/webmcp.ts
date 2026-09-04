import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult, notApplicable } from './utils.js';
import { getAttribute } from './html-utils.js';

/**
 * "webmcp" — can a browser agent invoke this page's forms as tools?
 *
 * Today an agent that wants to use a form has to look at pixels, guess which
 * field is which, type into them, and hope. WebMCP lets a page declare a form as
 * a callable tool with named parameters, so the agent calls it instead of
 * driving it. The declarative form is two attributes:
 *
 * ```html
 * <form toolname="searchDocs" tooldescription="Search the documentation">
 *   <input name="q" toolparamdescription="The search query">
 * </form>
 * ```
 *
 * Status, verified 2026-09-04: a W3C Web Machine Learning Community Group draft
 * with a Chrome origin trial running from Chrome 149. Not a standard, not
 * shipped by default, not implemented in Firefox or Safari. Adoption is
 * effectively zero.
 *
 * So this check never asks for WebMCP and never scores a site down for lacking
 * it. It reports N/A on a page with no forms and no WebMCP code at all. What it
 * does do, on pages that have adopted it, is catch the mistakes a static
 * analysis can catch with certainty: a `toolname` with no `tooldescription`,
 * which is the exact condition Lighthouse's `webmcp-schema-validity` audit
 * fails, parameters with no description, and use of the `navigator.modelContext`
 * namespace that Chrome deprecated in favour of `document.modelContext`.
 */
export const meta: CheckMeta = {
  id: 'webmcp',
  name: 'WebMCP',
  description: 'Checks declarative WebMCP tool annotations on forms',
  category: 'protocols',
};

/** Tool names are identifiers an agent calls, so they follow identifier rules. */
const TOOL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Form controls that carry a value an agent would need described. */
const CONTROL_RE = /<(input|select|textarea)\b([^>]*)>/gi;

/** Input types that carry no user-supplied value worth describing. */
const VALUELESS_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export interface FormAnalysis {
  total: number;
  annotated: number;
  /** Forms declaring a name but no description — invalid, and Lighthouse fails them. */
  missingDescription: string[];
  /** Forms declaring a description but no name: nothing for an agent to call. */
  missingName: number;
  /** Tool names that are not usable identifiers. */
  invalidNames: string[];
  /** Annotated forms whose named controls lack `toolparamdescription`. */
  undescribedParams: { tool: string; missing: number; total: number }[];
  autoSubmit: string[];
}

/** Split the document into `<form>` blocks, keeping each element's attributes and inner HTML. */
function forms(html: string): { attrs: string; inner: string }[] {
  const out: { attrs: string; inner: string }[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    out.push({ attrs: m[1], inner: m[2] });
  }
  return out;
}

/** Analyse declarative WebMCP annotations across every form on the page. */
export function analyseForms(html: string): FormAnalysis {
  const analysis: FormAnalysis = {
    total: 0,
    annotated: 0,
    missingDescription: [],
    missingName: 0,
    invalidNames: [],
    undescribedParams: [],
    autoSubmit: [],
  };

  for (const form of forms(html)) {
    analysis.total++;
    const toolName = getAttribute(form.attrs, 'toolname');
    const toolDescription = getAttribute(form.attrs, 'tooldescription');
    if (toolName === null && toolDescription === null) continue;

    const label = toolName ?? '(unnamed)';
    analysis.annotated++;

    if (toolName === null || toolName.trim() === '') {
      analysis.missingName++;
    }
    if (toolDescription === null || toolDescription.trim() === '') {
      analysis.missingDescription.push(label);
    }
    if (toolName !== null && !TOOL_NAME_RE.test(toolName)) {
      analysis.invalidNames.push(toolName);
    }
    if (/\btoolautosubmit\b/i.test(form.attrs)) {
      analysis.autoSubmit.push(label);
    }

    let total = 0;
    let missing = 0;
    for (const control of form.inner.matchAll(CONTROL_RE)) {
      const attrs = control[2];
      const type = (getAttribute(attrs, 'type') ?? '').toLowerCase();
      if (VALUELESS_TYPES.has(type)) continue;
      if (getAttribute(attrs, 'name') === null) continue;
      total++;
      if (getAttribute(attrs, 'toolparamdescription') === null) missing++;
    }
    if (total > 0 && missing > 0) {
      analysis.undescribedParams.push({ tool: label, missing, total });
    }
  }

  return analysis;
}

/** Detect imperative WebMCP registration in inline scripts. */
export function detectImperative(html: string): { registers: boolean; deprecatedNamespace: boolean } {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  return {
    registers: /\bmodelContext\s*\.\s*(registerTool|provideContext)\s*\(/.test(scripts),
    deprecatedNamespace: /\bnavigator\s*\.\s*modelContext\b/.test(scripts),
  };
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const html = ctx.html ?? '';
  const analysis = analyseForms(html);
  const imperative = detectImperative(html);

  if (analysis.total === 0 && !imperative.registers && !imperative.deprecatedNamespace) {
    findings.push({
      status: 'pass',
      message: 'No forms and no WebMCP code — nothing here for an agent to invoke as a tool',
    });
    return notApplicable(meta, findings, start);
  }

  if (imperative.registers) {
    findings.push({
      status: 'pass',
      message: 'Imperative WebMCP registration detected in page scripts',
      detail: 'A static audit cannot enumerate the registered tools or validate their schemas; that needs a browser.',
    });
  }

  if (imperative.deprecatedNamespace) {
    findings.push({
      status: 'warn',
      message: 'Page uses the deprecated navigator.modelContext namespace',
      hint: 'Chrome moved the API to document.modelContext. Feature-detect both while the origin trial runs: const ctx = document.modelContext ?? navigator.modelContext.',
      learnMoreUrl: guideUrl(meta.id, 'deprecated-namespace'),
    });
    score -= 10;
  }

  if (analysis.annotated === 0) {
    findings.push({
      status: 'warn',
      message: `${analysis.total} form(s) on the page, none declared as agent tools`,
      detail:
        'WebMCP is a W3C Community Group draft in a Chrome origin trial. It is not a standard and adoption is minimal, ' +
        'so this is a forward-looking note, not a defect.',
      hint:
        'A declared form is called by an agent rather than driven pixel by pixel. Add toolname and tooldescription to ' +
        'the forms worth automating — search, filter, subscribe — and toolparamdescription to each field.',
      learnMoreUrl: guideUrl(meta.id, 'no-annotations'),
    });
    return buildResult(meta, score, findings, start);
  }

  findings.push({
    status: 'pass',
    message: `${analysis.annotated}/${analysis.total} form(s) declared as agent tools`,
  });

  if (analysis.missingDescription.length > 0) {
    findings.push({
      status: 'fail',
      message: `${analysis.missingDescription.length} tool form(s) declare a name but no description`,
      detail: analysis.missingDescription.join(', '),
      hint:
        'The description is what an agent reads to decide whether to call the tool; a named tool without one is ' +
        'unusable. Both attributes are required together.',
      learnMoreUrl: guideUrl(meta.id, 'missing-description'),
    });
    score -= 30;
  }

  if (analysis.missingName > 0) {
    findings.push({
      status: 'fail',
      message: `${analysis.missingName} form(s) declare a tool description but no tool name`,
      hint: 'Without a toolname there is nothing for an agent to call. Both attributes are required together.',
      learnMoreUrl: guideUrl(meta.id, 'missing-name'),
    });
    score -= 30;
  }

  if (analysis.invalidNames.length > 0) {
    findings.push({
      status: 'warn',
      message: 'Tool name is not a usable identifier',
      detail: analysis.invalidNames.join(', '),
      hint: 'A tool name is called like a function. Use letters, digits and underscores, starting with a letter: searchDocs, subscribe_newsletter.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-name'),
    });
    score -= 10;
  }

  if (analysis.undescribedParams.length > 0) {
    const totalMissing = analysis.undescribedParams.reduce((acc, p) => acc + p.missing, 0);
    findings.push({
      status: 'warn',
      message: `${totalMissing} tool parameter(s) have no description`,
      detail: analysis.undescribedParams.map((p) => `${p.tool}: ${p.missing}/${p.total} fields undescribed`).join('\n'),
      hint:
        'Add toolparamdescription to each named field. Without it an agent has to infer a field’s meaning from its ' +
        'name, which is how a search box gets an email address in it.',
      learnMoreUrl: guideUrl(meta.id, 'undescribed-params'),
    });
    score -= 15;
  } else {
    findings.push({ status: 'pass', message: 'Every tool parameter carries a description' });
  }

  if (analysis.autoSubmit.length > 0) {
    findings.push({
      status: 'pass',
      message: `${analysis.autoSubmit.length} tool form(s) declare toolautosubmit`,
      detail:
        'The agent submits without a further confirmation step. Appropriate for read-only actions such as search, not for anything that charges, sends or deletes.',
    });
  }

  return buildResult(meta, score, findings, start);
}
