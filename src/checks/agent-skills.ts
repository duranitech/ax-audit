import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult, isHtmlDocument, notApplicable } from './utils.js';
import { parseFrontmatter } from './frontmatter.js';
import { standingNote } from './well-known.js';
import { hasDocsSurface } from './surface.js';

/**
 * "agent-skills" — procedural instructions an agent can install, rather than
 * prose it has to infer from.
 *
 * llms.txt answers "what is on this site". A skill answers "how do I do the
 * thing this site is for" — the setup steps, the argument shapes, the mistakes
 * to avoid — in a format a coding agent installs and follows. For a
 * documentation site or a developer tool, that is the difference between an
 * agent reading about your API and an agent using it correctly.
 *
 * Discovery has not settled. Cloudflare's RFC specifies
 * `/.well-known/agent-skills/index.json`; Mintlify and Docus ship the shorter
 * `/.well-known/skills/index.json`; a single-skill site may just serve
 * `/skill.md`. All three are probed.
 *
 * The check is conditional. A restaurant's website has no skills to publish,
 * and scoring it zero would say something false. It reports N/A unless the site
 * shows developer-facing signals — a docs section, an llms.txt, or an API
 * description — in which case a missing skills index is worth mentioning.
 */
export const meta: CheckMeta = {
  id: 'agent-skills',
  name: 'Agent Skills',
  description: 'Checks discoverable Agent Skills (SKILL.md) and their frontmatter',
  weight: 0, // Informational: the discovery RFC is a draft.
  category: 'protocols',
};

const INDEX_PATHS = ['/.well-known/agent-skills/index.json', '/.well-known/skills/index.json'];
const SINGLE_SKILL_PATHS = ['/skill.md', '/SKILL.md'];

/** agentskills.io: lowercase, digits and hyphens, 1–64 characters. */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Cloudflare RFC: `sha256:` followed by 64 hex characters. */
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
/** agentskills.io caps the description at 1024 characters. */
const MAX_DESCRIPTION = 1024;
/** The specification recommends a skill body stay under 500 lines. */
const MAX_BODY_LINES = 500;
/** How many SKILL.md documents to fetch and validate. */
const SAMPLE_SIZE = 3;

interface IndexedSkill {
  name: string;
  description: string;
  type: string;
  url?: string;
  digest?: string;
}

async function fetchDocument(ctx: CheckContext, path: string): Promise<FetchResponse | null> {
  const res = await ctx.fetch(`${ctx.url}${path}`);
  if (!res.ok || res.body.trim().length === 0 || isHtmlDocument(res.body)) return null;
  return res;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];

  for (const path of INDEX_PATHS) {
    const res = await fetchDocument(ctx, path);
    if (res !== null) return validateIndex(ctx, path, res, findings, start);
  }

  for (const path of SINGLE_SKILL_PATHS) {
    const res = await fetchDocument(ctx, path);
    if (res !== null) return validateSingleSkill(path, res, findings, start);
  }

  if (!(await hasDocsSurface(ctx)).found) {
    findings.push({
      status: 'pass',
      message: 'No developer-facing surface — skills do not apply to this site',
      detail:
        'No documentation links, llms.txt, or API description found. Skills describe procedures an agent follows; a site with no procedures to teach has nothing to publish.',
    });
    return notApplicable(meta, findings, start);
  }

  findings.push({
    status: 'warn',
    message: 'No Agent Skills published',
    detail:
      `Checked ${[...INDEX_PATHS, ...SINGLE_SKILL_PATHS].join(', ')}. ${standingNote(INDEX_PATHS[0]) ?? ''}`.trim(),
    hint:
      'This site has documentation, so it has procedures worth teaching. A skill is a SKILL.md an agent installs and ' +
      'follows: setup steps, argument shapes, the mistakes to avoid. Publish one per task at ' +
      '/.well-known/agent-skills/{name}/SKILL.md and list them in /.well-known/agent-skills/index.json.',
    learnMoreUrl: guideUrl(meta.id, 'not-found'),
  });
  return buildResult(meta, 0, findings, start);
}

/** Validate a skills index and a sample of the skills it lists. */
async function validateIndex(
  ctx: CheckContext,
  path: string,
  res: FetchResponse,
  findings: Finding[],
  start: number,
): Promise<CheckResult> {
  let score = 100;

  findings.push({
    status: 'pass',
    message: `Agent Skills index published at ${path}`,
    detail: standingNote(path),
  });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    findings.push({
      status: 'fail',
      message: `Skills index at ${path} is not valid JSON`,
      hint: 'Fix the JSON syntax so agents can read the index.',
      learnMoreUrl: guideUrl(meta.id, 'invalid-json'),
    });
    return buildResult(meta, 10, findings, start);
  }

  if (data.$schema === undefined) {
    findings.push({
      status: 'warn',
      message: 'Skills index declares no $schema',
      hint: 'Add "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json" so a consumer knows which revision this is.',
      learnMoreUrl: guideUrl(meta.id, 'no-schema'),
    });
    score -= 5;
  }

  const skills: IndexedSkill[] = (Array.isArray(data.skills) ? (data.skills as Record<string, unknown>[]) : []).map(
    (s) => ({
      name: String(s.name ?? ''),
      description: String(s.description ?? ''),
      type: String(s.type ?? ''),
      url: typeof s.url === 'string' ? s.url : undefined,
      digest: typeof s.digest === 'string' ? s.digest : undefined,
    }),
  );

  if (skills.length === 0) {
    findings.push({
      status: 'warn',
      message: 'Skills index lists no skills',
      hint: 'An empty index advertises nothing. Add an entry per skill with name, description, type and url.',
      learnMoreUrl: guideUrl(meta.id, 'empty-index'),
    });
    return buildResult(meta, score - 30, findings, start);
  }

  findings.push({ status: 'pass', message: `${skills.length} skill(s) listed` });
  score = validateEntries(skills, findings, score);
  score = await sampleSkillDocuments(ctx, skills, findings, score);

  return buildResult(meta, score, findings, start);
}

/** Field rules from the Cloudflare discovery RFC and the agentskills.io specification. */
function validateEntries(skills: IndexedSkill[], findings: Finding[], score: number): number {
  const badName = skills.filter((s) => !SKILL_NAME_RE.test(s.name));
  if (badName.length > 0) {
    findings.push({
      status: 'warn',
      message: `${badName.length} skill name(s) outside the allowed format`,
      detail: badName.map((s) => s.name || '(empty)').join(', '),
      hint: 'Skill names are 1–64 characters of lowercase letters, digits and hyphens, and must match the directory the skill lives in.',
      learnMoreUrl: guideUrl(meta.id, 'name-format'),
    });
    score -= 10;
  }

  const noDescription = skills.filter((s) => s.description.trim() === '');
  if (noDescription.length > 0) {
    findings.push({
      status: 'fail',
      message: `${noDescription.length} skill(s) have no description`,
      detail: noDescription.map((s) => s.name).join(', '),
      hint: 'The description is what an agent reads to decide whether to install a skill. Without one the skill is invisible in practice.',
      learnMoreUrl: guideUrl(meta.id, 'no-description'),
    });
    score -= 15;
  }

  const longDescription = skills.filter((s) => s.description.length > MAX_DESCRIPTION);
  if (longDescription.length > 0) {
    findings.push({
      status: 'warn',
      message: `${longDescription.length} skill description(s) exceed ${MAX_DESCRIPTION} characters`,
      hint: 'Keep the index description short enough to scan; the detail belongs in SKILL.md.',
      learnMoreUrl: guideUrl(meta.id, 'long-description'),
    });
    score -= 5;
  }

  const badType = skills.filter((s) => s.type !== '' && s.type !== 'skill-md' && s.type !== 'archive');
  if (badType.length > 0) {
    findings.push({
      status: 'warn',
      message: 'Skill entry with an unrecognised type',
      detail: [...new Set(badType.map((s) => s.type))].join(', '),
      hint: 'Types are "skill-md" for a single Markdown file and "archive" for a bundle.',
      learnMoreUrl: guideUrl(meta.id, 'type-format'),
    });
    score -= 5;
  }

  const noDigest = skills.filter((s) => s.digest === undefined);
  const badDigest = skills.filter((s) => s.digest !== undefined && !DIGEST_RE.test(s.digest));
  if (badDigest.length > 0) {
    findings.push({
      status: 'warn',
      message: `${badDigest.length} skill digest(s) are malformed`,
      detail: badDigest.map((s) => `${s.name}: ${s.digest}`).join(', '),
      hint: 'A digest is "sha256:" followed by 64 lowercase hex characters.',
      learnMoreUrl: guideUrl(meta.id, 'digest-format'),
    });
    score -= 5;
  } else if (noDigest.length === skills.length) {
    findings.push({
      status: 'warn',
      message: 'No skill declares a content digest',
      hint:
        'A digest lets an agent verify it installed the skill you published, and notice when it changes. ' +
        'Add "digest": "sha256:…" to each entry.',
      learnMoreUrl: guideUrl(meta.id, 'no-digest'),
    });
    score -= 5;
  } else if (noDigest.length === 0) {
    findings.push({ status: 'pass', message: 'Every skill declares a content digest' });
  }

  return score;
}

/** Fetch a few SKILL.md documents and validate their frontmatter against the index. */
async function sampleSkillDocuments(
  ctx: CheckContext,
  skills: IndexedSkill[],
  findings: Finding[],
  score: number,
): Promise<number> {
  const sample = skills.filter((s) => s.url !== undefined).slice(0, SAMPLE_SIZE);
  if (sample.length === 0) {
    findings.push({
      status: 'warn',
      message: 'No skill entry carries a url',
      hint: 'Each entry needs a url pointing at its SKILL.md or archive, or an agent cannot install it.',
      learnMoreUrl: guideUrl(meta.id, 'no-url'),
    });
    return score - 15;
  }

  const problems: string[] = [];

  for (const skill of sample) {
    let url: string;
    try {
      url = new URL(skill.url!, `${ctx.url}/`).toString();
    } catch {
      problems.push(`${skill.name}: url is not resolvable (${skill.url})`);
      continue;
    }

    const res = await ctx.fetch(url);
    if (!res.ok || res.body.trim().length === 0) {
      problems.push(`${skill.name}: ${url} returns HTTP ${res.status || 'a network error'}`);
      continue;
    }
    if (skill.type === 'archive') continue; // Binary bundle: nothing to parse.

    const { frontmatter, body, present } = parseFrontmatter(res.body);
    if (!present) {
      problems.push(`${skill.name}: SKILL.md has no YAML frontmatter`);
      continue;
    }
    if (frontmatter.name === undefined) {
      problems.push(`${skill.name}: frontmatter has no name`);
    } else if (frontmatter.name !== skill.name) {
      problems.push(`${skill.name}: frontmatter name is "${frontmatter.name}", which disagrees with the index`);
    }
    if (frontmatter.description === undefined || frontmatter.description.trim() === '') {
      problems.push(`${skill.name}: frontmatter has no description`);
    }

    const lines = body.split('\n').length;
    if (lines > MAX_BODY_LINES) {
      findings.push({
        status: 'warn',
        message: `Skill "${skill.name}" is ${lines} lines long`,
        hint: `The specification recommends keeping a skill under ${MAX_BODY_LINES} lines. Split long procedures into separate skills so an agent loads only what it needs.`,
        learnMoreUrl: guideUrl(meta.id, 'long-skill'),
      });
    }
  }

  if (problems.length > 0) {
    findings.push({
      status: 'fail',
      message: `${problems.length} problem(s) in the sampled skill document(s)`,
      detail: problems.join('\n'),
      hint: 'An index entry an agent cannot install is worse than no entry, because it is trusted before it is fetched.',
      learnMoreUrl: guideUrl(meta.id, 'broken-skill'),
    });
    return score - 10 * problems.length;
  }

  findings.push({ status: 'pass', message: `${sample.length} sampled skill document(s) install cleanly` });
  return score;
}

/** A site with one skill and no index still publishes something usable. */
function validateSingleSkill(path: string, res: FetchResponse, findings: Finding[], start: number): CheckResult {
  let score = 100;
  const { frontmatter, present } = parseFrontmatter(res.body);

  findings.push({ status: 'pass', message: `Skill published at ${path}` });
  findings.push({
    status: 'warn',
    message: 'Skill is not listed in a discovery index',
    hint:
      'A bare /skill.md is only found by guessing. Publish /.well-known/agent-skills/index.json listing it, so an ' +
      'agent discovers it the same way it discovers everything else.',
    learnMoreUrl: guideUrl(meta.id, 'no-index'),
  });
  score -= 20;

  if (!present) {
    findings.push({
      status: 'fail',
      message: 'SKILL.md has no YAML frontmatter',
      hint: 'A skill needs frontmatter with at least name and description; without it an agent cannot register the skill.',
      learnMoreUrl: guideUrl(meta.id, 'no-frontmatter'),
    });
    return buildResult(meta, score - 30, findings, start);
  }

  if (frontmatter.name === undefined || !SKILL_NAME_RE.test(frontmatter.name)) {
    findings.push({
      status: 'warn',
      message: `Skill name ${frontmatter.name === undefined ? 'missing' : `"${frontmatter.name}" is outside the allowed format`}`,
      hint: 'Names are 1–64 characters of lowercase letters, digits and hyphens.',
      learnMoreUrl: guideUrl(meta.id, 'name-format'),
    });
    score -= 10;
  }

  if (frontmatter.description === undefined || frontmatter.description.trim() === '') {
    findings.push({
      status: 'fail',
      message: 'Skill has no description',
      hint: 'The description is what an agent reads to decide whether to install the skill.',
      learnMoreUrl: guideUrl(meta.id, 'no-description'),
    });
    score -= 15;
  } else {
    findings.push({ status: 'pass', message: `Skill "${frontmatter.name ?? '(unnamed)'}" declares a description` });
  }

  return buildResult(meta, score, findings, start);
}
