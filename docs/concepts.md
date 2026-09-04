# Concepts: the AX standards landscape

"AI Agent Experience" (AX) is the sum of the conventions a site uses to be discovered, read, governed, and transacted with by autonomous AI agents and crawlers — the way "web accessibility" is the sum of conventions for assistive technology. This page maps the standards ax-audit checks against, why each exists, and how they relate. It's the conceptual companion to the mechanical detail in [checks.md](./checks.md).

## Why AX is its own discipline

Agents are not browsers. Three differences drive every check:

1. **They mostly don't run JavaScript.** GPTBot, ClaudeBot, CCBot and most crawlers fetch raw HTML. A client-rendered SPA that returns an empty `<div id="root">` is, to them, a blank page. (`html-rendering`, `content-negotiation`)
2. **They look for declared structure, not visual layout.** An agent would rather read a `/llms.txt` summary or a JSON-LD graph than infer meaning from your CSS grid. (`llms-txt`, `structured-data`, `meta-tags`, `agent-card`, `mcp-discovery`, `api-discovery`)
3. **Their access is a policy and economic question, not just a technical one.** Who may crawl, for what use, at what price, under what license — these now have machine-readable answers. (`robots-txt`, Content Signals, `rsl`, `agent-access`)

Bot traffic is projected to exceed human traffic by 2029. AX is the interface layer for that shift.

## The four families of standards

### 1. Content discovery & readability

| Standard | What it is | Check |
| --- | --- | --- |
| **[llms.txt](https://llmstxt.org)** | A Markdown file at your root summarizing your site for LLMs, with curated links. The "sitemap for AI." | `llms-txt` |
| **Server-side rendering** | Delivering real content in the HTML response, not assembling it client-side. | `html-rendering` |
| **[Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)** | Content negotiation: serve clean Markdown when a client sends `Accept: text/markdown`. ~80% fewer tokens than HTML. | `content-negotiation` |
| **schema.org / JSON-LD** | Structured data describing entities (Person, Organization, Product) in a graph agents can parse. | `structured-data` |
| **Sitemaps** | The classic XML index, still how crawlers enumerate your URLs. | `sitemap` |

These answer: *can an agent find your content and actually read it?*

### 2. Agent interaction surface

| Standard | What it is | Check |
| --- | --- | --- |
| **[A2A — Agent2Agent](https://a2a-protocol.org)** | An Agent Card at `/.well-known/agent-card.json` advertising your identity and skills, so other agents can interoperate. The path moved there in v0.3.0 and is IANA-registered; v1.0 changed the card's shape. | `agent-card` |
| **[MCP — Model Context Protocol](https://modelcontextprotocol.io)** | A **server card** identifying your MCP server and its remote endpoints. Note it carries no tool list: tools come from a live `tools/list` call, and a static copy drifts. `/.well-known/mcp.json` was never part of the specification. | `mcp-discovery` |
| **[OpenAPI](https://www.openapis.org)** and **[RFC 9727](https://www.rfc-editor.org/rfc/rfc9727.html)** | The machine-readable API description, plus the registered `/.well-known/api-catalog` that points at it. Agents use both to call your endpoints without a human reading your docs. | `api-discovery` |
| **[Agent Skills](https://agentskills.io)** | SKILL.md documents an agent installs and follows — setup steps, argument shapes, mistakes to avoid. Answers "how do I do the thing this site is for", where llms.txt answers "what is here". | `agent-skills` |
| **[RFC 9728 / RFC 8414](https://www.rfc-editor.org/rfc/rfc9728.html)** | OAuth metadata. A human hitting a 401 reads your docs; an agent cannot, so the answer has to be in the response. | `auth-discovery` |
| **[UCP](https://developers.google.com/merchant/ucp/guides/ucp-profile)** | The Universal Commerce Protocol profile at `/.well-known/ucp` — the one agentic-commerce specification with published site-side discovery. | `commerce-discovery` |
| **[WebMCP](https://webmachinelearning.github.io/webmcp/)** | Declaring a form as a callable tool, so an agent invokes it rather than driving it pixel by pixel. A Community Group draft in a Chrome origin trial. | `webmcp` |
| **AI catalogs** | `ai-catalog.json` and `ard.json`, two competing drafts for one index listing everything above, so a client stops probing four conventions. | `ai-catalog` |
| **AI meta tags & discovery links** | `ai:*` meta tags and the `rel` relations — `alternate`, `describedby`, `service-desc`, `api-catalog` — that point agents at your files instead of making them guess paths. | `meta-tags`, `http-headers` |

These answer: *once an agent arrives, can it understand what you offer and act on it?*

### 3. Access governance & licensing

This is the newest and fastest-moving family — the response to "AI scraped my content and now competes with me."

| Standard | What it is | Check |
| --- | --- | --- |
| **[Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)** | The original robots.txt — *who* may crawl *what*. ax-audit knows 57 AI clients, grouped by what they do with a page, because blocking a search crawler costs citations while blocking a training crawler is a policy choice. | `robots-txt` |
| **[Content Signals](https://contentsignals.org)** | A robots.txt extension (Cloudflare, CC0) declaring *how* content may be used after access: `search`, `ai-input`, `ai-train`, plus the `use` field added in 2026. Served by default on millions of Cloudflare domains. | `robots-txt`, `usage-policy` |
| **[IETF AIPREF](https://datatracker.ietf.org/wg/aipref/documents/)** | The standards-track answer to the same question: a `Content-Usage` directive or header over `train-ai` and `search`. Still pre-last-call. Note the token inversion against Content Signals — `train-ai` here, `ai-train` there. | `robots-txt`, `usage-policy` |
| **[RSL — Really Simple Licensing](https://rslstandard.org)** | A full machine-readable licensing layer: permits/prohibits vocabularies, payment models, and an Open Licensing Protocol for negotiating access. | `rsl`, `usage-policy` |
| **[TDMRep](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/)** | A text-and-data-mining reservation, named in the EU GPAI Code of Practice. Its weight is legal rather than technical. | `usage-policy` |
| **Page-level AI directives** | `nosnippet` and `max-snippet` for Google AI Overviews, `noarchive` and `nocache` for Copilot grounding. Unlike everything above, the vendors document that they honor these. | `ai-directives` |
| **Cloaking and blocking integrity** | Not a standard but a failure mode: robots.txt allows GPTBot and the firewall returns 403. | `agent-access` |
| **Signal consistency** | Also not a standard: whether your Content Signals, AIPREF, RSL and TDMRep declarations agree with each other. Five documents maintained by hand do not stay in sync, and the terms that apply then depend on which file a crawler read. | `usage-policy` |

These answer: *have you expressed your access and usage policy in a form agents can honor — and does your infrastructure actually match it?*

The progression is one of increasing expressiveness: robots.txt says **who and where**, Content Signals and AIPREF add **how it may be used**, RSL adds **under what licence and price**.

One caveat worth stating plainly: only robots.txt access rules are documented as honored by Google, OpenAI, Anthropic and Microsoft. Content Signals, AIPREF, RSL and TDMRep are declarations. Their weight is legal rather than technical, and ax-audit says so on every run rather than implying a crawler will obey.

### 4. Transport, efficiency & hygiene

| Standard | What it is | Check |
| --- | --- | --- |
| **TLS / HSTS** | HTTPS everywhere; many agents refuse plaintext origins. | `tls-https` |
| **HTTP security & discovery headers** | Security headers plus `Link` headers advertising your AI files. | `http-headers` |
| **Compression & conditional GET** | Brotli/gzip and `ETag`/`304` — crawl cost matters when bots dominate traffic. | `crawl-efficiency` |
| **[RFC 9116 security.txt](https://www.rfc-editor.org/rfc/rfc9116)** | A machine-readable security contact. | `security-txt` |
| **SEO basics** | Title, description, canonical, lang, hreflang — agents use the same head-tag fundamentals search engines do. | `seo-basics` |

These answer: *is the connection trustworthy, cheap, and well-formed?*

## On the horizon (not yet scored)

Two standards are maturing and worth watching:

- **[Web Bot Auth](https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/)** — cryptographic crawler verification via HTTP Message Signatures (RFC 9421). Bots sign requests with a key published at `/.well-known/http-message-signatures-directory`; sites verify identity instead of guessing from user-agent strings. Already implemented by Cloudflare and Google (`agent.bot.goog`). It directly affects the `agent-access` check: a WAF using Web Bot Auth may pass a real, signed crawler while rejecting ax-audit's unsigned probe — which is why that check's findings carry an explicit verified-bots caveat.
- **Pay-per-crawl / HTTP 402** — Cloudflare and the RSL payment vocabulary point toward metered, paid agent access. RSL already encodes the terms; enforcement protocols (Open License Protocol, x402) are emerging.

## How the families compose

A fully AX-ready site tells a coherent story across all four:

> "Here's my content in a form you can read **(family 1)**, here's the interface to interact with me **(family 2)**, here's exactly who may use it and how, for what license **(family 3)**, over a fast and trustworthy connection **(family 4)**."

ax-audit's weighting follows what actually stops an agent. **Content** carries the most weight, led by `html-rendering`, because a page whose content only exists after hydration is invisible to the crawlers that do not run JavaScript, no matter how many discovery files it publishes. **Access** is next, because a firewall rule or a `nosnippet` directive silently undoes everything else.

`llms-txt` sits at 5 rather than the 11 it carried in 3.x. Adoption studies find most published files are never fetched by an AI search crawler, and Google has stated that Search ignores them; the vendors that do read them are coding agents like Claude Code and Cursor. It is worth publishing, as developer tooling, and it is not worth twice what having content is worth.

Checks resting on draft specifications — `ai-catalog`, `webmcp`, `commerce-discovery` — are reported but never scored. A specification that may be renamed next quarter should not move your number.

## See also

- [getting-started.md](./getting-started.md) — run your first audit
- [checks.md](./checks.md) — exact scoring per standard
- The [remediation guides](https://lucioduran.com/projects/ax-audit/guides) — how to implement each one
