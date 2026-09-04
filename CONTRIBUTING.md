# Contributing to ax-audit

Thanks for your interest in improving ax-audit. This guide covers the workflow, project conventions, and the specific steps a new check requires.

## Development setup

```bash
git clone https://github.com/axrush/ax-audit.git
cd ax-audit
npm install
npm test        # builds (tsc) then runs node:test
```

Requirements: Node.js 18+. There are only two runtime dependencies (`chalk`, `commander`) and no test dependencies — the suite uses the built-in `node:test` runner.

## Project conventions

- **TypeScript strict mode.** No `any` escapes; model fallibility in the types.
- **No new runtime dependencies** without discussion. Network uses built-in `fetch`; HTML/XML are inspected with the regex primitives in `src/checks/html-utils.ts`, not a parser dependency.
- **Lint and format must pass:** `npm run lint` (ESLint) and `npm run format:check` (Prettier).
- **Everything is tested.** New behavior ships with tests. The suite covers every check, the scorer, baselines, the Markdown reporter, and integration tests that spin up real local HTTP servers for the fetcher and orchestrator.
- **All network goes through `ctx.fetch`** — never raw `fetch` in a check — so caching, retries, timeouts, and `--verbose` apply uniformly.
- **Findings are actionable.** Every `warn`/`fail` carries a `hint` with a concrete fix and a `learnMoreUrl` to a remediation guide.

## Workflow

1. Open an issue describing the change first for anything non-trivial.
2. Branch from `main`.
3. Make the change with tests, docs, and (for checks) a remediation guide.
4. Run `npm run lint && npm run format:check && npm test` — all green.
5. Open a PR. Keep commits focused; describe the *why*.

## Adding a new check

A check is one module exporting `default` (the async check function) and `meta`. See `src/checks/content-negotiation.ts` for a clean reference and [docs/architecture.md](docs/architecture.md) for the anatomy.

1. **Create `src/checks/your-check.ts`** exporting `default` + `meta`. Use `buildResult(meta, score, findings, start)` from `./utils.js`. New checks ship at **weight 0** (informational) — see the scoring policy below.
2. **Register it** in `src/checks/index.ts`.
3. **Add its weight** to `CHECK_WEIGHTS` in `src/constants.ts` (use `0` for 3.x).
4. **Write tests** in `test/checks/your-check.test.js` using `mockContext` / `mockResponse` from `test/helpers.js`. Route values may be functions `(url, fetchOptions) => response` when the response must vary by request header.
5. **Document it** in `docs/checks.md` (with exact scoring) and the README table.
6. **Write the remediation guide** covering *every* `learnMoreUrl` anchor your findings emit. Guides are published at [axrush.com/guides](https://axrush.com/guides); an undocumented anchor is an incomplete check.
7. **Update the CHANGELOG** under a new version heading.

## Scoring policy (important)

Score deltas on the same site are treated as **breaking** (see `CHANGELOG.md`, 3.0.0). Therefore:

- New checks ship at **weight 0** — full findings, zero effect on the overall score or existing baselines.
- New findings inside an existing weighted check must be **informational** (no score deduction) — see the Content Signals findings inside `robots-txt`.
- Weight (re)distribution happens only in **major** versions.

This lets the tool grow continuously without silently moving users' scores.

## Commit & PR style

- Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`) are preferred.
- One logical change per PR.
- Update `docs/` and the CHANGELOG in the same PR as the code.

## Reporting bugs

Open an issue with the output of `npx ax-audit <url> --verbose` and the expected vs actual behavior. For security issues, see [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree your contributions are licensed under the project's [Apache 2.0](LICENSE) license.
