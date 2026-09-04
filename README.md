<p align="center">
  <img src="ax-logo.svg" alt="ax-audit logo" width="120">
</p>

<h1 align="center">ax-audit</h1>

[![CI](https://github.com/duranitech/ax-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/duranitech/ax-audit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ax-audit.svg)](https://www.npmjs.com/package/ax-audit)
[![license](https://img.shields.io/npm/l/ax-audit.svg)](https://github.com/duranitech/ax-audit/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/ax-audit.svg)](https://nodejs.org)

**Lighthouse for AI Agents.** Audit any website's AI Agent Experience (AX) readiness in seconds.

```bash
npx ax-audit https://your-site.com
```

```
  AX Audit Report
  https://example.com

  █████████████████████████████████░░░░░░░  83/100  Good

  ── Content — is there substance an agent can read?

  Structured Data (90/100)
  PASS  3 JSON-LD block(s) found
  WARN  1 structured-data value(s) do not appear in the visible text
         💡 Google's one explicit requirement for structured data and AI
            features is that it match what a reader sees.

  ── Access — can an agent actually retrieve it?

  Agent Access (100/100)
  PASS  All 10 core AI crawler user-agents receive the same page as a regular client

  AI Directives (100/100)
  PASS  Homepage is indexable
  PASS  No directive restricts how AI assistants may use this page

  ── Protocols — what can an agent call?

  MCP Discovery (n/a)
  PASS  No MCP server — MCP discovery does not apply to this site
  ...
```

## Why

AI agents crawl, cite and act on websites. Lighthouse audits performance, axe-core audits accessibility, and **ax-audit** tells you how ready your site is for agents — discovery files, crawler policy, usage rights, content negotiation, and the failures that are invisible from the inside:

- Your robots.txt allows GPTBot and your firewall returns 403 to it.
- You blocked `Google-Extended` expecting to leave AI Overviews. It does not do that.
- Your robots.txt permits AI training while your RSL licence prohibits it, so which terms apply depends on which file a crawler read.
- Your content only exists after hydration, so the crawlers that do not run JavaScript see an empty page.
- A missing page answers `200 OK`, so an agent stores the apology as the answer.

## What it checks

26 checks across five areas. Full reference: **[docs/checks.md](docs/checks.md)**.

| Area | Weight | Checks |
|---|---|---|
| **Content** — is there substance an agent can read? | 33% | HTML Rendering · Agent Operability · Structured Data · SEO Basics · Content Negotiation |
| **Access** — can an agent actually retrieve it? | 24% | Agent Access · AI Directives · HTTP Hygiene · TLS/HTTPS · Crawl Efficiency |
| **Discovery** — can an agent find your machine-readable files? | 21% | Robots.txt · LLMs.txt · HTTP Headers · Sitemap · Meta Tags |
| **Protocols** — what can an agent call? | 13% | API Discovery · Agent Card · MCP Discovery · Agent Skills · Auth Discovery |
| **Policy** — what usage rights do you declare? | 9% | Usage Policy · Security.txt · RSL License |
| Draft specifications, reported but never scored | 0% | AI Catalog · WebMCP · Commerce Discovery |

Content leads because the failure that breaks the most agents is a page with nothing in its HTML. Most crawlers do not run JavaScript, so a site whose content appears only after hydration is invisible to them no matter how many discovery files it publishes.

Protocol checks are **conditional**: a blog has no API to describe, so those report `n/a` and are excluded from the score rather than counted as failures. Use `--profile` to audit against what a site intends to build.

Every finding links to a step-by-step **[remediation guide](https://axrush.com/guides)**.

## Usage

```bash
ax-audit https://example.com                          # full audit, terminal output
ax-audit https://a.com https://b.com --concurrency 2  # batch, in parallel
ax-audit https://example.com --output markdown        # also: json, html
ax-audit https://example.com --checks llms-txt,rsl    # subset of checks
ax-audit https://example.com --only-failures          # hide passing findings
ax-audit https://example.com --category access                 # one area only
ax-audit https://example.com --profile api                     # audit as though it had an API
ax-audit https://example.com --fail-on-category access:70      # per-area CI gate
ax-audit https://example.com --baseline .ax-baseline.json --fail-on-regression 5
```

Exit codes gate CI: `0` for score ≥ 70, `1` below. Full flag reference: **[docs/cli.md](docs/cli.md)** · CI recipes (PR comments, regression gates, scheduled audits): **[docs/ci.md](docs/ci.md)**.

## Programmatic API

```typescript
import { audit, batchAudit } from 'ax-audit';

const report = await audit({ url: 'https://example.com' });
report.overallScore; // 0–100
report.results;      // per-check findings
```

Full API and types: **[docs/api.md](docs/api.md)**.

## Documentation

Start here:

| Document | Contents |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | First audit, reading the report, fixing in impact order |
| [docs/concepts.md](docs/concepts.md) | The AX standards landscape — llms.txt, A2A, MCP, RSL, Content Signals, Web Bot Auth |

Reference:

| Document | Contents |
|---|---|
| [docs/checks.md](docs/checks.md) | All 26 checks with **exact scoring** per finding, the weight table, and the conditional-check rule |
| [docs/cli.md](docs/cli.md) | Every flag, profiles, area filters, per-area CI gates, baseline workflow |
| [docs/api.md](docs/api.md) | `audit`, `batchAudit`, baselines, reporters, types, API-stability policy |
| [docs/ci.md](docs/ci.md) | GitHub Actions recipes: gates, PR comments, scheduled drift detection |
| [docs/architecture.md](docs/architecture.md) | Pipeline design, check anatomy, how to add a check, scoring policy |
| [docs/faq.md](docs/faq.md) | Troubleshooting, false positives, the `agent-access` verified-bots caveat |
| [Remediation guides](https://axrush.com/guides) | Step-by-step fixes for every finding |

The same documentation is browsable at [axrush.com/docs](https://axrush.com/docs), rendered from these files. Contributors: see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Scoring

| Grade | Score | Exit Code |
|---|---|---|
| Excellent | 90–100 | `0` |
| Good | 70–89 | `0` |
| Fair | 50–69 | `1` |
| Poor | 0–49 | `1` |

Checks that do not apply to a site report **n/a** and leave the denominator entirely, rather than scoring 0. A blog is not marked down for having no API to describe. Everything counted against a site is something the site could have done — which is what makes a low score worth acting on.

`--fail-on-category access:70` gates CI per area, because an overall score can hide an area that is entirely broken while the other four carry it.

## Tech

TypeScript strict mode · 2 runtime dependencies (`chalk`, `commander`) · Node 18+ built-in `fetch` · no HTML, XML or YAML parser dependencies · parallel checks via `Promise.allSettled` · per-run request cache with `Vary`-aware keys · transient-failure retries with backoff · 873 tests on `node:test` with zero test dependencies.

## Contributing

Contributions are welcome — see **[docs/architecture.md](docs/architecture.md)** for the pipeline design, check anatomy, and the steps (code, tests, docs, remediation guide) a new check requires.

## Related

- **[ax-init](https://github.com/duranitech/ax-init)** — generate the AX files this tool audits
- **[ax-cite](https://github.com/duranitech/ax-cite)** — embed AI-extractable structured data in your pages

## License

[Apache 2.0](LICENSE)

---

**[AX Rush](https://axrush.com)** — the agent-experience toolkit, by [Durani Technologies](https://github.com/duranitech).
