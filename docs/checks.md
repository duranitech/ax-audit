# Checks Reference

ax-audit runs 18 checks. Fourteen are **weighted** (summing to 100% of the overall score); four are **informational** in 3.x — they run and report findings but carry weight 0 until v4.0, because score-affecting changes are treated as breaking (see [CHANGELOG 3.0.0](../CHANGELOG.md)).

This page documents the **exact scoring** of every check: each deduction, bonus, and formula, extracted from the source. Every finding links to a step-by-step remediation guide at `lucioduran.com/projects/ax-audit/guides/<check-id>`.

**Reading the tables:** each check starts at 100 unless noted. Deductions stack additively; `buildResult` clamps the final score to [0, 100]. "Hard fail" rows short-circuit the check.

---

## Weighted checks

### `llms-txt` — 11%

`/llms.txt` presence and [llmstxt.org](https://llmstxt.org) spec compliance.

| Condition | Points |
| --- | --- |
| `/llms.txt` not found | **hard fail → 0** |
| Wrong Content-Type (expected `text/plain` or `text/markdown`) | −5 |
| First line is not an H1 (`# `) | −15 |
| No blockquote description (`> `) | −10 |
| No `##` section headings | −10 |
| No Markdown links | −10 |
| Content under 100 characters | −10 |
| `/llms-full.txt` also available | **+10** (capped at 100) |

### `robots-txt` — 11%

AI-crawler configuration. Core crawlers: GPTBot, ClaudeBot, ChatGPT-User, Claude-SearchBot, Google-Extended, PerplexityBot, OAI-SearchBot, CCBot.

| Condition | Points |
| --- | --- |
| `/robots.txt` not found | **hard fail → 0** |
| No core AI crawler explicitly configured | −40 |
| Some core crawlers missing | −`round(missing/8 × 30)` |
| Core crawler(s) blocked only via `User-agent: *` + `Disallow: /` | −5 per crawler |
| Known AI crawler(s) explicitly blocked (`Disallow: /`) | −3 per crawler |
| No `Sitemap:` directive | −5 |
| Partial path restrictions on AI crawlers | warn only, 0 |
| [Content Signals](https://contentsignals.org) findings (declared / malformed / unknown / missing) | informational, 0 in 3.x |

### `html-rendering` — 9%

Whether the static HTML contains content — most AI crawlers do not execute JavaScript. Thresholds: 500 chars / 80 words of visible text, 5% text-to-markup ratio.

| Condition | Points |
| --- | --- |
| No HTML body returned | **hard fail → 0** |
| Zero visible text in static HTML | −50 |
| Sparse content (< 500 chars or < 80 words) | −25 |
| Text-to-markup ratio < 5% | −10 |
| Empty SPA mount point (`#root`, `#__next`, `#__nuxt`, `#app`, `#svelte`, `#gatsby`) | −20 |
| 0 semantic landmarks (`<main>`, `<article>`, `<header>`, `<footer>`, `<nav>`) | −15 |
| 1–2 semantic landmarks | −10 |
| No `<h1>` | −10 |
| Multiple or empty `<h1>` | −5 |
| > 15 executable scripts without `<noscript>` fallback | −5 |
| `<img alt>` coverage < 90% | −5 |

### `structured-data` — 9%

JSON-LD on the homepage. Key entity types: Person, Organization, WebSite, WebPage, ProfilePage.

| Condition | Points |
| --- | --- |
| No JSON-LD blocks | **hard fail → 0** |
| Every JSON-LD block has invalid JSON | **→ 10** |
| Invalid JSON in a block | −10 per block |
| No schema.org `@context` | −15 |
| No key entity types found | −15 |
| Only one key entity type | −10 |
| No `@graph` array | −5 |
| No `BreadcrumbList` | −5 |

### `http-headers` — 9%

Security headers, AI discovery `Link` headers (RFC 5988-parsed), CORS on `.well-known`.

| Condition | Points |
| --- | --- |
| No headers retrievable | **hard fail → 0** |
| Missing critical security header (HSTS, X-Content-Type-Options) | −10 each |
| Only 1–3 of the 7 tracked security headers present | −5 |
| `Link` header missing both llms.txt and agent.json references | −15 |
| `Link` header missing one of the two | −5 |
| No CORS on `/.well-known/agent.json` | −10 |

### `agent-json` — 7%

`/.well-known/agent.json` [A2A Agent Card](https://a2a-protocol.org). Required fields: `name`, `description`, `url`, `skills`.

| Condition | Points |
| --- | --- |
| Not found | **hard fail → 0** |
| Invalid JSON | **→ 10** |
| Wrong Content-Type (expected `application/json`) | −5 |
| Missing required field | −15 per field |
| `url` on a different origin | −5 |
| `url` not an absolute URL | −5 |
| `skills` empty | −10 |
| `skills` entries missing `id` or `description` | −5 |
| No `protocolVersion` | −5 |
| No optional fields (`capabilities`, `authentication`, `documentationUrl`) | −5 |

### `mcp` — 7%

`/.well-known/mcp.json` [Model Context Protocol](https://modelcontextprotocol.io) server configuration.

| Condition | Points |
| --- | --- |
| Not found | **hard fail → 0** |
| Invalid JSON | **→ 10** |
| Wrong Content-Type | −5 |
| Missing `name` | −10 |
| Missing `description` | −5 |
| No `tools` array, or empty | −15 |
| No tool has a description | −10 |
| Some tools missing descriptions | −5 |
| No `resources` | −5 |
| No protocol version | −5 |
| No CORS headers | −10 |

### `seo-basics` — 7%

Head-tag fundamentals. Bounds: title 20–70 chars, description 70–160.

| Condition | Points |
| --- | --- |
| Homepage HTML unavailable | **hard fail → 0** |
| `<title>` missing or empty | −25 |
| Title too short / too long | −10 / −5 |
| Meta description missing | −20 |
| Description too short / too long | −8 / −5 |
| Description duplicates the title | −5 |
| No canonical link | −10 |
| Multiple canonicals / missing href / relative href | −5 each |
| `<html lang>` missing / invalid BCP 47 | −10 / −5 |
| No UTF-8 charset | −5 |
| Missing viewport | −5 |
| hreflang present without `x-default` | −3 |

### `security-txt` — 6%

`/.well-known/security.txt` per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116).

| Condition | Points |
| --- | --- |
| Not found | **hard fail → 0** |
| Missing `Contact` or `Expires` | −25 per field |
| `Expires` in the past | −20 |
| No optional fields (Canonical, Preferred-Languages, Policy, Encryption, Hiring) | −5 |

### `meta-tags` — 6%

AI meta tags (`ai:summary`, `ai:content_type`, `ai:author`, `ai:api`, `ai:agent_card`), discovery links, Open Graph, Twitter Card.

| Condition | Points |
| --- | --- |
| Homepage HTML unavailable | **hard fail → 0** |
| 0 AI meta tags | −18 |
| Only 1–2 AI meta tags | −12 |
| No `rel="alternate"` → llms.txt | −12 |
| No `rel="alternate"` → agent.json | −8 |
| No `rel="me"` identity links | −8 |
| No Open Graph tags at all | −12 |
| OG required incomplete (`og:title`, `og:description`, `og:url`, `og:type`) | −8 |
| OG recommended incomplete (`og:image`, `og:site_name`) | −3 |
| No Twitter Card tags at all | −6 |
| Twitter required incomplete (`twitter:card`, `twitter:title`, `twitter:description`) | −5 |
| Twitter recommended incomplete (`twitter:image`) | −2 |

### `openapi` — 6%

`/.well-known/openapi.json`.

| Condition | Points |
| --- | --- |
| Not found | **hard fail → 0** |
| Invalid JSON | **→ 10** |
| Wrong Content-Type | −5 |
| No `openapi`/`swagger` version field | −20 |
| Swagger 2.x instead of OpenAPI 3.x | −10 |
| Missing `info.title` | −10 |
| Missing `info.description` | −5 |
| No `paths` documented | −15 |
| No `servers` | −5 |

### `tls-https` — 5%

HTTPS, redirect, HSTS. Thresholds: max-age ≥ 15,768,000s (~6 months), preload ≥ 31,536,000s (1 year).

| Condition | Points |
| --- | --- |
| Invalid URL | **hard fail → 0** |
| Served over plain HTTP | −50 |
| HTTP does not redirect to HTTPS | −15 |
| Redirect unverifiable | −5 |
| No HSTS header | −15 |
| HSTS without `max-age` | −10 |
| `max-age` < 6 months | −5 |
| No `includeSubDomains` | −5 |
| `preload` present but ineligible | −5 |
| No `preload` directive | −3 |

### `sitemap` — 4%

Located via robots.txt `Sitemap:` or `/sitemap.xml`. Limits: 50,000 URLs / 50 MB / 365-day freshness.

| Condition | Points |
| --- | --- |
| No sitemap found | **hard fail → 0** |
| Response is not XML | **→ 20** |
| Over 50 MB | −10 |
| Unexpected Content-Type | −5 |
| Sitemap index with no `<sitemap>` entries | −20, stop |
| Some sampled child sitemaps unreachable | −10 |
| `<urlset>` with no `<url>` entries | −30 |
| Over 50,000 URLs declared | −10 |
| `<lastmod>` coverage < 50% | −5 |
| Newest `<lastmod>` older than 365 days | −5 |

### `well-known-ai` — 3%

Emerging AI discovery files. **Purely proportional** — no deductions:

```
score = round(present / 5 × 100)
```

over `/.well-known/ai.txt` (Spawning), `/.well-known/genai.txt`, `/ai-plugin.json`, `/agents.json`, `/.well-known/nlweb.json`. Files with invalid content produce warnings without counting as present.

---

## Informational checks (weight 0 in 3.x)

These run on every audit and report full findings, but do not affect the overall score or baselines. They gain weight in v4.0.

### `content-negotiation` — Markdown for Agents

Probes the homepage with `Accept: text/markdown` — the pattern served by Cloudflare and Vercel and requested by Claude Code, Cursor, and OpenCode (~80% token reduction vs HTML).

| Condition | Points |
| --- | --- |
| Probe request fails (network) | **hard fail → 0** |
| No Markdown served, no fallback | **→ 0** |
| No Markdown served, but `<link rel="alternate" type="text/markdown">` present | **→ 40** |
| Markdown served (correct Content-Type, 2xx) | base 100 |
| Body is empty | −30 |
| Body is a relabeled HTML document | −25 |
| `Vary` does not include `Accept` | −15 |
| Markdown not smaller than HTML | warn only, 0 |

### `rsl` — Really Simple Licensing

[RSL 1.0](https://rslstandard.org/rsl) discovery (robots.txt `License:`, `Link: rel="license"` header, `<link rel="license" type="application/rsl+xml">`) and document validation. Plain CC-style license links without the RSL media type are ignored.

| Condition | Points |
| --- | --- |
| No discovery mechanism found | **hard fail → 0** |
| License document unreachable | **→ 25** (cap) |
| Root `<rsl>` element missing | −40, stop |
| No `<content>` elements | −20, stop |
| Wrong or missing `https://rslstandard.org/rsl` namespace | −15 |
| `<license>` elements missing | −15 |
| robots.txt `License:` not an absolute URI | −10 |
| `<content>` missing required `url` attribute | −10 |
| Wrong Content-Type (expected `application/rsl+xml`) | −5 |
| `permits`/`prohibits` with invalid `type` | −5 |
| Tokens outside the RSL 1.0 vocabulary (incl. pre-1.0 draft tokens) | −5 |
| Invalid `payment` type | −5 |

### `agent-access` — Cloaking detection

Probes the homepage with realistic UAs for the 8 core AI crawlers and compares status + visible text against the default-UA baseline. **Credit-ratio formula:**

```
score = round(credit / 8 × 100)
```

| Outcome per crawler | Credit |
| --- | --- |
| Equivalent response | 1 |
| Blocked, consistent with robots.txt `Disallow` (explicit or wildcard) | 1 |
| 200 but < 50% of baseline visible text (baseline ≥ 200 chars) | 0.5 |
| Blocked while robots.txt allows (or doesn't restrict) it | 0 |
| Baseline request itself fails | **hard fail → 0** |

Caveat: WAFs using Web Bot Auth / IP verification may pass the real crawler while rejecting this unverified probe — confirm against WAF logs before changing rules.

### `crawl-efficiency`

| Condition | Points |
| --- | --- |
| Homepage request fails | **hard fail → 0** |
| Uncompressed response | −30 |
| gzip/deflate/zstd instead of Brotli | pass with suggestion, 0 |
| No `ETag` / `Last-Modified` validator | −30 |
| Validator present but conditional request not answered with `304` | −15 |
| Page > 2 MB decompressed | −10 |
| Page > 500 KB decompressed | −5 |

---

## Overall scoring model

Each check returns 0–100. The overall score is the weighted average across the checks that ran:

```
overall = round( Σ (score_i / 100 × weight_i) / Σ weight_i × 100 )
```

When every selected check has weight 0 (e.g. `--checks rsl`), the overall falls back to a plain average of check scores.

| Grade | Score | Exit code |
| --- | --- | --- |
| Excellent | 90–100 | 0 |
| Good | 70–89 | 0 |
| Fair | 50–69 | 1 |
| Poor | 0–49 | 1 |

Weights live in `src/constants.ts` (`CHECK_WEIGHTS`); a check's own `meta.weight` takes precedence. The scoring policy for 3.x — why new checks ship at weight 0 — is documented in [architecture.md](./architecture.md).
