# Changelog

All notable changes to ax-audit are documented here.

## [3.7.0] - 2026-09-04

A correction release. Three checks were probing paths that are no longer, or never were, the standard, and the crawler catalogue had drifted far enough to contain tokens that do not exist. Everything here was re-verified against vendor documentation, IANA, IETF datatracker and the relevant specification repositories on 2026-09-04.

**No score goes down.** Every correction that would have lowered an existing score is frozen behind a constant that is removed in 4.0, and tests assert it.

### Fixed — wrong paths

- **A2A Agent Card moved.** The check probed `/.well-known/agent.json`. A2A relocated the card to `/.well-known/agent-card.json` in v0.3.0 (2025-07-30), and that path is IANA-registered. Both are probed, the registered one first; a card served only from the old path is validated and flagged. The check also handles both spec generations: A2A 1.0 (2026-03-12) folded `url`, `protocolVersion`, `preferredTransport` and `additionalInterfaces` into `supportedInterfaces[]`, and the generation is detected from the card's own structure rather than a version field. `authentication`, removed in 0.2.x in favour of `securitySchemes`, is now flagged. Renamed `agent-json` → `agent-card`.
- **`/.well-known/mcp.json` was never an MCP convention.** ax-audit recommended it before the ecosystem settled. Discovery now walks the real chain: `/.well-known/ai-catalog.json`, `/.well-known/mcp/server-card.json`, `<endpoint>/server-card`, then the legacy manifest. Server cards deliberately carry no `tools[]` — tool lists come from a live `tools/list` call. Protocol versions are checked against the five released revisions, with `2026-07-28` current. Renamed `mcp` → `mcp-discovery`.
- **`/.well-known/openapi.json` is a folk convention**, so a site publishing at `/openapi.json` scored zero. Discovery now runs in order of authority: RFC 9727's registered `/.well-known/api-catalog`, then RFC 8631 `service-desc` relations in headers and HTML, then ten conventional paths. YAML descriptions are recognised and reported as surface-validated only, since ax-audit ships no YAML parser. Renamed `openapi` → `api-discovery`.
- **`agent-access` was probing with `Google-Extended`.** That string is a robots.txt control token governing how an already-crawled page may be used; no request carries it, so the probe tested nothing. Token-only controls are excluded, leaving 10 real crawlers.
- **`http-headers` and `meta-tags` penalised correct behaviour**, requiring a discovery link to `agent.json` specifically. Either card path now counts.
- **An SPA catch-all page is absence, not corruption.** Found by running the new checks against a real site: probing `/mcp/server-card` returned HTTP 200 with the application's index shell, and the check reported a malformed server card on a site with no MCP server. `isHtmlDocument` now gates the speculative probes in `agent-card`, `mcp-discovery` and `api-discovery`.

### Fixed — crawler catalogue

Verified against vendor documentation on 2026-09-04. Removed tokens that were never real user agents (`Gemini`, `GeminiBot`, `DeepSeek-AI`), whose products were discontinued (`NeevaBot`, `Operator`, `GoogleAgent-Mariner`), whose vendor operates no crawlers (Cohere), or that are not AI crawlers at all (the Awario social-listening family). Reclassified five user-triggered fetchers that were listed as training crawlers. Added `meta-webindexer`, `Amzn-SearchBot`, `Amzn-User`, `MistralAI-Index`, `MistralAI-Training`, `Google-GeminiNotebook`, `Applebot`, `ExaSearchBot`, `TikTokSpider`, `OAI-AdsBot`, `YandexAdditional`.

The catalogue is now organised by what a client does with a page — training, search, user-fetch, agent — because that determines the cost of blocking it. `CRAWLER_META` carries per token the vendor, whether robots.txt is honored, the published IP list, whether requests are signed with Web Bot Auth, and one sentence on what blocking costs. Findings quote it: "blocking OAI-SearchBot removes you from ChatGPT search answers", not "1 AI crawler blocked".

### Added

- **Response classification.** `checks/waf.ts` distinguishes a deliberate block from a JavaScript challenge from anti-spoofing, because the remedies are completely different. Signatures verified 2026-09-04: `cf-mitigated: challenge`, `x-vercel-mitigated`, AWS WAF's 202 with `x-amzn-waf-action`, Cloudflare pay-per-crawl's `crawler-price`, x402's `payment-signature`, Web Bot Auth's `Accept-Signature`, RSL's `WWW-Authenticate: License`, plus thirteen body markers. Outcomes an unsigned probe cannot settle are scored at 0.75 and labelled inconclusive with the header observed — never as "blocks AI crawlers".
- **IETF AIPREF `Content-Usage:`** in robots.txt (draft-ietf-aipref-attach-05), with an optional path scope and a Structured Fields dictionary. The loudest finding is a vocabulary mix-up: AIPREF spells the training token `train-ai` with `y`/`n` while Content Signals and RSL spell it `ai-train` with `yes`/`no`, so `Content-Usage: ai-train=no` looks correct and does nothing.
- **Content Signals `use=immediate|reference|full`**, the fourth field Cloudflare added on 2026-07-01 and now serves from managed robots.txt. Cloudflare-managed blocks are detected and named.
- **Discovery link relations** in `http-headers`: `describedby` (llms.txt v2), `api-catalog` (RFC 9727), `service-desc` and `service-doc` (RFC 8631), `ai-catalog`, `c2pa-manifest`, `license`, markdown alternates, and the `X-Llms-Txt` header.
- **Content parity** in `agent-access` now fingerprints title, h1 and JSON-LD block count, catching cloaking that preserves word count.
- **Current well-known files** reported but never scored: the Web Bot Auth key directory, TDMRep, the OpenAI Apps verification token, `AGENTS.md`.
- **Fetcher transport options**: `method: 'HEAD'` and `redirect: 'manual'`, with `elapsedMs`, `redirected` and `redirectLocation` on every response.
- **Check categories** (content / discovery / access / policy / protocols) and `CheckResult.applicable` for N/A reporting, both consumed by reporters in 3.8.
- **`docs/roadmap.md`**: the research behind this release and the plan through 4.0.

### Changed

- **robots.txt is parsed once.** `checks/robots-parser.ts` replaces three separate parsers that disagreed about what closes a User-agent group. Two parsing bugs fell out: `Disallow:` with an empty value now correctly means "allow all" per RFC 9309 §2.2.2 instead of being ignored, and a bot named in two groups is merged so a later `Disallow: /` is no longer hidden by an earlier `Allow: /`.
- **`well-known-ai` tells the truth.** Re-verification found three of its five scored files have no consumer: `/.well-known/nlweb.json` **does not exist** in any NLWeb release, document or commit (NLWeb exposes `/ask` and `/mcp`); `genai.txt` has no specification; `/ai-plugin.json` described ChatGPT plugins, shut down 2024-04-09. Omitting a retired format now reads as a pass with the evidence attached. The formula stays frozen for score stability; the check loses its weight and its retired probes in 4.0.
- **Renamed check ids keep working.** `CheckMeta.aliases` plus `src/check-ids.ts` resolve former ids in `--checks` selection and in baseline diffing, so a rename does not read as one check removed at a full regression and one added at zero.

### Scoring

Unchanged. `robots-txt` deducts against the frozen eight-token core set and the token list 3.6 recognised; a site whose only MCP document is the legacy manifest is validated with the pre-3.7 rules reproduced exactly; `well-known-ai` keeps its five-file formula; every finding added inside a weighted check is informational. Broadened discovery can only raise a score, never lower one. Both freezes are removed in 4.0.

### Tests

553 total, up from 301. New suites: robots parser, structured fields, crawler catalogue, WAF classification, check-id aliasing, well-known registry, SPA-shell guard, fetcher transport. Two classes of test exist specifically to hold the no-regression promise: score-stability tests asserting a 3.6 perfect configuration still scores 100, and informational-finding tests asserting new findings leave scores untouched.

## [3.6.0] - 2026-06-06

### Added

- **Fetcher retries with exponential backoff**: transient failures (network errors, timeouts, and 408/425/429/500/502/503/504) are retried automatically. Configurable via `--retries <n>` (CLI, default 2) and `retries` (programmatic `AuditOptions`); backoff doubles from a 250ms base. Non-retryable responses (e.g. 404) short-circuit immediately. Previously a single transient timeout scored a check 0.
- **Parallel batch auditing**: `--concurrency <n>` (CLI) and `concurrency` on the new `BatchOptions` type run multiple URL audits in parallel via an order-preserving work queue. Default remains sequential (1).
- **Markdown reporter**: `--output markdown` emits a self-contained Markdown report (score, summary table, per-check findings with status emoji, baseline deltas) — ideal for CI logs and PR comments. Supported for single and batch audits. New exports: `renderMarkdown`, `renderBatchMarkdown`.
- **Crawler list refresh**: added Google's official signed AI-agent user-agent `Google-Agent` (identity `https://agent.bot.goog`) to the known-crawlers list.
- **CLI validation**: `--retries`, `--concurrency`, and `--output` now reject invalid values with a clear error.
- **17 new tests** (301 total): fetcher retry behavior (against a flaky local server), batch ordering/concurrency, and the Markdown reporter.

### Notes

- No scoring changes. Retries can raise scores on flaky endpoints that previously timed out, but the scoring model itself is unchanged.

## [3.5.0] - 2026-06-06

### Added

- **crawl-efficiency check (informational)**: measures the cost of crawling your pages across three dimensions. Compression — rewards Brotli, accepts gzip/deflate/zstd (suggesting br), warns when uncompressed (−30). Conditional GET — checks for an `ETag` or `Last-Modified` validator, then issues a follow-up request with `If-None-Match` / `If-Modified-Since` and verifies the server returns `304 Not Modified` (−30 for no validator, −15 when 304 is not honored). Response size — warns on pages over 500 KB (−5) and 2 MB (−10) of decompressed HTML. The probe advertises `Accept-Encoding: br, gzip, deflate`; the conditional request reuses the per-request header support added in 3.1.0.
- **12 new tests** (284 total).

### Scoring

- The new check carries **weight 0 in 3.x** (informational), consistent with 3.1.0–3.4.0.

## [3.4.0] - 2026-06-06

### Added

- **agent-access check (informational)**: cloaking and blocking detection. Probes the homepage with realistic user-agents for each of the 8 core AI crawlers (GPTBot, ClaudeBot, ChatGPT-User, Claude-SearchBot, Google-Extended, PerplexityBot, OAI-SearchBot, CCBot) and compares status and visible-text volume against the default-UA baseline. Flags the failure mode invisible to operators: robots.txt allows a crawler while the WAF returns 403 to its user-agent (Cloudflare's "Block AI Crawlers" toggle produces exactly this). Blocks consistent with an explicit robots.txt `Disallow` (or wildcard block) are reported as intentional and not penalized. Responses with under 50% of baseline visible text count as reduced content (half credit); content comparison is skipped for baselines under 200 chars to avoid SPA-shell noise. Hints note the verified-bots caveat: WAFs using Web Bot Auth / IP verification may pass the real crawler while rejecting this unverified probe.
- `parseUserAgents` and `BotEntry` are now exported from the robots-txt check for reuse.
- **12 new tests** (272 total).

### Scoring

- Internal score is the credit ratio across the 8 probes; the check carries **weight 0 in 3.x** (informational), consistent with 3.1.0–3.3.0.

## [3.3.0] - 2026-06-06

### Added

- **rsl check (informational)**: validates [Really Simple Licensing 1.0](https://rslstandard.org/rsl) — the machine-readable content-licensing standard endorsed by 1,500+ publishers (Reddit, Yahoo, Medium, O'Reilly) with infrastructure support from Cloudflare and Fastly. Discovery via all three spec mechanisms: robots.txt `License:` directive (absolute-URI enforcement per §4.4.1), HTTP `Link: rel="license"; type="application/rsl+xml"` header, and `<link rel="license" type="application/rsl+xml">` (plain CC-style license links without the RSL media type are ignored). Document validation: `application/rsl+xml` Content-Type (−5), `<rsl>` root + `https://rslstandard.org/rsl` namespace, required `url` attribute on every `<content>` (empty value allowed per §3.3), `<license>` presence, `permits`/`prohibits` type and token vocabulary (`usage`: all/ai-all/ai-train/ai-input/ai-index/search; `user`; `geo` as ISO 3166-1 alpha-2), and `payment` types.
- **21 new tests** (260 total) covering the three discovery mechanisms, vocabulary enforcement, namespace/root/structure validation, XML-comment stripping, and score caps.

### Scoring

- The new check carries **weight 0 in 3.x** (informational), consistent with 3.1.0/3.2.0: no impact on existing scores or baselines until v4.0.

## [3.2.0] - 2026-06-06

### Added

- **Content Signals Policy support in robots-txt** ([contentsignals.org](https://contentsignals.org), CC0): the check now parses `Content-Signal:` directives — the machine-readable `search` / `ai-input` / `ai-train` preferences that Cloudflare serves by default on its 3.8M+ managed robots.txt domains. Declared signals are reported per User-agent group; malformed segments, unknown signal names, and directives placed outside a User-agent group produce warnings. Absence of the directive produces an informational nudge. The group parser now also treats `Content-Signal` as a group-closing directive, fixing potential User-agent group leakage.
- **10 new tests** (239 total) covering declaration reporting, malformed/unknown signals, shared User-agent groups, case-insensitivity, out-of-group placement, and score neutrality.

### Scoring

- All Content Signals findings are **informational in 3.x**: they never alter the robots-txt score, so existing scores and baselines are unchanged.

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
