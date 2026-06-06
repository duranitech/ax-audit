# Concepts: the AX standards landscape

"AI Agent Experience" (AX) is the sum of the conventions a site uses to be discovered, read, governed, and transacted with by autonomous AI agents and crawlers — the way "web accessibility" is the sum of conventions for assistive technology. This page maps the standards ax-audit checks against, why each exists, and how they relate. It's the conceptual companion to the mechanical detail in [checks.md](./checks.md).

## Why AX is its own discipline

Agents are not browsers. Three differences drive every check:

1. **They mostly don't run JavaScript.** GPTBot, ClaudeBot, CCBot and most crawlers fetch raw HTML. A client-rendered SPA that returns an empty `<div id="root">` is, to them, a blank page. (`html-rendering`, `content-negotiation`)
2. **They look for declared structure, not visual layout.** An agent would rather read a `/llms.txt` summary or a JSON-LD graph than infer meaning from your CSS grid. (`llms-txt`, `structured-data`, `meta-tags`, `agent-json`, `mcp`, `openapi`)
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
| **[A2A — Agent2Agent](https://a2a-protocol.org)** | An "Agent Card" at `/.well-known/agent.json` advertising your agent's identity and skills, so other agents can interoperate. | `agent-json` |
| **[MCP — Model Context Protocol](https://modelcontextprotocol.io)** | A manifest at `/.well-known/mcp.json` describing tools and resources an agent can call. The emerging standard for exposing capabilities to LLMs. | `mcp` |
| **[OpenAPI](https://www.openapis.org)** | The long-standing machine-readable API description; agents use it to call your endpoints. | `openapi` |
| **Emerging discovery files** | `ai.txt`, `genai.txt`, `ai-plugin.json`, `agents.json`, `nlweb.json` — competing/early conventions, scored as coverage bonus. | `well-known-ai` |
| **AI meta tags & discovery links** | `ai:*` meta tags and `rel="alternate"` links pointing agents to your llms.txt / agent.json. | `meta-tags` |

These answer: *once an agent arrives, can it understand what you offer and act on it?*

### 3. Access governance & licensing

This is the newest and fastest-moving family — the response to "AI scraped my content and now competes with me."

| Standard | What it is | Check |
| --- | --- | --- |
| **[Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)** | The original robots.txt — *who* may crawl *what*. ax-audit grades coverage of 48 known AI crawlers. | `robots-txt` |
| **[Content Signals](https://contentsignals.org)** | A robots.txt extension (Cloudflare, CC0) declaring *how* content may be used after access: `search`, `ai-input`, `ai-train`. Served by default on 3.8M+ Cloudflare domains. | `robots-txt` (findings) |
| **[RSL — Really Simple Licensing](https://rslstandard.org)** | A full machine-readable licensing layer (license.xml): permits/prohibits vocabularies, payment models (free, attribution, pay-per-crawl, pay-per-inference). Endorsed by 1,500+ publishers. | `rsl` |
| **Cloaking integrity** | Not a standard but a failure mode: your stated policy (robots.txt allows GPTBot) contradicting enforcement (WAF returns 403). | `agent-access` |

These answer: *have you expressed your access and usage policy in a form agents can honor — and does your infrastructure actually match it?*

The progression is one of increasing expressiveness: robots.txt says **who/where**, Content Signals adds **how it may be used**, RSL adds **under what license and price**.

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

ax-audit's weighting reflects today's leverage: discovery and readability (`llms-txt`, `robots-txt`, `html-rendering`, `structured-data`, `http-headers`) carry the most weight because they're the highest-impact, most-adopted signals. The governance and efficiency standards are informational in 3.x — real and worth adopting, but still stabilizing — and gain weight in v4.0.

## See also

- [getting-started.md](./getting-started.md) — run your first audit
- [checks.md](./checks.md) — exact scoring per standard
- The [remediation guides](https://lucioduran.com/projects/ax-audit/guides) — how to implement each one
