# Checks Reference

ax-audit runs 26 checks. Fourteen are **weighted** (summing to 100% of the overall score); twelve are **informational** in 3.x — they run and report findings but carry weight 0 until v4.0, because score-affecting changes are treated as breaking (see [CHANGELOG 3.0.0](../CHANGELOG.md)).

Checks are grouped into five areas, and reports are ordered by them: **content** (is there substance an agent can read?), **discovery** (can an agent find your machine-readable files?), **access** (can it actually retrieve them?), **policy** (what usage rights do you declare?), and **protocols** (what can an agent call?).

Some checks are **conditional**. A blog has no commerce profile to publish and nothing to authorize, so those checks report **n/a** and are excluded from the score rather than counted as failures. Everything counted against a site is something the site could have done.

Every probed path is labelled by standing — **IANA-registered**, **vendor convention**, **draft**, or **legacy** — because the agent web mixes registered URIs with drafts that get renamed. A missing draft file is not the same kind of finding as a missing registered one, and reports say which is which.

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

AI-crawler configuration. Scoring runs against the frozen 3.x core set (GPTBot, ClaudeBot, ChatGPT-User, Claude-SearchBot, Google-Extended, PerplexityBot, OAI-SearchBot, CCBot); the wider September-2026 core set adds Meta-ExternalAgent, Applebot-Extended, Amazonbot and Bytespider, reported but not scored until 4.0.

Findings are tiered by what a client does with a page, because that determines the cost of blocking it. Blocking a **training** crawler is a policy choice and is reported as such. Blocking a **search** crawler removes the site from that assistant's answers. Blocking a **user-triggered fetcher** often does nothing, because most vendors document that robots.txt may not apply to them.

| Condition | Points |
| --- | --- |
| `/robots.txt` not found | **hard fail → 0** |
| No core AI crawler explicitly configured | −40 |
| Some core crawlers missing | −`round(missing/8 × 30)` |
| Core crawler(s) blocked only via `User-agent: *` + `Disallow: /` | −5 per crawler |
| Known AI crawler(s) explicitly blocked (`Disallow: /`) | −3 per crawler |
| No `Sitemap:` directive | −5 |
| Partial path restrictions on AI crawlers | warn only, 0 |
| Blocking a crawler token added in 3.7 (`meta-webindexer`, `Amzn-SearchBot`, …) | informational, 0 in 3.x |
| Rules targeting a retired or fictional token (`GeminiBot`, `Claude-Web`, `NeevaBot`, …) | informational, 0 |
| [Content Signals](https://contentsignals.org) findings, including the `use=immediate\|reference\|full` field | informational, 0 in 3.x |
| [IETF AIPREF](https://datatracker.ietf.org/wg/aipref/documents/) `Content-Usage:` findings, including vocabulary mix-ups | informational, 0 in 3.x |

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

Security headers, AI discovery `Link` headers (RFC 5988-parsed), CORS on `.well-known`. Either Agent Card path satisfies the discovery-link requirement.

| Condition | Points |
| --- | --- |
| No headers retrievable | **hard fail → 0** |
| Missing critical security header (HSTS, X-Content-Type-Options) | −10 each |
| Only 1–3 of the 7 tracked security headers present | −5 |
| `Link` header missing both llms.txt and the Agent Card | −15 |
| `Link` header missing one of the two | −5 |
| No CORS on the Agent Card | −10 |
| Additional discovery relations (`describedby`, `api-catalog`, `service-desc`, `service-doc`, `ai-catalog`, `c2pa-manifest`, `license`, markdown `alternate`) and the `X-Llms-Txt` header | informational, 0 in 3.x |

### `agent-card` — 7%

The [A2A Agent Card](https://a2a-protocol.org), probed at `/.well-known/agent-card.json` (IANA-registered since A2A v0.3.0, 2025-07-30) and then at the pre-0.3 path `/.well-known/agent.json`. *Former id: `agent-json`, still accepted in `--checks` and in saved baselines.*

Two spec generations are in the wild, and the check detects which one a card follows from its own structure rather than from a version field:

- **A2A 1.0** (2026-03-12) declares every endpoint inside `supportedInterfaces[]`. Required: `name`, `description`, `version`, `capabilities`, `supportedInterfaces`, `defaultInputModes`, `defaultOutputModes`, `skills`.
- **A2A 0.3** declares a top-level `url` and `protocolVersion`. Required: those two plus `name`, `description`, `version`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills`.

| Condition | Points |
| --- | --- |
| Not found at either path | **hard fail → 0** |
| Invalid JSON | **→ 10** |
| Served only from the pre-0.3 `agent.json` path | warn only, 0 |
| Wrong Content-Type (expected `application/json` or `application/a2a+json`) | −5 |
| Card shape matches neither generation | −30 |
| Missing required field for the detected generation | −15 per field |
| `supportedInterfaces[]` empty (1.0) | −15 |
| Interface missing `url`, `protocolBinding` or `protocolVersion` (1.0) | −10 |
| Unrecognised `protocolBinding` (not JSONRPC / GRPC / HTTP+JSON) | −5 |
| Interface or `url` on a different origin | −5 |
| `url` not an absolute URL (0.3) | −5 |
| `skills` empty | −10 |
| `skills` entries missing `id` or `description` | −5 |
| Uses `authentication`, removed from the spec in 0.2.x | −5 |
| No optional descriptive fields (`provider`, `documentationUrl`, `iconUrl`) | −5 |

### `mcp-discovery` — 7%

How an agent finds this site's [Model Context Protocol](https://modelcontextprotocol.io) server. *Former id: `mcp`.*

`/.well-known/mcp.json` was never part of the MCP specification. What emerged instead is the **server card**, which deliberately carries no `tools[]` — tool lists come from a live `tools/list` call, and a static copy drifts the day it is written. Discovery is probed in this order:

1. `/.well-known/ai-catalog.json` entries of type `application/mcp-server-card+json` *(draft)*
2. `/.well-known/mcp/server-card.json`, `/.well-known/mcp/server-cards.json` *(vendor convention: Cloudflare, Mintlify)*
3. `<endpoint>/server-card` for `/mcp`, `/api/mcp`, `/sse` *(the MCP extension's own recommendation)*
4. `/.well-known/mcp.json` *(legacy)*

An HTML response counts as absence, not a malformed card: SPA catch-alls answer every unknown path with the index shell.

**When a server card is found:**

| Condition | Points |
| --- | --- |
| Wrong Content-Type (expected `application/json` or `application/mcp-server-card+json`) | −5 |
| Invalid JSON | **→ 10** |
| Missing `$schema`, `name`, `version` or `description` | −15 each |
| `name` not in reverse-DNS form | −5 |
| No `remotes[]` | −15 |
| Remote with an unrecognised transport (not `streamable-http` / `sse`) | −5 |
| Remote missing a `url` | −10 |
| No `supportedProtocolVersions` | −10 |
| Only pre-2025-06 protocol revisions | −10 |
| Unrecognised protocol version | −5 |
| No CORS headers | −10 |
| Declares `tools[]`, which the schema omits by design | warn only, 0 |

**When only `/.well-known/mcp.json` is found**, the pre-3.7 rules are applied unchanged so the score is exactly what 3.6 produced (missing `name` −10, missing `description` −5, no `tools` −15, no tool descriptions −10 / −5, no `resources` −5, no version −5, no CORS −10, wrong Content-Type −5). The path itself is reported, not penalised.

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

### `api-discovery` — 6%

Whether an agent can find, and read, a machine-readable API description. *Former id: `openapi`.*

`/.well-known/openapi.json` is a folk convention — unregistered, and not prescribed by the OpenAPI specification, which recommends the file name `openapi.json` without a location. Discovery is probed in order of authority:

1. `/.well-known/api-catalog` *(RFC 9727, IANA-registered)* → its `service-desc` links
2. `Link: rel="service-desc"` on the homepage *(RFC 8631)*
3. `<link rel="service-desc">` in the HTML head
4. Conventional paths: `/.well-known/openapi.json`, `/openapi.json`, `/openapi.yaml`, `/.well-known/openapi.yaml`, `/api/openapi.json`, `/v1/openapi.json`, `/swagger.json`, `/api-docs`, `/asyncapi.json`, `/arazzo.json`

| Condition | Points |
| --- | --- |
| No description found by any mechanism | **hard fail → 0** |
| Invalid JSON | **→ 10** |
| Wrong Content-Type on a JSON document | −5 |
| No `openapi`/`swagger` version field | −20 |
| Swagger 2.x instead of OpenAPI 3.x | −10 |
| Missing `info.title` | −10 |
| Missing `info.description` | −5 |
| No `paths` documented | −15 |
| No `servers` | −5 |
| Found only by guessing a path (nothing links to it) | warn only, 0 |
| `operationId` coverage below 100% | informational, 0 in 3.x |
| API catalog present but empty, or entries missing `anchor` / `service-doc` | warn only, 0 |

YAML descriptions are recognised and reported, but only surface-validated: ax-audit ships no YAML parser, and the finding says so rather than pretending otherwise.

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

### `agent-access` — blocking and cloaking detection

Probes the homepage with realistic user agents for the 10 core AI crawlers that actually issue requests (`Google-Extended` and `Applebot-Extended` are robots.txt control tokens, so probing with them tests nothing) and compares each response against the default-UA baseline. **Credit-ratio formula:**

```
score = round(credit / 10 × 100)
```

Responses are classified by *how* a request was turned away, because the remedies differ completely:

| Outcome per crawler | Credit |
| --- | --- |
| Same page as a regular client | 1 |
| Refused, consistent with an explicit robots.txt `Disallow` | 1 |
| Priced access (`402` + `crawler-price`) or an RSL licence challenge | 1 |
| JavaScript challenge (`cf-mitigated: challenge`, `x-vercel-mitigated`, AWS WAF's `202`), Web Bot Auth demand, rate limit, or a refusal from a bot-verifying CDN | 0.75, **inconclusive** |
| Different page than the baseline: less text, or a changed title / h1 / JSON-LD block count | 0.5 |
| Refused by a plain origin while robots.txt permits it | 0 |
| Baseline request itself fails | **hard fail → 0** |

The probe is unsigned and comes from the auditor's own network, so an edge that verifies crawlers by IP range or Web Bot Auth signature will reject it while admitting the genuine crawler. Those outcomes are reported as inconclusive with the exact header observed, never as "blocks AI crawlers". Confirm against WAF logs before changing a rule.

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

### `ai-directives` — page-level AI controls

The controls Google and Microsoft document that they honor, read from robots meta tags and `X-Robots-Tag` (including the user-agent-scoped header form).

| Condition | Points |
| --- | --- |
| Homepage HTML unavailable | **hard fail → 0** |
| `noindex` or `none` | **hard fail → 0** — invisible to every search-grounded assistant |
| `nosnippet`, or `max-snippet:0` | −30 — excluded as a direct input to Google AI Overviews and AI Mode |
| `noarchive` | −30 — excluded from Microsoft Copilot grounding |
| `nocache` | −10 — Copilot may use only the URL, title and snippet |
| `data-nosnippet` wrapping `<main>`, `<article>` or `<body>` | −20 |
| `noimageindex` | −5 |
| `max-snippet:[n]` under 160 | warn only, 0 |
| `noai` / `noimageai` | reported, 0 — no major operator documents honoring them |
| robots.txt disallows `Google-Extended` with no snippet directive set | warn only, 0 |

That last row is the finding this check exists for. `Google-Extended` governs Gemini training and grounding in Gemini Apps and Vertex AI, **not** AI Overviews, which follow Googlebot and the snippet directives. A site that disallows it expecting to leave AI Overviews has opted out of the thing it probably did not mind.

### `usage-policy` — do your usage signals agree?

Normalises every machine-readable usage declaration onto three questions — may you train on it, ground an answer in it, index it — and reports where they disagree.

| Mechanism | Training | Grounding | Search |
| --- | --- | --- | --- |
| Content Signals (robots.txt or header) | `ai-train=yes\|no` | `ai-input=yes\|no` | `search=yes\|no` |
| IETF AIPREF (robots.txt or header) | `train-ai=y\|n` | *(no category yet)* | `search=y\|n` |
| RSL licence | `ai-train` | `ai-input` | `ai-index`, `search` |
| TDMRep (meta > header > well-known) | `tdm-reservation: 0\|1` | — | — |
| robots meta | `noai` | — | — |

| Condition | Points |
| --- | --- |
| No declaration of any kind | **→ 40** |
| Two mechanisms give opposite answers on one dimension | −25 per dimension |
| `Content-Usage` header outside the AIPREF vocabulary | warn only, 0 |
| A dimension no declaration covers | warn only, 0 |

Every report states that only robots.txt access rules are documented as honored by major AI operators. The rest are declarations whose weight is legal rather than technical.

### `http-hygiene` — status-code honesty

| Condition | Points |
| --- | --- |
| A nonexistent path returns 200 | −30 |
| A nonexistent path redirects | −20 |
| A 429 with no `Retry-After` | −20 |
| A 429 with `Retry-After` on the second request | −10 |
| `HEAD` refused (405/501) | −10 |
| Over one redirect hop to the homepage | −10 |
| No `Content-Type` header | −10 |
| No charset in the header or the document | −10 |
| `<html lang>` disagrees with `Content-Language` | −5 |
| A nonexistent path returns 403/401 | −5 |
| Empty 404 body | −5 |
| The 404 probe was challenged by bot management | warn only, 0 |

### `ai-catalog` — the index of everything callable

Discovery, in the order Lighthouse's `ard-schema` audit uses: robots.txt `Agentmap:`, `Link: rel="ai-catalog"`, `<link rel="ai-catalog">`, then `/.well-known/ai-catalog.json` and `/.well-known/ard.json`. Both specifications are drafts, so absence warns and scores nothing.

| Condition | Points |
| --- | --- |
| Catalog is not valid JSON | **→ 10** |
| An entry points at a document that cannot be fetched | −15 each |
| No entries | −20 |
| Entry missing identifier, type, or url/data | −10 |
| No `specVersion` / no `host` | −5 each |
| Entry served with a different media type than declared | −5 |

### `agent-skills` — installable procedures

Conditional: **n/a** unless the site has a developer-facing surface (documentation links, llms.txt, or an API description). Probes `/.well-known/agent-skills/index.json`, `/.well-known/skills/index.json`, then `/skill.md`.

| Condition | Points |
| --- | --- |
| Index is not valid JSON | **→ 10** |
| A sampled skill is unreachable, or its frontmatter name disagrees with the index | −10 per problem |
| Index lists no skills | −30 |
| A skill has no description | −15 |
| No entry carries a url | −15 |
| A skill name is outside `[a-z0-9-]{1,64}` | −10 |
| Malformed digest, unknown type, over-long description, or no `$schema` | −5 each |
| No skill declares a digest | −5 |
| A single `/skill.md` with no index | −20 |

### `webmcp` — forms as callable tools

Conditional: **n/a** on a page with no forms and no WebMCP code. Never asks for WebMCP — it is a Community Group draft in a Chrome origin trial.

| Condition | Points |
| --- | --- |
| `toolname` with no `tooldescription`, or the reverse | −30 |
| Parameters with no `toolparamdescription` | −15 |
| Tool name is not a usable identifier | −10 |
| Deprecated `navigator.modelContext` namespace | −10 |
| Forms present, none annotated | warn only, 0 |

### `commerce-discovery` — Universal Commerce Protocol

Conditional: **n/a** unless the page shows storefront signals. A lone `Offer` is a price statement, not a catalog, so it counts only alongside a cart link.

| Condition | Points |
| --- | --- |
| Profile requires authentication | **hard fail → 0** |
| Profile is not valid JSON | **→ 10** |
| No `ucp` object | **→ 20** |
| No services declared | −25 |
| A declared schema URL cannot be fetched | −20 |
| No version | −20 |
| No payment handlers | −15 |
| Version is not a specification date | −10 |
| No signing keys | −10 |
| No schema URL declared | −10 |
| Service name not in reverse-DNS form, unnamed handler | −5 each |

The OpenAI and Stripe Agentic Commerce Protocol defines no manifest, and AP2 advertises through an A2A card extension, so neither is probed.

### `auth-discovery` — can an agent get credentials?

Conditional: **n/a** unless the site exposes an API description, API catalog, MCP server card or commerce profile. Follows the RFC 9728 chain from `WWW-Authenticate` or `/.well-known/oauth-protected-resource` to the authorization server's RFC 8414 or OpenID metadata.

| Condition | Points |
| --- | --- |
| Metadata names no authorization server | **→ 40** |
| Authorization server publishes no discovery metadata | −30 |
| Invalid issuer URL | −25 |
| Missing `issuer`, `authorization_endpoint` or `token_endpoint` | −15 each |
| No PKCE with `S256` | −15 |
| No dynamic registration and no Client ID Metadata Documents | −10 |
| No `resource` identifier | −10 |

---

## Overall scoring model

Each check returns 0–100. The overall score is the weighted average across the checks that ran:

```
overall = round( Σ (score_i / 100 × weight_i) / Σ weight_i × 100 )
```

When every selected check has weight 0 (e.g. `--checks rsl`), the overall falls back to a plain average of check scores.

Checks reporting `applicable: false` are excluded from both the numerator and the denominator. A check whose meta exists but produced no result — because it crashed — still counts at full weight, so a broken check cannot inflate a score by shrinking the denominator.

| Grade | Score | Exit code |
| --- | --- | --- |
| Excellent | 90–100 | 0 |
| Good | 70–89 | 0 |
| Fair | 50–69 | 1 |
| Poor | 0–49 | 1 |

Weights live in `src/constants.ts` (`CHECK_WEIGHTS`); a check's own `meta.weight` takes precedence. The scoring policy for 3.x — why new checks ship at weight 0 — is documented in [architecture.md](./architecture.md).
