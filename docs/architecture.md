# Architecture

ax-audit is a dependency-light TypeScript codebase: two runtime dependencies (`chalk`, `commander`), Node 18+ built-in `fetch`, no HTTP libraries, no XML/HTML parser dependencies (regex-based primitives), and the built-in `node:test` runner.

## Pipeline

```
cli.ts ──► orchestrator.ts ──► checks/* (Promise.allSettled, parallel)
              │                     │
              ▼                     ▼
          fetcher.ts            scorer.ts ──► reporter/{terminal,json,html,markdown}
        (cache + retries)                          │
              ▲                                baseline.ts (save / load / diff)
              └── shared by every check via CheckContext.fetch
```

1. **cli.ts** parses and validates flags, loads the baseline if requested, and dispatches to single or batch mode.
2. **orchestrator.ts** (`audit`) creates one fetcher per run, fetches the homepage once, builds the `CheckContext` (`url`, `html`, `headers`, `fetch`), and runs all selected checks in parallel. A check that throws is converted into a score-0 result with the error as a finding — one bad check never kills the audit. `batchAudit` runs `audit` per URL through an order-preserving work queue with configurable `concurrency`.
3. **fetcher.ts** wraps `fetch` with: per-run in-memory caching keyed on URL + normalized (lowercased, sorted) custom headers — mirroring HTTP `Vary` semantics so a `text/markdown` probe never collides with the HTML fetch; case-insensitive header merging over defaults; timeouts via `AbortController`; and retries with exponential backoff for transient failures (status 0, 408, 425, 429, 5xx). Errors never throw — they become `{ status: 0, ok: false, error }` results, also cached.
4. **checks/** — one module per check (18). Each exports `default` (async check function) and `meta` (`{ id, name, description, weight }`).
5. **scorer.ts** computes the weighted average; when all selected checks have weight 0 it falls back to a plain average.
6. **reporter/** renders to terminal (chalk), JSON, self-contained HTML, or Markdown.
7. **baseline.ts** persists minimal score snapshots and computes per-check diffs for regression gating.

## Anatomy of a check

```typescript
import { guideUrl } from '../guide-urls.js';
import type { CheckContext, CheckResult, CheckMeta, Finding } from '../types.js';
import { buildResult } from './utils.js';

export const meta: CheckMeta = {
  id: 'my-check',
  name: 'My Check',
  description: 'One-line description shown in reports',
  weight: 0, // new checks start informational in 3.x
};

export default async function check(ctx: CheckContext): Promise<CheckResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  let score = 100;

  const res = await ctx.fetch(`${ctx.url}/something`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    findings.push({
      status: 'fail',
      message: '/something not found',
      hint: 'Actionable, copy-pasteable advice.',
      learnMoreUrl: guideUrl(meta.id, 'not-found'),
    });
    return buildResult(meta, 0, findings, start);
  }

  // ... validations, each pushing a pass/warn/fail Finding and adjusting score

  return buildResult(meta, score, findings, start);
}
```

Conventions:

- **Findings are actionable.** Every `warn`/`fail` carries a `hint` with concrete remediation and a `learnMoreUrl` pointing to `lucioduran.com/projects/ax-audit/guides/<check-id>#<anchor>`. Every anchor must have a section in that guide.
- **Scores are clamped** to [0, 100] by `buildResult`.
- **Shared HTML primitives** live in `checks/html-utils.ts` (`getMetaContent`, `findLinkTags`, `getAttribute`, `extractVisibleText`, …) — no per-check regex duplication.
- **Content-Type validation** uses `checkContentType` from `checks/utils.ts` (−5 convention for mismatches).
- **Network goes through `ctx.fetch`** — never raw `fetch` — so caching, retries, timeouts, and `--verbose` logging apply uniformly.

## Adding a new check

1. Create `src/checks/your-check.ts` exporting `default` + `meta` (weight 0 — see scoring policy below).
2. Register it in `src/checks/index.ts`.
3. Add its weight to `CHECK_WEIGHTS` in `src/constants.ts`.
4. Add a test suite in `test/checks/your-check.test.js` using `mockContext` / `mockResponse` from `test/helpers.js`. Route values can be functions `(url, fetchOptions) => response` when the response must vary by request headers.
5. Document it in `docs/checks.md` and the README table.
6. Write the remediation guide covering every `learnMoreUrl` anchor you emit.

## Scoring policy (3.x)

Score deltas on the same site are treated as **breaking** (see CHANGELOG 3.0.0). Therefore in 3.x:

- New checks ship with **weight 0** (informational): full findings, no effect on the overall score or baselines.
- New findings inside weighted checks must be informational (no score deduction) — see the Content Signals findings in `robots-txt`.
- Weight redistribution happens in major versions (v4.0).

## Testing

`npm test` builds (`tsc`) and runs `node --test`. The suite (301 tests) covers every check, the scorer, baseline logic, the Markdown reporter, plus integration tests that spin up real local HTTP servers for the fetcher (per-header caching, retries) and the batch orchestrator (ordering, concurrency caps). No test dependencies beyond Node.
