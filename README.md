<p align="center">
  <img src="ax-logo.svg" alt="ax-audit logo" width="120">
</p>

<h1 align="center">ax-audit</h1>

[![CI](https://github.com/lucioduran/ax-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/lucioduran/ax-audit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ax-audit.svg)](https://www.npmjs.com/package/ax-audit)
[![license](https://img.shields.io/npm/l/ax-audit.svg)](https://github.com/lucioduran/ax-audit/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/ax-audit.svg)](https://nodejs.org)

**Lighthouse for AI Agents.** Audit any website's AI Agent Experience (AX) readiness in seconds.

```bash
npx ax-audit https://your-site.com
```

```
  AX Audit Report
  https://lucioduran.com

  ███████████████████████████████████░░░░░  88/100  Good

  LLMs.txt (100/100)
    PASS  /llms.txt exists
    PASS  /llms.txt Content-Type OK (text/plain)
    PASS  H1 heading: "Lucio Duran — Personal Portfolio"

  Robots.txt (100/100)
    PASS  All 8 core AI crawlers explicitly configured
    PASS  Content signals declared for User-agent: * — search=yes, ai-train=no

  Content Negotiation (100/100)
    PASS  Homepage serves Markdown via content negotiation (Accept: text/markdown)
    PASS  Markdown is ~95% lighter than the HTML representation
  ...
```

## Why

AI agents and LLMs are increasingly crawling, indexing, and interacting with websites. Just like Lighthouse audits web performance and axe-core audits accessibility, **ax-audit** tells you how ready your site is for the AI agent ecosystem — discovery files, crawler policy, licensing, content negotiation, and the failure modes invisible to operators (like a WAF blocking crawlers your robots.txt allows).

## What it checks

18 checks — 14 weighted, 4 informational. Full reference: **[docs/checks.md](docs/checks.md)**.

| Check | Weight | Check | Weight |
|---|---|---|---|
| LLMs.txt | 11% | Security.txt | 6% |
| Robots.txt + [Content Signals](https://contentsignals.org) | 11% | Meta Tags (OG / Twitter / AI) | 6% |
| HTML Rendering | 9% | OpenAPI | 6% |
| Structured Data (JSON-LD) | 9% | TLS / HTTPS | 5% |
| HTTP Headers | 9% | Sitemap | 4% |
| Agent Card ([A2A](https://a2a-protocol.org)) | 7% | AI Well-Known | 3% |
| MCP | 7% | Content Negotiation (Markdown for Agents) | 0%* |
| SEO Basics | 7% | [RSL License](https://rslstandard.org) · Agent Access (cloaking) · Crawl Efficiency | 0%* |

\* Informational in 3.x: reported in full, no effect on the score. Weighted in v4.0.

Every finding links to a step-by-step **[remediation guide](https://lucioduran.com/projects/ax-audit/guides)**.

## Usage

```bash
ax-audit https://example.com                          # full audit, terminal output
ax-audit https://a.com https://b.com --concurrency 2  # batch, in parallel
ax-audit https://example.com --output markdown        # also: json, html
ax-audit https://example.com --checks llms-txt,rsl    # subset of checks
ax-audit https://example.com --only-failures          # hide passing findings
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

| Document | Contents |
|---|---|
| [docs/checks.md](docs/checks.md) | All 18 checks: what each validates, weights, scoring model |
| [docs/cli.md](docs/cli.md) | Every flag, output formats, exit codes, baseline workflow |
| [docs/api.md](docs/api.md) | `audit`, `batchAudit`, baselines, reporters, exported types |
| [docs/ci.md](docs/ci.md) | GitHub Actions recipes: gates, PR comments, scheduled drift detection |
| [docs/architecture.md](docs/architecture.md) | Pipeline design, check anatomy, how to add a check, scoring policy |
| [Remediation guides](https://lucioduran.com/projects/ax-audit/guides) | Step-by-step fixes for every finding |

The same documentation is browsable at [lucioduran.com/projects/ax-audit/docs](https://lucioduran.com/projects/ax-audit/docs), rendered from these files.

## Scoring

| Grade | Score | Exit Code |
|---|---|---|
| Excellent | 90–100 | `0` |
| Good | 70–89 | `0` |
| Fair | 50–69 | `1` |
| Poor | 0–49 | `1` |

## Tech

TypeScript strict mode · 2 runtime dependencies (`chalk`, `commander`) · Node 18+ built-in `fetch` · parallel checks via `Promise.allSettled` · per-run request cache with `Vary`-aware keys · transient-failure retries with backoff · 301 tests on `node:test` with zero test dependencies.

## Contributing

Contributions are welcome — see **[docs/architecture.md](docs/architecture.md)** for the pipeline design, check anatomy, and the steps (code, tests, docs, remediation guide) a new check requires.

## Related

- **[ax-init](https://github.com/lucioduran/ax-init)** — generate the AX files this tool audits
- **[ax-cite](https://github.com/lucioduran/ax-cite)** — embed AI-extractable structured data in your pages

## License

[Apache 2.0](LICENSE)

---

Built by [Lucio Duran](https://lucioduran.com)
