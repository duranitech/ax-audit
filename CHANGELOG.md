# Changelog

All notable changes to ax-audit are documented here.

## [3.1.0] - 2026-06-06

### Added

- **content-negotiation check (informational)**: probes the homepage with `Accept: text/markdown` to detect Markdown for Agents support — the pattern implemented by Cloudflare and Vercel and requested by Claude Code, Cursor, and OpenCode. Validates the negotiated `Content-Type`, that the body is actual Markdown (not a relabeled HTML document), `Vary: Accept` presence (shared-cache correctness), and reports the size reduction vs the HTML representation. Falls back to detecting `<link rel="alternate" type="text/markdown">` for partial credit.
- **Per-request fetch headers**: `CheckContext.fetch` now accepts an optional `{ headers }` argument. Custom headers merge case-insensitively over the defaults, and the in-memory cache keys on URL + normalized headers, mirroring `Vary` semantics on the wire. New exported type: `FetchOptions`.
- **31 new tests** (229 total): content-negotiation suite (19), fetcher integration suite against a real local HTTP server (9), and scorer coverage for weight-0 checks (3).

### Fixed

- **Scorer division by zero**: `calculateOverallScore` returned `NaN` when every selected check had weight 0 (e.g. `--checks content-negotiation`). It now falls back to a plain average, and returns 0 for empty input.

### Scoring

- The new check carries **weight 0 in 3.x**: it runs and reports findings but does not affect the overall score, so existing scores and baselines are unchanged. It will gain weight in v4.0, consistent with treating score-affecting changes as breaking (see 3.0.0).

## [3.0.0] - 2026-04-30

### Added — five new checks (full agent-optimization coverage)

- **html-rendering** (weight 9%): detects whether the static HTML response actually contains content, since most AI crawlers (GPTBot, ClaudeBot, CCBot, …) do not execute JavaScript. Heuristics: text length, word count, text-to-markup ratio, empty SPA mount points (`#root`, `#__next`, `#__nuxt`, `#app`, `#svelte`, `#gatsby`), semantic landmarks (`<main>`, `<article>`, `<header>`, `<footer>`, `<nav>`), single `<h1>`, `<noscript>` fallback, and `<img alt>` coverage.
- **sitemap** (weight 4%): locates the sitemap via `robots.txt` `Sitemap:` directive or `/sitemap.xml`, validates XML shape, parses `<urlset>` and `<sitemapindex>`, samples child sitemaps from indexes, scores `<lastmod>` coverage and freshness (>365d → stale), enforces 50k-URL / 50MB limits.
- **seo-basics** (weight 7%): `<title>` length 20–70, `<meta name="description">` length 70–160, `<link rel="canonical">` (absolute, single), `<html lang>` (BCP 47), `<meta charset="utf-8">`, `<meta name="viewport">`, hreflang completeness with `x-default`. Title/description duplication detection.
- **tls-https** (weight 5%): site is served over HTTPS, HTTP redirects to HTTPS, HSTS `max-age` >= 6 months (1 year for preload), `includeSubDomains`, `preload` directive eligibility per https://hstspreload.org.
- **well-known-ai** (weight 3%): emerging AI-specific discovery files — `/.well-known/ai.txt` (Spawning), `/.well-known/genai.txt`, `/ai-plugin.json` (legacy ChatGPT plugin), `/agents.json` (Wildcard / OpenAgents), `/.well-known/nlweb.json` (Microsoft NLWeb). Each present file scores; coverage is bonus rather than baseline.

### Improved — existing checks

- **meta-tags**: now validates Open Graph completeness (`og:title`, `og:description`, `og:url`, `og:type`, `og:image`, `og:site_name`) and Twitter Card completeness (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`). Reuses shared HTML utilities for tag matching.
- **agent-json**: validates the `url` field is absolute and matches the audited origin, and that every `skills[]` entry has both `id` and `description`.
- **llms-txt / agent-json / mcp / openapi**: validate `Content-Type` of the fetched resource (`text/plain` / `text/markdown` for llms.txt; `application/json` for the JSON manifests). Penalty: −5 per mismatch.
- **robots-txt**: `CORE_AI_CRAWLERS` extended (now 8 entries: GPTBot, ClaudeBot, ChatGPT-User, Claude-SearchBot, Google-Extended, PerplexityBot, OAI-SearchBot, CCBot). `ALL_AI_CRAWLERS` extended with MistralAI-User, KagiBot, GeminiBot, Goose, AwarioBot family, Bingbot, ImagesiftBot, omgili, Webzio-Extended, and others (47 known crawlers total).

### Refactored

- New shared module `src/checks/html-utils.ts` with regex-based primitives for HTML inspection (`getMetaContent`, `findLinkTags`, `findMetaTagsByPrefix`, `extractVisibleText`, `countExecutableScripts`, `getTagAttribute`, …). Eliminates duplicated regex code across `meta-tags`, `seo-basics`, `html-rendering`, and `structured-data`.
- New shared utility `checkContentType` in `src/checks/utils.ts` for consistent Content-Type validation.

### Scoring

- Weights redistributed across 14 checks, total still sums to 100. New highest-weight signals are llms-txt and robots-txt (11% each) followed by html-rendering / structured-data / http-headers (9%).

### Tests

- 198 tests total (77 new). New suites: html-rendering (14), sitemap (12), seo-basics (19), tls-https (11), well-known-ai (8). Plus expanded meta-tags / agent-json / mcp / openapi / llms-txt suites for the new validations.

### Breaking

- Score deltas vs v2.x are expected on the same site because (a) weights were redistributed across 14 checks instead of 9, and (b) Content-Type validation on `/llms.txt` and the `.well-known` JSON manifests now applies a −5 penalty per mismatch. Sites previously scoring 100 may drop a few points until the new signals are addressed. Use `--baseline` to track regressions explicitly.

## [2.4.0] - 2026-04-16

### Added

- **Baseline comparison**: `--save-baseline <path>` saves audit results as a baseline JSON file; `--baseline <path>` compares against a previous baseline and shows per-check score deltas (▲/▼) in terminal, JSON, and HTML output
- **Regression gate**: `--fail-on-regression <points>` exits with code 1 if any individual check regresses by more than the specified threshold — ideal for CI/CD quality gates
- **Programmatic API**: new `saveBaseline()`, `loadBaseline()`, `diffBaseline()`, and `toBaselineData()` exports with full TypeScript types (`BaselineData`, `BaselineDiff`, `CheckDiff`)
- **15 new tests** for baseline save/load/diff logic, including edge cases for missing files, invalid JSON, removed checks, and mixed regressions/improvements

### Fixed

- **Test runner glob**: `npm test` now correctly discovers test files in both `test/` root and subdirectories

## [2.0.0] - 2026-02-27

### Added

- **HTML reporter**: `--output html` generates a self-contained HTML report with circular score gauge, dark mode support, collapsible check sections, and responsive design
- Supports both single URL and batch reports
- Pipe to file: `ax-audit https://example.com --output html > report.html`

## [1.15.0] - 2026-02-27

### Added

- **Batch audit**: pass multiple URLs to audit them in a single run with summary table (`ax-audit url1 url2 url3`)
- **`batchAudit()` API**: programmatic batch auditing with `BatchAuditReport` type
- **CHANGELOG.md**: full project history

## [1.14.0] - 2026-02-27

### Added

- **RFC 5988 Link header parser**: proper parsing of `<url>; rel="type"` format instead of naive regex matching
- Prevents false positives from parameter values like `title="llms.txt"`

## [1.13.0] - 2026-02-27

### Fixed

- **Structured data**: `@context` now supports string, array, and `@vocab` object formats
- **Structured data**: `collectTypes()` recurses into nested entities (author, publisher, etc.) with depth limit

## [1.12.0] - 2026-02-27

### Added

- **`--only-failures` flag**: filter output to show only checks with warnings or failures

## [1.11.0] - 2026-02-27

### Added

- **MCP check**: new check for `/.well-known/mcp.json` (Model Context Protocol) server configuration (weight: 10%)
- Check weights redistributed across 9 checks: llms-txt 15%, robots-txt 15%, structured-data 13%, http-headers 13%, agent-json 10%, mcp 10%, security-txt 8%, meta-tags 8%, openapi 8%

## [1.10.0] - 2026-02-27

### Added

- **ESLint + Prettier**: code quality tooling with CI integration

## [1.9.0] - 2026-02-27

### Added

- **Public TypeScript API**: new `src/index.ts` entry point exporting `audit`, `calculateOverallScore`, `getGrade`, `checks`, and all types
- Package `exports` field pointing to `dist/index.js`

## [1.8.0] - 2026-02-27

### Added

- **`--checks` validation**: unknown check IDs now error with a list of available checks

## [1.7.0] - 2026-02-27

### Changed

- All checks refactored to use shared `buildResult()` utility from `src/checks/utils.ts`

## [1.6.0] - 2026-02-27

### Added

- **CI/CD**: GitHub Actions workflow running lint, format check, build, and tests

## [1.5.0] - 2026-02-27

### Added

- **`--verbose` flag**: detailed HTTP request, cache hit, and check execution logs

## [1.4.0] - 2026-02-27

### Added

- **97 tests**: comprehensive test suite covering all 9 checks and edge cases (Node.js built-in test runner)

## [1.3.0] - 2026-02-27

### Fixed

- **Robots.txt parser**: handles partial disallows, multi-UA blocks, wildcard detection, comment lines

## [1.2.0] - 2026-02-27

### Fixed

- **Score bounds**: all checks now clamp scores to 0-100 range

## [1.0.1] - 2025-01-15

### Changed

- Switched license from MIT to Apache 2.0
- Improved README with badges and documentation

## [1.0.0] - 2025-01-15

### Added

- Initial release of ax-audit
- 8 checks: llms-txt, robots-txt, structured-data, http-headers, agent-json, security-txt, meta-tags, openapi
- Terminal and JSON output formats
- Weighted scoring system with grades (Excellent, Good, Fair, Poor)
- CLI with `--json`, `--output`, `--timeout` flags
- TypeScript codebase with zero HTTP library dependencies
