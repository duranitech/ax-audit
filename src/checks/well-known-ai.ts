import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding, FetchResponse } from '../types.js';
import { buildResult } from './utils.js';
import { standingNote } from './well-known.js';

/**
 * "well-known-ai" — the emerging discovery files that do not yet have a check
 * of their own.
 *
 * The 3.0 version of this check probed five files and scored a site on how many
 * it published. Re-verifying that list on 2026-09-04 found the premise was
 * wrong for three of the five:
 *
 * - `/.well-known/nlweb.json` **does not exist**. It appears in no NLWeb
 *   release, document or commit; the project exposes `/ask` and `/mcp`
 *   endpoints instead. ax-audit was marking sites down for omitting a file
 *   nobody has ever specified.
 * - `genai.txt` has no specification, reference implementation or documented
 *   consumer that could be found anywhere.
 * - `/ai-plugin.json` described ChatGPT plugins, shut down on 2024-04-09.
 *
 * Scoring a site on files like these is worse than not checking them: it
 * manufactures work with no payoff and lends the files a legitimacy they never
 * earned. So in 3.7 the score is frozen at the pre-3.7 formula — removing a
 * scored probe would move existing scores, which 3.x forbids — while every
 * finding now states what each file actually is. The retired files are dropped
 * outright in 4.0.
 *
 * Alongside, the check reports genuinely current files that no other check
 * owns: the Web Bot Auth key directory, TDMRep, GPC, the OpenAI Apps domain
 * verification token, and `AGENTS.md`. Those are informational and never
 * scored.
 */
export const meta: CheckMeta = {
  id: 'well-known-ai',
  name: 'AI Well-Known',
  description: 'Checks emerging AI discovery files and reports their real standing',
  weight: 3,
  category: 'protocols',
};

interface Probe {
  paths: string[];
  label: string;
  /** Why a reader should, or should not, care that this file is missing. */
  standing: string;
  hint: string;
  guideAnchor: string;
  /** Retired or fictional: present only so the scoring formula stays stable until 4.0. */
  retired?: boolean;
  parser?: (body: string) => boolean;
}

function parsesAsJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * The five files the 3.x score is computed over. The list is frozen: adding or
 * removing an entry changes the denominator and therefore every score.
 */
const SCORED_PROBES: Probe[] = [
  {
    paths: ['/.well-known/ai.txt', '/ai.txt'],
    label: 'ai.txt',
    standing:
      'Spawning proposal from 2023 at the site root, plus an individual IETF draft (draft-car-ai-txt-wellknown, expires 2026-12) for the well-known variant. Adoption surveys find essentially no valid files in the wild.',
    hint:
      'Declare training preferences where operators actually read them: robots.txt Content-Signal (Cloudflare serves it by default) or, forward-looking, Content-Usage per IETF AIPREF. ' +
      'ai.txt has no documented consumer beyond Spawning.',
    guideAnchor: 'ai-txt',
  },
  {
    paths: ['/.well-known/genai.txt'],
    label: 'genai.txt',
    standing: 'No specification, reference implementation or documented consumer was found for this file.',
    hint: 'Nothing consumes this file. Express generative-AI preferences through robots.txt Content-Signal or RSL instead.',
    guideAnchor: 'genai-txt',
    retired: true,
  },
  {
    paths: ['/.well-known/ai-plugin.json', '/ai-plugin.json'],
    label: 'ai-plugin.json',
    standing:
      'The ChatGPT plugin manifest. Plugins were deprecated on 2024-03-19 and shut down on 2024-04-09, replaced by GPT Actions and then by MCP.',
    hint: 'Publish an MCP server card instead. If you still serve ai-plugin.json, nothing reads it.',
    guideAnchor: 'ai-plugin',
    retired: true,
    parser: (body) => {
      try {
        const data = JSON.parse(body) as Record<string, unknown>;
        return Boolean(data.name_for_model || data.name_for_human || data.schema_version);
      } catch {
        return false;
      }
    },
  },
  {
    paths: ['/agents.json', '/.well-known/agents.json'],
    label: 'agents.json',
    standing:
      'The Wildcard agents.json proposal. Its repository has had no commits since 2025-08-21 and no consumer is documented.',
    hint: 'Publish an A2A Agent Card at /.well-known/agent-card.json, which is IANA-registered and actively maintained.',
    guideAnchor: 'agents-json',
    retired: true,
    parser: (body) => {
      try {
        const data = JSON.parse(body) as Record<string, unknown>;
        return Boolean(data.name || data.operations || data.agents);
      } catch {
        return false;
      }
    },
  },
  {
    paths: ['/.well-known/nlweb.json', '/nlweb.json'],
    label: 'nlweb.json',
    standing:
      'This file does not exist. It appears in no NLWeb release, document or commit. NLWeb exposes /ask and /mcp endpoints, driven by the schema.org JSON-LD already on your pages.',
    hint: 'Nothing to publish. If you want NLWeb, run the server and expose /ask and /mcp; it reads the structured data you already have.',
    guideAnchor: 'nlweb',
    retired: true,
    parser: parsesAsJson,
  },
];

/** Current files reported but never scored, because no other check owns them. */
const REPORTED_PROBES: Probe[] = [
  {
    paths: ['/.well-known/http-message-signatures-directory'],
    label: 'Web Bot Auth key directory',
    standing:
      'Registered well-known URI. The IETF webbotauth working group adopted the protocol on 2026-09-01. Publish one only if this site operates an agent that fetches other sites.',
    hint: 'Relevant when you run an agent. Sites being crawled do not publish one; they verify the directories of the agents that visit them.',
    guideAnchor: 'web-bot-auth',
    parser: (body) => {
      try {
        const data = JSON.parse(body) as Record<string, unknown>;
        return Array.isArray(data.keys);
      } catch {
        return false;
      }
    },
  },
  {
    paths: ['/.well-known/tdmrep.json'],
    label: 'TDM Reservation Protocol',
    standing:
      'W3C Community Group Final Report, provisionally registered with IANA, and named in the EU GPAI Code of Practice as a candidate opt-out protocol. Its weight is legal rather than technical.',
    hint: 'Publish [{"location": "/", "tdm-reservation": 1, "tdm-policy": "https://example.com/tdm-policy"}] if you want an EU-recognised text-and-data-mining reservation.',
    guideAnchor: 'tdmrep',
    parser: (body) => {
      try {
        const data = JSON.parse(body);
        return Array.isArray(data) && data.every((e) => typeof e === 'object' && e !== null && 'location' in e);
      } catch {
        return false;
      }
    },
  },
  {
    paths: ['/.well-known/openai-apps-challenge'],
    label: 'OpenAI Apps domain verification',
    standing: 'Vendor convention. Present only on domains submitted to the ChatGPT Apps directory.',
    hint: 'Only needed if you are publishing a ChatGPT app. Not a general readiness signal.',
    guideAnchor: 'openai-apps',
  },
  {
    paths: ['/AGENTS.md', '/agents.md'],
    label: 'AGENTS.md',
    standing:
      'Convention for telling a coding agent how to work in a repository. Vercel’s agent-readability checklist expects one on documentation sites.',
    hint: 'Publish AGENTS.md with install, configuration and usage sections if agents are expected to build against your project.',
    guideAnchor: 'agents-md',
  },
];

async function probeFor(ctx: CheckContext, probe: Probe): Promise<{ path: string; res: FetchResponse } | null> {
  for (const path of probe.paths) {
    const res = await ctx.fetch(`${ctx.url}${path}`);
    if (res.ok && res.body.trim().length > 0) return { path, res };
  }
  return null;
}

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let presentCount = 0;

  for (const probe of SCORED_PROBES) {
    const hit = await probeFor(ctx, probe);

    if (hit === null) {
      findings.push({
        status: probe.retired ? 'pass' : 'warn',
        message: probe.retired
          ? `${probe.label} not published — correct, the format is retired`
          : `${probe.label} not found`,
        detail: probe.standing,
        ...(probe.retired
          ? {}
          : {
              hint: probe.hint,
              learnMoreUrl: guideUrl(meta.id, probe.guideAnchor),
            }),
      });
      continue;
    }

    if (probe.parser && !probe.parser(hit.res.body)) {
      findings.push({
        status: 'warn',
        message: `${probe.label} present at ${hit.path} but does not look valid`,
        detail: probe.standing,
        hint: probe.hint,
        learnMoreUrl: guideUrl(meta.id, `${probe.guideAnchor}-invalid`),
      });
      continue;
    }

    presentCount++;
    findings.push({
      status: probe.retired ? 'warn' : 'pass',
      message: probe.retired
        ? `${probe.label} served at ${hit.path}, but nothing reads it`
        : `${probe.label} present at ${hit.path}`,
      detail: probe.standing,
      ...(probe.retired ? { hint: probe.hint, learnMoreUrl: guideUrl(meta.id, probe.guideAnchor) } : {}),
    });
  }

  // Frozen 3.x formula: coverage of the five probes above. Three of them are
  // retired formats, so this score says less about a site than it appears to —
  // which is why the check loses its weight in 4.0.
  const score = Math.round((presentCount / SCORED_PROBES.length) * 100);

  findings.unshift({
    status: presentCount > 0 ? 'pass' : 'warn',
    message: `${presentCount}/${SCORED_PROBES.length} legacy AI discovery files published`,
    detail:
      'Three of these five formats are retired or were never specified. This score is frozen for 3.x compatibility ' +
      'and the check is replaced in 4.0 by ai-catalog and agent-skills.',
  });

  await reportCurrentFiles(ctx, findings);

  return buildResult(meta, score, findings, start);
}

/** Report present-day files that no other check owns. Never scored. */
async function reportCurrentFiles(ctx: CheckContext, findings: Finding[]): Promise<void> {
  for (const probe of REPORTED_PROBES) {
    const hit = await probeFor(ctx, probe);
    if (hit === null) continue;

    const valid = probe.parser ? probe.parser(hit.res.body) : true;
    findings.push({
      status: valid ? 'pass' : 'warn',
      message: valid
        ? `${probe.label} published at ${hit.path}`
        : `${probe.label} present at ${hit.path} but malformed`,
      detail: [probe.standing, standingNote(hit.path)].filter(Boolean).join(' '),
      ...(valid ? {} : { hint: probe.hint, learnMoreUrl: guideUrl(meta.id, `${probe.guideAnchor}-invalid`) }),
    });
  }
}
