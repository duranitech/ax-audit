# Checks Reference

ax-audit runs 18 checks. Fourteen are **weighted** (they sum to 100% of the overall score); four are **informational** in 3.x — they run and report findings but carry weight 0 until v4.0, because score-affecting changes are treated as breaking.

Every finding links to a step-by-step remediation guide at `lucioduran.com/projects/ax-audit/guides/<check-id>`.

## Weighted checks

| ID | Weight | What it validates |
| --- | --- | --- |
| `llms-txt` | 11% | `/llms.txt` presence and [llmstxt.org](https://llmstxt.org) spec compliance: H1 heading, blockquote description, `##` sections, Markdown links, minimum length, `text/plain`/`text/markdown` Content-Type. Bonus for `/llms-full.txt`. |
| `robots-txt` | 11% | Explicit `User-agent` rules for the 8 core AI crawlers (GPTBot, ClaudeBot, ChatGPT-User, Claude-SearchBot, Google-Extended, PerplexityBot, OAI-SearchBot, CCBot), wildcard-block detection, partial path restrictions, `Sitemap` directive, coverage of 48 known crawlers. Also parses [Content Signals](https://contentsignals.org) directives (informational findings — see below). |
| `html-rendering` | 9% | Whether the static HTML response actually contains content, since most AI crawlers do not execute JavaScript: text volume, text-to-markup ratio, empty SPA mount points (`#root`, `#__next`, …), semantic landmarks, single `<h1>`, `<noscript>` fallback, `<img alt>` coverage. |
| `structured-data` | 9% | JSON-LD on the homepage: schema.org `@context` (string, array, or `@vocab` forms), `@graph` support, entity types with nested-entity recursion. |
| `http-headers` | 9% | Security headers (HSTS, X-Content-Type-Options, CSP, …), AI discovery `Link` headers (RFC 5988-parsed), CORS on `.well-known` resources. |
| `agent-json` | 7% | `/.well-known/agent.json` [A2A Agent Card](https://a2a-protocol.org): required fields, absolute same-origin `url`, every `skills[]` entry with `id` + `description`, `application/json` Content-Type. |
| `mcp` | 7% | `/.well-known/mcp.json` [Model Context Protocol](https://modelcontextprotocol.io) server configuration and Content-Type. |
| `seo-basics` | 7% | `<title>` (20–70 chars), meta description (70–160), single absolute canonical, `<html lang>` (BCP 47), `<meta charset>`, viewport, hreflang completeness with `x-default`, title/description duplication. |
| `security-txt` | 6% | `/.well-known/security.txt` per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116): required `Contact` and `Expires`, plus optional fields. |
| `meta-tags` | 6% | AI meta tags (`ai:*`), `rel="alternate"` links to llms.txt / agent.json, `rel="me"`, Open Graph completeness (6 properties), Twitter Card completeness (4 properties). |
| `openapi` | 6% | `/.well-known/openapi.json`: OpenAPI 3.x shape (version, info, paths, servers) and Content-Type. |
| `tls-https` | 5% | HTTPS, HTTP→HTTPS redirect, HSTS `max-age` (≥ 6 months; 1 year for preload), `includeSubDomains`, `preload` eligibility per [hstspreload.org](https://hstspreload.org). |
| `sitemap` | 4% | Sitemap located via robots.txt `Sitemap:` or `/sitemap.xml`: XML validity, `<urlset>`/`<sitemapindex>` (with child sampling), `<lastmod>` coverage and freshness (>365 days → stale), 50k-URL / 50MB limits. |
| `well-known-ai` | 3% | Emerging AI discovery files, each scoring as bonus: `/.well-known/ai.txt` (Spawning), `/.well-known/genai.txt`, `/ai-plugin.json`, `/agents.json`, `/.well-known/nlweb.json`. |

## Informational checks (weight 0 in 3.x)

These run on every audit and report full findings, but do not affect the overall score. They will gain weight in v4.0.

### `content-negotiation` — Markdown for Agents

Probes the homepage with `Accept: text/markdown`, the content-negotiation pattern served by Cloudflare and Vercel and requested by Claude Code, Cursor, and OpenCode (~80% token reduction vs HTML).

- Validates the negotiated `Content-Type` is `text/markdown`.
- Flags HTML documents relabeled as Markdown (−25) and empty bodies (−30).
- Requires `Vary: Accept` so shared caches keep representations apart (−15).
- Reports the size reduction vs the HTML representation (informational).
- Partial credit (40) for a `<link rel="alternate" type="text/markdown">` fallback.

### `rsl` — Really Simple Licensing

Validates [RSL 1.0](https://rslstandard.org/rsl) machine-readable licensing.

- Discovery via robots.txt `License:` directive (absolute URI required), `Link: rel="license"; type="application/rsl+xml"` header, or `<link rel="license" type="application/rsl+xml">`. Plain CC-style license links are ignored.
- Document validation: `application/rsl+xml` Content-Type (−5), `<rsl>` root with the `https://rslstandard.org/rsl` namespace, `url` attribute on every `<content>`, `<license>` presence.
- Vocabulary enforcement: `permits`/`prohibits` types (`usage`, `user`, `geo`) and tokens (`all`, `ai-all`, `ai-train`, `ai-input`, `ai-index`, `search`; user categories; ISO 3166-1 alpha-2 geo codes), `payment` types. Pre-1.0 draft tokens (`train-ai`, `ai-use`, …) are flagged with migration hints.

### `agent-access` — Cloaking detection

Probes the homepage with realistic user-agents for each of the 8 core AI crawlers and compares status and visible-text volume against the default baseline.

- Flags crawlers allowed (or unrestricted) in robots.txt whose UA gets an error — the Cloudflare "Block AI Crawlers" failure mode.
- Blocks consistent with an explicit robots.txt `Disallow` (or wildcard block) are treated as intentional and not penalized.
- Responses with under 50% of baseline visible text count as reduced content (half credit).
- Caveat: WAFs using Web Bot Auth / IP verification may pass the real crawler while rejecting this unverified probe — confirm against WAF logs.

### `crawl-efficiency`

Measures how cheap your pages are to crawl.

- **Compression:** rewards Brotli; accepts gzip/deflate/zstd with a Brotli suggestion; uncompressed −30.
- **Conditional GET:** requires an `ETag` or `Last-Modified` validator (−30 if absent), then re-requests with `If-None-Match`/`If-Modified-Since` and verifies a `304 Not Modified` (−15 if not honored).
- **Size:** warns over 500 KB (−5) and 2 MB (−10) of decompressed HTML.

## Content Signals findings (inside `robots-txt`)

The robots-txt check parses `Content-Signal:` directives ([Content Signals Policy](https://contentsignals.org)) per User-agent group: declared signals are reported, malformed segments / unknown names / out-of-group placement produce warnings, and absence produces a nudge. All Content Signals findings are informational in 3.x and never change the robots-txt score.

## Scoring model

Each check returns 0–100. The overall score is the weighted average across the checks that ran. If every selected check has weight 0 (e.g. `--checks rsl`), the overall score falls back to a plain average.

| Grade | Score | Exit code |
| --- | --- | --- |
| Excellent | 90–100 | 0 |
| Good | 70–89 | 0 |
| Fair | 50–69 | 1 |
| Poor | 0–49 | 1 |
