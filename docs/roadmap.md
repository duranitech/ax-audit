# Roadmap: 3.7 → 4.0 — **completed 2026-09-04**

*Research snapshot and implementation plan. All four releases shipped; this document is kept as the record of what was verified and why each decision was made.*

ax-audit has not shipped since 3.6.0 (2026-06-09). This document records what changed in the agent-web ecosystem since then, which existing checks are now wrong or stale, which new checks are worth adding, and a phased implementation plan that respects the 3.x scoring policy (no downward score changes until 4.0).

Sources were verified against primary specs, vendor docs, IANA, IETF datatracker and GitHub on 2026-09-04. Items marked **(secondary)** rely on trade press or third-party write-ups only.

---

## 1. Executive summary

**Three existing checks probe paths that are no longer (or never were) the standard:**

| Check | Today | Reality (Sept 2026) |
| --- | --- | --- |
| `agent-json` | `/.well-known/agent.json`, hints `protocolVersion: "0.2.0"`, expects `authentication` | A2A moved to **`/.well-known/agent-card.json`** in v0.3.0 (2025-07-30), IANA-registered permanent. A2A **1.0.1** (2026-05-28) replaced `url`/`protocolVersion`/`preferredTransport` with `supportedInterfaces[]`; `authentication` → `securitySchemes`. |
| `mcp` | `/.well-known/mcp.json` with `tools[]`, hints `2024-11-05` | **Never a spec convention.** Current draft (SEP-2127 + `experimental-ext-server-card`) is `<mcp-endpoint>/server-card` (`application/mcp-server-card+json`), Cloudflare/Mintlify serve `/.well-known/mcp/server-card.json`; umbrella `/.well-known/ai-catalog.json`. Server cards carry **no** `tools[]`. Protocol version is **2026-07-28**. Auth discovery via RFC 9728 is mandatory for remote servers. |
| `well-known-ai` | ai.txt, genai.txt, ai-plugin.json, agents.json, nlweb.json | `nlweb.json` **does not exist** (NLWeb uses `/ask` + `/mcp`); `genai.txt` has no spec; `ai-plugin.json` dead since 2024-04-09; Wildcard `agents.json` dormant since 2025-08-21; Spawning `ai.txt` lives at root and has ~0 adoption. The whole bundle needs replacing. |

**The crawler list has fake, retired and misclassified tokens** (`Gemini`, `GeminiBot`, `DeepSeek-AI`, `NeevaBot`, `Goose`, `Awario*`; `ChatGPT-User`/`Claude-User`/`Perplexity-User`/`MistralAI-User`/`meta-externalfetcher` are user-triggered fetchers, not training bots) and is missing the bots that now dominate traffic (`meta-webindexer`, `Amzn-SearchBot`, `Amzn-User`, `MistralAI-Index`, `MistralAI-Training`, `Google-GeminiNotebook`, `Applebot`, `ExaSearchBot`).

**Two competitors now define the reference bar:** Google Lighthouse 13.3 shipped an "Agentic Browsing" category (2026-05-07) and Cloudflare launched an "Agent Readiness" score (2026-04-17). Both check things ax-audit does not: ARD / `ai-catalog.json`, WebMCP declarative forms, agent-skills index, RFC 9727 API catalog, OAuth discovery (RFC 8414/9728), Web Bot Auth key directories, Link-header discovery. Ora's AgentReady v1.0 (with Vercel and Mintlify, Aug 2026) adds HTTP-status honesty, `429 + Retry-After`, and conditional "N/A" scoring.

**New signals worth auditing:** robots meta AI directives (`nosnippet`, `max-snippet`, `noarchive`, `nocache` are the only page-level controls Google and Bing actually honor for AI answers), IETF AIPREF `Content-Usage`, Content Signals `use=` field, TDMRep, WAF challenge vs hard block vs 402 pay-per-crawl classification, browser-agent operability heuristics, llms.txt v2 (subpath files, `rel="describedby"`, `.md` mirrors), and Markdown-for-Agents token headers.

**Recommended shape:** three minor releases (3.7, 3.8, 3.9) that fix stale probes and add ~10 informational checks without lowering any score, then **4.0** that redistributes weights, introduces conditional (N/A) checks and report categories, and retires the legacy bundle.

---

## 2. Ecosystem changes since June 2026 (verified)

### 2.1 Protocols

- **A2A 1.0.0** (2026-03-12, breaking) and **1.0.1** (2026-05-28). Card required fields: `name`, `description`, `version`, `capabilities`, `supportedInterfaces[]{url, protocolBinding ∈ JSONRPC|GRPC|HTTP+JSON, protocolVersion}`, `defaultInputModes[]`, `defaultOutputModes[]`, `skills[]`. Optional: `provider`, `documentationUrl`, `iconUrl`, `securitySchemes`, `security`/`securityRequirements`, `signatures[]`, `capabilities.extensions[]` (AP2 lives here). v0.3 cards (still the majority deployed) have top-level `url` + `protocolVersion`. No hosted 1.0 JSON schema; the v0.3.0 schema is at `raw.githubusercontent.com/a2aproject/A2A/v0.3.0/specification/json/a2a.json`. — https://github.com/a2aproject/A2A/releases, https://a2a-protocol.org/latest/specification/
- **MCP 2026-07-28** removed sessions and `initialize`; POSTs carry `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`; `GET /mcp` → 405; new `server/discover`. Discovery: SEP-2127 (open draft) → `experimental-ext-server-card`: `GET <endpoint>/server-card`, required `$schema`, `name` (reverse-DNS), `version`, `description`; optional `title`, `websiteUrl`, `repository`, `icons`, `remotes[]{type ∈ streamable-http|sse, url, supportedProtocolVersions[]}`; CORS `*` and `Cache-Control` recommended. Auth: RFC 9728 `/.well-known/oauth-protected-resource[/mcp]` → `authorization_servers[]` → RFC 8414 or OIDC discovery. — https://modelcontextprotocol.io/specification/2026-07-28/changelog, https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127, https://github.com/modelcontextprotocol/experimental-ext-server-card
- **ai-catalog.json / ARD**: Linux Foundation "Agent Card WG" `/.well-known/ai-catalog.json` (`specVersion`, `host{displayName, identifier}`, `entries[]{identifier, type, url|data, displayName}`; entry types `application/mcp-server-card+json`, `application/a2a-agent-card+json`). Agentic Resource Discovery (Google/Microsoft/HF listed) spec v0.91 (2026-08-26) at `/.well-known/ard.json`. Lighthouse's `ard-schema` audit discovers via robots.txt `Agentmap:`, `<link rel="ai-catalog">`, `Link: rel="ai-catalog"`, or the well-known path. — https://ai-catalog.io/, https://agenticresourcediscovery.org/spec/
- **WebMCP**: W3C WebML CG draft (2026-09-04). Imperative `document.modelContext.registerTool()` (`navigator.modelContext` deprecated). Declarative: `<form toolname tooldescription [toolautosubmit]>`, controls `toolparamdescription`. Chrome origin trial 149→156 (ends ~2026-11-16). Lighthouse audits `forms-missing-declarative-webmcp`. OpenAI enabled WebMCP in the ChatGPT desktop browser (2026-08-25) **(secondary)**. — https://webmachinelearning.github.io/webmcp/, https://developer.chrome.com/docs/ai/webmcp/declarative-api
- **Agent Skills discovery**: Cloudflare RFC v0.2.0 (2026-03-12) `/.well-known/agent-skills/index.json` (`$schema https://schemas.agentskills.io/discovery/0.2.0/schema.json`, `skills[]{name, type ∈ skill-md|archive, description ≤1024, url, digest "sha256:<64hex>"}`), SKILL.md at `/.well-known/agent-skills/{name}/SKILL.md`. Mintlify/Docus variant `/.well-known/skills/index.json`. SKILL.md frontmatter per agentskills.io: `name` (1–64, `[a-z0-9-]`), `description` (1–1024). — https://github.com/cloudflare/agent-skills-discovery-rfc, https://agentskills.io/specification
- **UCP** (Google/Shopify/Etsy/Walmart/Stripe): `/.well-known/ucp` (no extension, public), spec 2026-08-25: `ucp.version` (date string), `ucp.services` (reverse-DNS keys → transports rest/mcp/a2a with `schema` URL), `ucp.payment_handlers`, optional `ucp.capabilities`, `keys[]`. Shopify Agentic Storefronts GA March 2026. **ACP** (OpenAI/Stripe) has **no** discovery mechanism; AP2 is an A2A extension URI. — https://developers.google.com/merchant/ucp/guides/ucp-profile, https://developers.openai.com/commerce/specs/checkout
- **OpenAI Apps**: MCP-based; domain verification file `/.well-known/openai-apps-challenge`. — https://developers.openai.com/plugins/deploy/submission.md
- **NLWeb**: `/ask` (`query`, `site`, `mode ∈ list|summarize|generate`) and `/mcp`; repo active (2026-08-11). No manifest file.

### 2.2 Content discovery and readability

- **llms.txt v2** (llmstxt.org, modified 2026-08-10): subpath files (`/docs/llms.txt`, most specific wins); `<link rel="describedby">` / `Link: rel="describedby"` → the covering llms.txt; per-page mirrors `page.md`, `page.html.md`, `index.html.md`, `index.md`. Google states Search ignores it (ai-optimization-guide, 2026-07-10). Adoption ~10% (SE Ranking, May 2026); Ahrefs (2026-06-15): 97% of published files never fetched, but Claude Code out-fetches every AI search bot. Lighthouse's `llms-txt` audit: 404 → N/A, 5xx → fail, present → fail on missing H1 / too short / no links.
- **Markdown for Agents**: Cloudflare (docs 2026-07-13) responds to `Accept: text/markdown` with `text/markdown`, `x-markdown-tokens`, `x-original-tokens`, `content-signal` header, `Vary: accept`; strips `ETag`/`Last-Modified`/`Content-Encoding`. Vercel (2026-09-03) negotiates on Accept **and** on agent UA without Accept, keeps `.md` suffix URLs, emits YAML frontmatter (`title`, `canonical_url`, `last_updated`…), `/sitemap.md`, and requires `Vary: Accept`. Senders of `Accept: text/markdown` (Checkly, Feb 2026): Claude Code, Cursor, OpenCode. No IETF standard; only `draft-consolidated-content` (individual). — https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/, https://vercel.com/docs/agent-resources/markdown-access
- **API discovery**: RFC 9727 `/.well-known/api-catalog` (`application/linkset+json`, `Link: rel="api-catalog"` on `/`, entries with `service-desc`/`service-doc`/`service-meta`/`status`); RFC 8631 relations. `/.well-known/openapi.json` is **not** IANA-registered. OpenAPI **3.2.0** (2025-09-19) recommends `openapi.json`/`openapi.yaml`; Arazzo 1.1.0 (2026-05-17).
- **Structured data**: Google: no special markup for AI features, but structured data must match visible text; FAQ rich results ended 2026-05-07; schema.org 30.0 (2026-03-19) adds no AI types. Bing "AI Performance" report (Feb 2026).
- **IANA well-known registry** (2026-08-19): registered and agent-relevant: `agent-card.json`, `api-catalog`, `oauth-protected-resource`, `oauth-authorization-server`, `tdmrep.json`, `gpc.json`, `security.txt`. **Not** registered: `openapi*`, `mcp*`, `ucp`, `ai.txt`, `llms*`, `agents.json`, `skills`, `ai-catalog.json`. Reports should label each probe as *registered* / *vendor convention* / *draft*.

### 2.3 Usage-rights and access signals

- **IETF AIPREF** (`draft-ietf-aipref-vocab-07`, `-attach-05`, 2026-08-19; pre-WGLC, "does not reflect consensus"): tokens `train-ai`, `search`; values `y`/`n`; RFC 9651 dictionary. Carriers: HTTP `Content-Usage: train-ai=n` response header and robots.txt `Content-Usage: [/path ]train-ai=n` inside User-agent groups. Note the inversion vs Content Signals/RSL (`ai-train`). — https://datatracker.ietf.org/wg/aipref/documents/
- **Content Signals**: new optional 4th field `use=immediate|reference|full` (Cloudflare, 2026-07-01), emitted by managed robots.txt as `Content-signal: search=yes, ai-train=no, use=reference` (lower-case s, spaces after commas). Google publicly states no crawler honors `content-signal` **(secondary: Mueller, 2026-07-06)**. Cloudflare blocks Training + Agent categories by default on ad-bearing pages from **2026-09-15**.
- **RSL** still 1.0; 2026 errata add `<reporting profile= endpoint=>` (2026-06-12) and require ignoring unknown extension elements (2026-08-07). OLP: `401/402` + `WWW-Authenticate: License` + `Link rel="license"`.
- **Pay-per-crawl** (closed beta, doc 2026-07-28): `402` + `crawler-price: USD 0.01`; `200` + `crawler-charged`; `402` + `crawler-error`. Always-free paths: `/robots.txt`, `/sitemap.xml`, `/security.txt`, `/.well-known/security.txt`, `/crawlers.json`. AWS WAF x402 monetization (2026-06-15): `402` with `payment-signature`/`payment-response`. Cloudflare AI Crawl Control block = `403` **or** `402` with custom body.
- **Web Bot Auth**: WG adopted `draft-ietf-webbotauth-httpsig-protocol-00` (2026-09-01, Standards Track). Headers `Signature`, `Signature-Input`, `Signature-Agent`; `tag="web-bot-auth"`; key directory `/.well-known/http-message-signatures-directory` (`application/http-message-signatures-directory+json`, Ed25519 JWKS, response itself signed with `tag="http-message-signatures-directory"`). Origins may answer `403` + `Accept-Signature`. Signers: OpenAI (`https://chatgpt.com`), Google (`https://agent.bot.goog`, experimental), Exa, You.com, Amazon AgentCore. Verifiers: Cloudflare, AWS WAF, Vercel, Akamai.
- **WAF response signatures**: Cloudflare challenge → `cf-mitigated: challenge` (always `text/html`); Vercel → `x-vercel-mitigated: challenge` **(secondary)**; AWS WAF challenge → **`202`** + `x-amzn-waf-action: challenge`.
- **Robots meta**: Google `nosnippet` / `max-snippet:N` / `data-nosnippet` limit direct input to AI Overviews and AI Mode; `Google-Extended` governs Gemini training + grounding, **not** AI Overviews. Bing `noarchive` = excluded from Copilot grounding; `nocache` = URL/title/snippet only; new `data-snippet` attribute **(secondary)**. `noai`/`noimageai`: no operator commits to honoring. Google Search Console "Search generative AI control" (2026-08-31) is property-level and not machine-readable.
- **TDMRep** (W3C CG Final 2024-05-10, cited in the EU GPAI Code of Practice): `tdm-reservation: 0|1` / `tdm-policy` headers, `/.well-known/tdmrep.json` (`[{location, tdm-reservation, tdm-policy}]`), `<meta name="tdm-reservation">`; precedence meta > header > file.

### 2.4 Crawler landscape (Cloudflare Radar, Aug 2026)

Googlebot 27%, Meta-ExternalAgent 12.7%, ClaudeBot 11.9%, Bingbot 8.5%, GPTBot 8.3%, Applebot 6.7%, Amazonbot 6.1%, Bytespider 4.7%, Claude-SearchBot 3.6%. Cloudflare's taxonomy is Search / Agent / Training. Only `Google-Agent` ships a documented UA for agentic browsing; ChatGPT agent, Claude in Chrome, Comet and Copilot use plain Chrome UAs and identify (if at all) through Web Bot Auth.

Vendor changes: OpenAI `ChatGPT-User` "robots.txt may not apply" (Dec 2025), new `OAI-AdsBot` (Apr 2026); Anthropic three-bot split documented (Feb 2026), IPs at `claude.com/crawling/bots.json`; Google `Google-Agent` (2026-03-20), `Google-NotebookLM` → `Google-GeminiNotebook` (2026-07-17), Mariner retired (2026-05-04); Meta `meta-webindexer` (search index, ~38% of tracked AI requests on peak days **(secondary)**); Amazon `Amzn-SearchBot`, `Amzn-User`, robots-only management from 2026-06-15; Mistral `MistralAI-Index`, `MistralAI-Training`; Apple's Applebot doc now states training use (2026-06-08); Cohere runs no crawlers; Exa `ExaSearchBot` signs every request.

---

## 3. Gap analysis against the current 18 checks

| Check | Status | Required change |
| --- | --- | --- |
| `llms-txt` | Stale (spec v2) | Add `rel="describedby"` detection (HTML + `Link`), subpath discovery, `.md` mirror probe, Lighthouse-aligned rules, link-liveness sampling, size heuristics. Reword copy: value is developer-agent tooling, not Google Search. |
| `robots-txt` | Stale list + partial Content Signals | Refresh `AI_CRAWLERS` (§4.1), tiered reporting (blocking search bots ≠ blocking training bots), `use=` field, case/space tolerance, Cloudflare-managed block detection, `Content-Usage` parsing, `Agentmap:` directive, `Google-Extended` semantics in hints. |
| `agent-json` | **Wrong path** | Probe `agent-card.json` first, `agent.json` as legacy fallback with warning. Detect card generation (1.0 vs 0.3) and validate accordingly. Drop `0.2.0` hint, flag `authentication`. |
| `mcp` | **Wrong convention** | Replace with server-card discovery chain (§4.4). Keep `mcp.json` as legacy fallback, never as a recommendation. |
| `openapi` | Folk path only | Become `api-discovery`: RFC 9727 first, then conventional paths, `Link`/`<link>` `service-desc`, OpenAPI 3.0–3.2. |
| `http-headers` | Narrow Link parsing, stale agent.json reference | Broaden Link relations (`describedby`, `api-catalog`, `ai-catalog`, `service-desc`, `service-doc`, `alternate text/markdown`), fix agent-card path, recognise `X-Llms-Txt`. |
| `well-known-ai` | **Mostly fictional bundle** | Freeze scoring in 3.x, add informational findings for real files; replace in 4.0 with `ai-catalog` + `agent-skills` and drop nlweb/genai/ai-plugin. |
| `meta-tags` | `ai:*` namespace has no known consumer | Keep, but demote in 4.0 weights; add `article:published_time`/`modified_time` reading for freshness. |
| `structured-data` | Type-presence only | Add `dateModified`/`datePublished`, `author` with `sameAs`, `Organization.sameAs`; consistency of `headline`/`name`/`description` vs visible text; neutralise FAQPage/HowTo. |
| `content-negotiation` | Good, extend | Realistic Accept string, UA-only probe (Vercel mode), `x-markdown-tokens`/`x-original-tokens`, `content-signal` header, `.md` suffix, frontmatter parse, `/sitemap.md`, `Link: rel="canonical"` on markdown. |
| `agent-access` | Good, extend | Classify responses (§4.9): challenge vs hard block vs 402 paywall vs `Accept-Signature` vs RSL OLP; separate "crawlers that honor robots" from "user fetchers that don't"; compare title/H1/JSON-LD hash, not only text length. |
| `crawl-efficiency` | Good | Add token estimate of extracted text, response time, `Retry-After` on any 429 seen. |
| `rsl` | Current | Accept `<reporting>`; ignore unknown extension elements; detect OLP responses. |
| `sitemap`, `seo-basics`, `tls-https`, `security-txt`, `html-rendering` | Current | Minor: `<html lang>` vs `Content-Language` vs `inLanguage` consistency; feeds `<link rel="alternate" type=rss/atom>`; `<img>`/`<iframe>` missing dimensions (CLS proxy). |

---

## 4. Specification of changes and new checks

Each new check follows the anatomy in [architecture.md](./architecture.md): `weight: 0` in 3.x, every warn/fail with `hint` + `learnMoreUrl`, network via `ctx.fetch`, regex primitives (no parser deps).

### 4.1 `constants.ts` — crawler catalogue refresh

Replace the three buckets with four plus a legacy alias list. Matching stays case-insensitive (RFC 9309).

```ts
export const AI_CRAWLERS = {
  training: ['GPTBot', 'ClaudeBot', 'Meta-ExternalAgent', 'Google-Extended', 'Applebot-Extended',
    'Amazonbot', 'CCBot', 'Bytespider', 'TikTokSpider', 'MistralAI-Training', 'AI2Bot', 'Ai2Bot-Dolma',
    'DeepSeekBot', 'PanguBot', 'Google-CloudVertexBot', 'FacebookBot', 'Timpibot', 'Webzio-Extended',
    'omgili', 'omgilibot', 'ImagesiftBot', 'Kangaroo Bot', 'Diffbot', 'YandexAdditional', 'YandexAdditionalBot'],
  search: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'meta-webindexer', 'Amzn-SearchBot',
    'MistralAI-Index', 'Applebot', 'bingbot', 'DuckAssistBot', 'YouBot', 'Kagibot', 'PetalBot',
    'ExaSearchBot', 'PhindBot', 'Yeti'],
  userFetch: ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'MistralAI-User', 'meta-externalfetcher',
    'Amzn-User', 'Google-GeminiNotebook', 'kagi-fetcher', 'Kimi-User', 'TongyiBot'],
  agentBrowsing: ['Google-Agent', 'NovaAct', 'Manus-User', 'Devin', 'FirecrawlAgent', 'TavilyBot'],
};
export const LEGACY_AI_CRAWLERS = ['Claude-Web', 'Anthropic-AI', 'Google-NotebookLM', 'GoogleAgent-Mariner',
  'cohere-ai', 'cohere-training-data-crawler', 'ExaBot', 'NeevaBot', 'Gemini', 'GeminiBot', 'DeepSeek-AI'];
export const CORE_AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'Meta-ExternalAgent', 'Google-Extended',
  'Applebot-Extended', 'Amazonbot', 'Bytespider', 'CCBot', 'OAI-SearchBot', 'Claude-SearchBot',
  'PerplexityBot', 'ChatGPT-User'];
```

Add a `CRAWLER_META` map (`purpose`, `honorsRobots: boolean`, `docUrl`, `ipListUrl`) so findings can say *why* a block matters ("blocking OAI-SearchBot removes you from ChatGPT search answers; blocking GPTBot only affects training"). Bots documented as ignoring robots.txt (`Perplexity-User`, `Google-Agent`, `ChatGPT-User` partially) must not be scored as "missing" in robots.txt.

**Scoring impact in 3.x:** `robots-txt` deducts by missing core crawlers. Growing CORE from 8 to 12 would lower scores → keep the 8-token `CORE_AI_CRAWLERS_V3` for scoring until 4.0 and use the 12-token list for informational findings only.

### 4.2 Shared infrastructure (prerequisites)

1. **`src/checks/robots-parser.ts`** — extract `parseUserAgents`, `parseContentSignalDecls`, `parseRobotsLicenseDirectives` into one module, add `Content-Usage` (path-scoped, per group), `Agentmap:`, `Sitemap:`, Cloudflare managed-block markers. `robots-txt`, `rsl`, `agent-access`, `usage-policy`, `ai-catalog` all consume it; robots.txt is fetched once via the fetcher cache.
2. **`src/checks/waf.ts`** — `classifyResponse(res): 'ok' | 'challenge-cloudflare' | 'challenge-vercel' | 'challenge-aws' | 'blocked' | 'paywall-ppc' | 'paywall-x402' | 'needs-signature' | 'license-required'` from status + headers (`cf-mitigated`, `x-vercel-mitigated`, `x-amzn-waf-action`, `crawler-price`, `payment-signature`, `Accept-Signature`, `WWW-Authenticate: License`). Used by `agent-access`, `http-hygiene`, `content-negotiation`.
3. **`src/checks/structured-fields.ts`** — minimal RFC 9651 dictionary parser (`key=token`, `key=?1`, params) for `Content-Usage`, `Signature-Input`, `Content-Signal` header.
4. **`src/checks/frontmatter.ts`** — flat `key: value` YAML frontmatter reader for SKILL.md and `.md` mirrors (no nested YAML).
5. **`src/checks/tokens.ts`** — `estimateTokens(text)` (chars/4 heuristic, documented as approximate).
6. **Fetcher**: add `method?: 'GET' | 'HEAD'` and `redirect?: 'follow' | 'manual'` to `FetchOptions`; expose `redirectCount` and `elapsedMs` on `FetchResponse`. HEAD is needed for llms.txt link sampling; manual redirects for hop counting and `.md` mirror checks.
7. **Types**: `CheckResult.applicable?: boolean` (default `true`). Scorer excludes `applicable === false` from the denominator (4.0 behaviour; in 3.x reporters just display "N/A"). `CheckMeta.category: 'discovery' | 'content' | 'access' | 'policy' | 'protocols' | 'trust'` for grouped reports.
8. **Well-known probe helper**: `probeWellKnown(ctx, paths[], { accept })` returning first hit with `registered: boolean` label from a small `WELL_KNOWN_REGISTRY` constant.

### 4.3 `agent-card` (rename of `agent-json`, same id kept as alias in 3.x)

- Probe order: `/.well-known/agent-card.json` → `/.well-known/agent.json` (warn "legacy 0.2.x path; A2A ≥0.3 uses agent-card.json").
- Content-Type: accept `application/json` or `application/a2a+json`.
- Generation detection: `supportedInterfaces[]` → 1.0 rules; top-level `url` + `protocolVersion` → 0.3 rules; neither → fail "unrecognised card shape".
- 1.0 required: `name, description, version, capabilities, supportedInterfaces, defaultInputModes, defaultOutputModes, skills` (−15 each, as today). Each interface needs `url`, `protocolBinding`, `protocolVersion`.
- 0.3 required: `name, description, url, version, protocolVersion, capabilities, defaultInputModes, defaultOutputModes, skills`.
- `authentication` present → warn "removed in 0.2.x, use securitySchemes" (−5). `skills[]` entries need `id`, `name`, `description`, `tags`.
- Optional credit: `provider`, `documentationUrl`, `iconUrl`, `securitySchemes`, `signatures[]`, `capabilities.extensions[]` (report AP2/other extension URIs).
- Same-origin check on interface URLs (warn only).
- 3.x scoring: unchanged formulas; the new path can only raise scores.

### 4.4 `mcp-discovery` (rename of `mcp`)

Discovery chain, first hit wins, each labelled with its standing:

1. `/.well-known/ai-catalog.json` entries of type `application/mcp-server-card+json` (draft, LF).
2. `/.well-known/mcp/server-card.json`, `/.well-known/mcp/server-cards.json` (Cloudflare / Mintlify convention).
3. `/mcp/server-card` (experimental-ext-server-card recommendation) — also `<remote-url>/server-card` for any remote found in step 1–2.
4. `/.well-known/mcp.json` (legacy, ax-audit's own past recommendation) → warn.

Validation of a server card: `$schema`, `name` (reverse-DNS `^[a-z0-9.-]+/[a-z0-9._-]+$` or dotted), `version`, `description` (−15 each); `remotes[]` with `type ∈ streamable-http|sse`, absolute `url`, `supportedProtocolVersions[]` containing a known version (`2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`; warn if only pre-2025 versions) (−10); `Content-Type: application/mcp-server-card+json` or `application/json` (−5); CORS `*` (−5); `Cache-Control` present (info). Do **not** expect `tools[]` — hint that tool lists come from `tools/list` at runtime.

Optional live probe (flag `--probe-mcp`, off by default): `GET <remote>` expecting `405` (2026-07-28 signal) or `POST` `server/discover` with `MCP-Protocol-Version`; any JSON-RPC response or a protocol-version error counts as "reachable".

Auth chain (informational, feeds `auth-discovery`): if any remote exists, probe `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource<remote-path>`.

### 4.5 `api-discovery` (rename of `openapi`)

1. `HEAD /` (or reuse homepage headers) → `Link: rel="api-catalog"`; `GET /.well-known/api-catalog` with `Accept: application/linkset+json`. Validate `linkset[]`, each with `anchor` and at least one of `service-desc` / `service-doc`; resolve one `service-desc` and confirm it parses as OpenAPI/AsyncAPI/Arazzo.
2. `<link rel="service-desc">`, `<link rel="service-doc">` in HTML and `Link` header (RFC 8631).
3. Conventional paths: `/openapi.json`, `/openapi.yaml`, `/.well-known/openapi.json`, `/.well-known/openapi.yaml`, `/swagger.json`, `/api-docs`, `/v1/openapi.json`, `/arazzo.json`, `/asyncapi.json`.
4. OpenAPI validation as today plus: version `3.0`–`3.2` (note `$self` in 3.2), `operationId` coverage (warn <100%), `servers[]`, `info.description`, `securitySchemes` presence, documented rate limits (`x-ratelimit*` extensions or `429` responses) (info).

Label: RFC 9727 = registered; folk paths = convention. Scoring in 3.x unchanged for sites that only have `/.well-known/openapi.json`.

### 4.6 `ai-catalog` (new, replaces the discovery half of `well-known-ai`)

Discovery per Lighthouse: robots.txt `Agentmap:` → `<link rel="ai-catalog">`/`<link rel="ard">` → `Link: rel="ai-catalog"` → `/.well-known/ai-catalog.json` → `/.well-known/ard.json`. Validate `specVersion`, `host.identifier`, `entries[]` each with `identifier`, `type`, `displayName`, and `url` xor `data`; resolve each `url` (HEAD) and check its `Content-Type` matches `type`. Cross-reference: an `application/a2a-agent-card+json` entry should point where `agent-card` found the card; an MCP entry should match `mcp-discovery`.

### 4.7 `agent-skills` (new)

Probe `/.well-known/agent-skills/index.json` (canonical RFC) then `/.well-known/skills/index.json` (Mintlify variant), then `/skill.md`. Validate index: `skills[]` non-empty; each `name` matches `^[a-z0-9-]{1,64}$`, `description` 1–1024, `type ∈ skill-md|archive`, `url` absolute or root-relative, `digest` matches `^sha256:[0-9a-f]{64}$` (warn if missing). Fetch up to 3 SKILL.md files: `text/markdown` Content-Type, frontmatter `name` equals index name and directory, `description` present, body ≤500 lines (info). Not applicable (`applicable: false`) when nothing is found **and** the site shows no docs signals (no `/docs` link, no llms.txt).

### 4.8 `ai-directives` (new) — page-level AI controls

Parse `<meta name="robots|googlebot|bingbot">` and `X-Robots-Tag` (all values, comma-split, UA-prefixed forms). Report with vendor semantics:

| Directive | Finding |
| --- | --- |
| `noindex` on homepage | fail: invisible to every search-grounded assistant |
| `nosnippet` or `max-snippet:0` | warn: excluded as direct input to Google AI Overviews / AI Mode |
| `max-snippet:N` with N < 160 | info |
| `noarchive` | warn: excluded from Bing Copilot grounding |
| `nocache` | info: Copilot may use URL/title/snippet only |
| `noai`, `noimageai` | info: declared preference, no operator commits to honoring |
| `data-nosnippet` wrapping `<main>`, `<article>` or the H1 block | warn |
| `Content-Signal` says `ai-input=no` while page is not `nosnippet` | info (inconsistent intent) |
| Hint when robots.txt disallows `Google-Extended` | explain it does not remove the site from AI Overviews |

Score (4.0 proposal): start 100; `noindex` → 0; `nosnippet`/`noarchive` −30 each; contradictions −10. Weight 0 in 3.x.

### 4.9 `agent-access` — response classification (informational check, free to change in 3.x)

Per probe, run `classifyResponse` and map to outcomes:

| Classification | Credit | Message |
| --- | --- | --- |
| `ok` | 1 | equivalent response |
| `blocked` consistent with robots intent | 1 | intentional |
| `challenge-*` | 0.5, tagged **inconclusive** | JS challenge served; real crawler may pass via IP/Web Bot Auth verification, but fetch-only agents cannot |
| `needs-signature` (`403` + `Accept-Signature`) | 0.75 | site requires Web Bot Auth; unsigned agents excluded |
| `paywall-ppc` / `paywall-x402` | 1, info | monetised for crawlers; report price header |
| `license-required` | 1, info | RSL OLP in effect |
| `blocked` while robots allows | 0 | as today |
| reduced content | 0.5 | as today, plus title/H1/JSON-LD hash comparison |

Probe set: the 12 CORE tokens split into "honors robots.txt" (scored) and "user-triggered fetchers" (reported, not scored). Also probe the always-free paths (`/robots.txt`, `/sitemap.xml`, `/llms.txt`) with the worst-treated UA and flag if they are blocked.

### 4.10 `usage-policy` (new) — machine-readable rights signals and their consistency

Collect: robots.txt `Content-Signal` (incl. `use=`), robots.txt `Content-Usage`, HTTP `Content-Usage`, HTTP `content-signal`, RSL permits/prohibits (from `rsl`), TDMRep (`/.well-known/tdmrep.json`, `tdm-reservation`/`tdm-policy` headers, meta), `noai` meta. Validate syntax per spec (AIPREF dictionary `y/n`; warn on `yes/no` or `ai-train` under `Content-Usage`; Content Signals `yes/no` and `use ∈ immediate|reference|full`; TDMRep JSON array with `location` and `tdm-reservation ∈ 0|1`). Then compute a **consistency matrix** and flag contradictions: `ai-train=no` vs `Content-Usage: train-ai=y`; robots `Disallow` for all training bots vs `ai-train=yes`; RSL prohibits `ai-train` vs Content-Signal `ai-train=yes`; TDMRep reservation 1 with no other training signal (info). Copy must state that only robots.txt tokens are documented as honored by Google, OpenAI, Anthropic and Microsoft; the others are declarations with legal (EU AI Act) rather than technical weight.

### 4.11 `http-hygiene` (new) — status honesty and fetch ergonomics

- Soft-404 probe: `GET /ax-audit-probe-<random>` must return `404`/`410` (warn on `200`, `302→/`, or `403`).
- Redirect hops on the homepage ≤1 (`redirect: 'manual'` follow-up); `http://` → `https://` counted separately (already in `tls-https`).
- Any `429` seen during the audit must carry `Retry-After`.
- Homepage `Content-Type` includes charset; `Content-Language` consistent with `<html lang>`.
- `HEAD /` supported (not `405`).
- Error body sanity: a `404` body should not be an empty 0-byte response.

### 4.12 `webmcp` (new, static)

- Count `<form>`; count forms with both `toolname` and `tooldescription`; fail-level finding for `toolname` without `tooldescription` (mirrors Lighthouse schema validity); per tool form, coverage of `toolparamdescription` on named controls; note `toolautosubmit`.
- Inline/linked script text: `modelContext.registerTool` present → info "imperative WebMCP detected (cannot validate statically)"; `navigator.modelContext` → warn deprecated namespace.
- `<meta http-equiv="origin-trial">` presence → info.
- `applicable: false` when the page has zero forms and no script match. Weight stays 0 through 4.0 (origin trial only).

### 4.13 `agent-operability` (new, static heuristics for browser agents)

Based on web.dev "AI agent site UX" (2026-04-01), Atlas/Claude browser-tool documentation and Lighthouse's agent accessibility subset:

- `<a>` without `href` or with `href="javascript:"`; `<div>`/`<span>` with `onclick` lacking `role` and `tabindex`.
- `<button>`/`[role=button]` without accessible name (text, `aria-label`, `aria-labelledby`, `title`, `<img alt>`).
- Form controls without `<label for>`, wrapping label, `aria-label` or `aria-labelledby`; missing `autocomplete` on common fields (info).
- `<iframe>` without `title`; `<table>` without `<th>`; `<time>` without `datetime`; heading-level skips.
- `<img>`/`<iframe>`/`<video>` without dimensions (CLS proxy).
- Entry-page blockers: reCAPTCHA/hCaptcha/Turnstile markup, `<meta http-equiv="refresh">`, cookie-consent frameworks when `<main>` text < 100 words.

Score proposal: proportional to the share of interactive elements that pass; informational tag "heuristic, static HTML only".

### 4.14 Smaller extensions

- **`llms-txt`**: `describedby` links, subpath llms.txt when auditing a non-root URL, `.md` mirror of the homepage (`/index.md`, `/index.html.md`), HEAD-sample ≤20 links (report unreachable / redirected / disallowed-by-robots / `noindex` targets), duplicates, `## Optional` present, size warnings (>50 KB llms.txt, >1 MB llms-full.txt) as info, `/.well-known/llms.txt` mirror as info.
- **`content-negotiation`**: Accept `text/markdown, text/html;q=0.9, */*;q=0.1`; second probe with `User-Agent: Claude-Code/1.0` and default Accept; record `x-markdown-tokens`/`x-original-tokens` and compute savings; `content-signal` header capture; `.md` suffix probe; frontmatter `title`/`canonical_url`; `Link: rel="canonical"` on the markdown response; `/sitemap.md`.
- **`structured-data`**: `dateModified`/`datePublished` (bucketed freshness, future dates flagged), `author` → Person/Organization with `url`/`sameAs`, `Organization.sameAs` count, `headline`/`name` present in visible text, `isAccessibleForFree` vs body length sanity.
- **`http-headers`**: relations `describedby`, `api-catalog`, `ai-catalog`, `service-desc`, `service-doc`, `alternate` + `type="text/markdown"`, `c2pa-manifest`; `X-Llms-Txt`; fix agent-card path in hints; `Accept-Signature` and `Signature-Agent` presence (info).
- **`crawl-efficiency`**: `elapsedMs` TTFB proxy (warn >2 s), estimated tokens of extracted homepage text (warn >25k), `alt-svc` h3 (info).
- **`well-known-ai` (3.x only)**: keep the 5-file score frozen; rewrite hints (nlweb.json/genai.txt marked "no spec found", ai-plugin.json "retired 2024"); add informational probes for `/.well-known/http-message-signatures-directory` (validate JWKS shape if present), `/.well-known/openai-apps-challenge`, `/.well-known/tdmrep.json`, `/.well-known/gpc.json`, `/AGENTS.md`, `/ai.txt`. Retired in 4.0.
- **`commerce-discovery`** (new, conditional): applicable only when `Product`/`Offer` JSON-LD or `/cart|/checkout` links exist. `GET /.well-known/ucp` (fallback `/.well-known/ucp.json`): JSON, `ucp.version` date, `ucp.services` non-empty with resolvable `schema` URLs, `ucp.payment_handlers`, `keys[]`; public (no auth) required. Info only for ACP (`OPTIONS /checkout_sessions`).
- **`auth-discovery`** (new, conditional): applicable when `api-discovery`, `mcp-discovery` or `commerce-discovery` found something. Probe RFC 9728 `/.well-known/oauth-protected-resource`, RFC 8414 `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`; require `authorization_servers[]` or `issuer` + `authorization_endpoint` + `token_endpoint`; `code_challenge_methods_supported` includes `S256`; `registration_endpoint` or `client_id_metadata_document_supported` (info).

Deferred (needs a headless browser or an LLM, out of scope for this package): rendered-vs-static diff, imperative WebMCP enumeration, CLS/INP, task-based agent runs (Ora/Netlify AXIS style), citation share-of-voice.

---

## 5. Release plan

### 3.7.0 — "Correct the map" (no score can go down) — **shipped 2026-09-04**

1. Shared infra: `robots-parser.ts`, `waf.ts`, fetcher `method`/`redirect`/`elapsedMs`, `CheckMeta.category`, `WELL_KNOWN_REGISTRY`.
2. Crawler catalogue refresh (§4.1) with `CORE_AI_CRAWLERS_V3` frozen for scoring.
3. `agent-card` probe chain (§4.3) and `mcp-discovery` chain (§4.4) with legacy fallbacks; ids `agent-json`/`mcp` kept as aliases for `--checks` and baselines.
4. `api-discovery` probe chain (§4.5); id `openapi` aliased.
5. `agent-access` classification (§4.9).
6. `http-headers` relation broadening and hint fixes; `well-known-ai` hint rewrite + informational probes.
7. `robots-txt`: `use=` field, case/space tolerance, tiered informational findings, `Content-Usage` and `Agentmap:` parsing (informational).
8. Docs: checks.md, README table, CHANGELOG; remediation guides for every new anchor.
9. Tests: 252 new (553 total).

Delivered in eleven commits. Two things were found by dogfooding rather than by planning: `agent-access` was probing sites with a user agent containing `Google-Extended`, a robots.txt control token no request ever carries; and a speculative probe against a single-page application returned the index shell, which the check reported as a malformed document. Both are fixed and regression-tested.

### 3.8.0 — "New signals" (all weight 0) — **shipped**

`ai-directives`, `usage-policy`, `http-hygiene`, `ai-catalog`, `agent-skills`, `webmcp`, `commerce-discovery`, `auth-discovery` (with `applicable` flag displayed as N/A). `structured-fields.ts`, `frontmatter.ts`, `tokens.ts`. Reporters render categories and N/A. ~90 tests.

### 3.9.0 — "Readability depth" — **shipped**

`agent-operability`; llms.txt v2 extensions and link sampling; content-negotiation extensions; structured-data freshness/author; crawl-efficiency tokens/TTFB; `--probe-mcp` flag. ~50 tests.

### 4.0.0 — "Rescore" — **shipped**

- Weights redistributed (proposal below), `applicable: false` excluded from denominators, categories in every reporter, baseline files carry `schemaVersion: 2` with a migration path for 3.x baselines (missing checks are ignored, not regressions).
- Retire `well-known-ai`; ids `agent-json`, `mcp`, `openapi` removed (aliases dropped); `CORE_AI_CRAWLERS` = 12 tokens.
- llms.txt and `ai:*` meta demoted; access/policy and rendering promoted, following the evidence that fetch-only agents fail on JS-only content and WAF blocks far more often than on missing manifest files.
- New CLI: `--profile docs|api|commerce|default` (sets which conditional checks are forced applicable), `--category` filter, `--fail-on-category access:70`.

Proposed 4.0 weights (sum 100):

| Category | Subtotal | Checks and weights |
| --- | --- | --- |
| Content | 33 | html-rendering 10 · structured-data 7 · seo-basics 6 · content-negotiation 6 · sitemap 4 |
| Discovery | 25 | robots-txt 10 · llms-txt 7 · http-headers 5 · meta-tags 3 |
| Access | 23 | agent-access 8 · ai-directives 5 · http-hygiene 4 · crawl-efficiency 3 · tls-https 3 |
| Policy & trust | 9 | usage-policy 4 · security-txt 3 · rsl 2 |
| Protocols (conditional, N/A excluded) | 10 | agent-operability 3 · api-discovery 2 · agent-card 2 · mcp-discovery 2 · agent-skills 1 |
| Informational | 0 | ai-catalog · webmcp · commerce-discovery · auth-discovery |

---

## 5a. What actually shipped

| Release | Commits | Tests | Headline |
| --- | --- | --- | --- |
| 3.7.0 | 11 | 553 | Corrected three checks probing paths that were never the standard, and a crawler catalogue containing tokens that do not exist |
| 3.8.0 | 8 | 755 | Eight new checks, N/A reporting, category grouping |
| 3.9.0 | 4 | 828 | agent-operability, llms.txt v2, provenance and freshness, cost in tokens |
| 4.0.0 | 7 | 873 | Rescore, conditional protocol checks, profiles, per-area gates, versioned baselines |

Five things were found by running the tool rather than by planning it, and none would have surfaced any other way:

1. `agent-access` probed sites with a user agent containing `Google-Extended` — a robots.txt control token no request ever carries, so the probe tested nothing.
2. A speculative probe against a single-page application returned the index shell, and the check reported a malformed document on a site that had none.
3. `commerce-discovery` told a SaaS site to build a commerce integration because it prices its plans with an `Offer`.
4. The first draft of the 4.0 rescore produced a distribution nobody asked for, because per-check `meta.weight` values silently won over the central map.
5. `structured-data` scored a well-marked-up site at 0 because its pattern required `type` to be the first attribute on the script tag. Next.js emits `id` first, so a whole class of sites was being told to add markup they already had.

Two items from the plan were **not** built, deliberately:

- **`--probe-mcp`** live handshake. A POST to a stranger's MCP endpoint is a side effect an audit should not have by default, and behind a flag it would be exercised too rarely to stay correct.
- **Dropping the renamed check ids.** The plan called for removing `agent-json`, `mcp` and `openapi` at 4.0. They cost one line each and live in CI configs, so they stay as permanent aliases.

## 6. Cross-repo follow-ups

- **ax-init** generates `/.well-known/agent.json` and `/.well-known/mcp.json`: switch to `agent-card.json` (A2A 1.0 shape) and a server card at `/.well-known/mcp/server-card.json` plus `/.well-known/ai-catalog.json`; add `Content-Signal` with `use=`, `Link` headers (`describedby`, `api-catalog`), `.md` mirrors.
- **ax-skill** (`ax.md`) documents the old paths and the `ai:*` meta namespace as recommendations; update to the 3.7 reality and add the robots-meta AI directive semantics.
- **Remediation guides** at `lucioduran.com/projects/ax-audit/guides/<check-id>`: one page per new check id, plus new anchors listed in each check's source. This is the largest non-code deliverable; ship guides with each minor release.

---

## 7. Risks and guardrails

- **Draft standards churn** (MCP server card path, ARD vs ai-catalog, WebMCP, AIPREF tokens). Guardrail: label every finding with standing (registered / convention / draft), keep these checks at weight 0 through 4.0, and centralise paths in constants so a rename is a one-line change.
- **False positives from spoofed-UA probes**: WAFs with IP or Web Bot Auth verification reject ax-audit while admitting the real bot. Guardrail: `challenge` and `needs-signature` outcomes are reported as inconclusive with the exact header seen, never as "blocks AI".
- **Penalising features a site does not offer** (APIs, commerce, skills). Guardrail: `applicable: false` + profiles; N/A never lowers the score.
- **Over-weighting files nobody fetches** (llms.txt, manifests). Guardrail: 4.0 weights favour rendering, access and policy; copy states which consumers actually read each file.
- **Heuristic checks** (`agent-operability`, extractability): informational, thresholds in constants, documented as static approximations.
- **Baseline compatibility**: renamed ids must map old → new in `diffBaseline` so `--fail-on-regression` does not fire on a rename.

---

## 8. Evidence index (primary sources checked 2026-09-04)

A2A releases and spec · https://github.com/a2aproject/A2A/releases · https://a2a-protocol.org/latest/specification/
MCP 2026-07-28 changelog and authorization · https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery
MCP server card SEP-2127 and extension repo · https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127 · https://github.com/modelcontextprotocol/experimental-ext-server-card
ai-catalog / ARD · https://ai-catalog.io/ · https://agenticresourcediscovery.org/spec/
WebMCP · https://webmachinelearning.github.io/webmcp/ · https://developer.chrome.com/docs/ai/webmcp/declarative-api · https://developer.chrome.com/docs/lighthouse/agentic-browsing
Agent Skills · https://github.com/cloudflare/agent-skills-discovery-rfc · https://agentskills.io/specification · https://www.mintlify.com/docs/ai/skillmd
UCP / ACP · https://developers.google.com/merchant/ucp/guides/ucp-profile · https://ucp.dev/2026-08-25/specification/overview/ · https://developers.openai.com/commerce/specs/checkout
llms.txt v2 · https://llmstxt.org/ · Google AI optimization guide https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
Markdown for Agents · https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/ · https://vercel.com/docs/agent-resources/markdown-access · https://vercel.com/kb/guide/agent-readability-spec
RFC 9727 / 8631 / 9728 / 8414 · https://www.rfc-editor.org/rfc/rfc9727.html · https://www.rfc-editor.org/rfc/rfc8631.html
IANA well-known registry · https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml
AIPREF · https://datatracker.ietf.org/wg/aipref/documents/ · Web Bot Auth · https://datatracker.ietf.org/group/webbotauth/documents/ · https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
Content Signals `use=` · https://blog.cloudflare.com/content-independence-day-ai-options/ · https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
Pay-per-crawl · https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/ · AWS WAF monetization https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-how-it-works.html
WAF signatures · https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/ · https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html
RSL errata · https://rslstandard.org/rsl/errata · TDMRep · https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/
Robots meta semantics · https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag · https://developers.google.com/search/docs/appearance/ai-features · https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat
Crawler docs · https://developers.openai.com/api/docs/bots · https://support.claude.com/en/articles/8896518 · https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent · https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/ · https://developer.amazon.com/amazonbot · https://docs.mistral.ai/robots/ · https://docs.perplexity.ai/docs/resources/perplexity-crawlers · https://developers.cloudflare.com/ai-crawl-control/reference/bots/
Competitors · https://blog.cloudflare.com/agent-readiness/ · https://www.agentready.org/ · https://is-agentic.com · https://agent-ready.dev/ · https://github.com/addyosmani/agentic-seo · https://ahrefs.com/blog/llmstxt-study/
