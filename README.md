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
    PASS  /llms-full.txt also available (bonus)

  Robots.txt (100/100)
    PASS  All 8 core AI crawlers explicitly configured
    PASS  32/47 known AI crawlers have explicit rules

  HTML Rendering (90/100)
    PASS  Server-rendered content detected (473 words)
    PASS  Semantic landmarks present (main, article, header, footer, nav)
    PASS  Single <h1> heading
    PASS  3/3 <img> tags have alt attributes

  TLS / HTTPS (100/100)
    PASS  Site is served over HTTPS
    PASS  HTTP requests redirect to HTTPS
    PASS  HSTS preload-eligible
  ...
```

## Why

AI agents and LLMs are increasingly crawling, indexing, and interacting with websites. Just like Lighthouse audits web performance and axe-core audits accessibility, **ax-audit** tells you how ready your site is for the AI agent ecosystem.

## What it checks

| Check | What it audits | Weight |
|---|---|---|
| **LLMs.txt** | `/llms.txt` presence, [llmstxt.org](https://llmstxt.org) spec, Content-Type | 11% |
| **Robots.txt** | AI crawler configuration (40+ known crawlers), wildcard detection, partial path restrictions, [Content Signals](https://contentsignals.org) | 11% |
| **HTML Rendering** | Server-rendered content, semantic landmarks, SPA-shell detection, alt coverage | 9% |
| **Structured Data** | JSON-LD on homepage (schema.org, `@graph`, entity types) | 9% |
| **HTTP Headers** | Security headers + AI discovery `Link` headers + CORS on `.well-known` | 9% |
| **Agent Card** | `/.well-known/agent.json` [A2A protocol](https://a2a-protocol.org) + same-origin url + skill quality | 7% |
| **MCP** | `/.well-known/mcp.json` [Model Context Protocol](https://modelcontextprotocol.io) server config | 7% |
| **SEO Basics** | `<title>`, meta description, canonical, `<html lang>`, charset, viewport, hreflang | 7% |
| **Security.txt** | `/.well-known/security.txt` [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) compliance | 6% |
| **Meta Tags** | AI meta tags (`ai:*`), `rel="alternate"`, `rel="me"`, OpenGraph + Twitter Card completeness | 6% |
| **OpenAPI** | `/.well-known/openapi.json` presence, schema validity, Content-Type | 6% |
| **TLS / HTTPS** | HTTPS, HTTP→HTTPS redirect, HSTS with `preload` + `includeSubDomains` | 5% |
| **Sitemap** | `sitemap.xml` (or `Sitemap:` from robots.txt) — XML validity, `<lastmod>` coverage, freshness, sitemap-index handling | 4% |
| **AI Well-Known** | Emerging files: `/.well-known/ai.txt`, `genai.txt`, `ai-plugin.json`, `agents.json`, `nlweb.json` | 3% |
| **Content Negotiation** | Markdown for agents — `Accept: text/markdown` negotiation, `Vary: Accept`, `rel="alternate"` fallback | 0%* |
| **RSL License** | [Really Simple Licensing](https://rslstandard.org) — robots.txt `License:` directive, `license.xml` validity, permits/payment vocabulary | 0%* |
| **Agent Access** | Cloaking detection — probes the homepage with core AI crawler user-agents and flags blocks or reduced content that contradict robots.txt | 0%* |
| **Crawl Efficiency** | Compression (`br`/`gzip`), conditional GET (`ETag`/`Last-Modified` → `304`), and response size | 0%* |

\* Checks marked **0%** are informational in 3.x: they run and report findings but do not affect the overall score. They will gain weight in v4.0.

## Install

```bash
npm install -g ax-audit
```

Or run directly without installing:

```bash
npx ax-audit https://your-site.com
```

## Usage

```bash
# Full audit with colored terminal output
ax-audit https://example.com

# Batch audit — audit multiple URLs in a single run
ax-audit https://example.com https://other-site.com https://third.dev

# HTML report — self-contained, dark mode, shareable
ax-audit https://example.com --output html > report.html

# JSON output for CI/CD pipelines
ax-audit https://example.com --json

# Run only specific checks (validates IDs, errors on unknown)
ax-audit https://example.com --checks llms-txt,robots-txt,agent-json

# Custom timeout per request (default: 10s)
ax-audit https://example.com --timeout 15000

# Retry transient failures — timeouts and 5xx (default: 2 attempts)
ax-audit https://example.com --retries 3

# Markdown report — ideal for CI / PR comments
ax-audit https://example.com --output markdown > ax-report.md

# Batch audit in parallel (default: sequential)
ax-audit https://a.com https://b.com https://c.com --concurrency 3

# Verbose mode — see every HTTP request, cache hit, and check score
ax-audit https://example.com --verbose

# Only show failures and warnings (hide passing findings)
ax-audit https://example.com --only-failures

# Save a baseline for future comparison
ax-audit https://example.com --save-baseline baseline.json

# Compare against a baseline — shows per-check score deltas
ax-audit https://example.com --baseline baseline.json

# Fail CI if any check regresses by more than 5 points
ax-audit https://example.com --baseline baseline.json --fail-on-regression 5
```

### Baseline Comparison

Track score changes over time by saving a baseline and comparing against it in subsequent runs:

```bash
# First run — save the baseline
ax-audit https://example.com --save-baseline .ax-baseline.json

# Later — compare against the baseline
ax-audit https://example.com --baseline .ax-baseline.json
```

```
  AX Audit Report
  https://example.com
  Baseline: 2026-04-15T12:00:00.000Z

  ████████████████████████████████░░░░░░░░  82/100  Good  ▲7

  LLMs.txt (100/100)  ▲20
  Robots.txt (70/100)  ▼10
  ...

  Regressions
    Robots.txt: 80 → 70 (▼10)

  Improvements
    LLMs.txt: 80 → 100 (▲20)
```

Works with all output formats (terminal, JSON, HTML). In JSON mode, a `baselineDiff` object is included with per-check deltas.

Use `--fail-on-regression <points>` in CI to fail the build if any individual check drops by more than the specified threshold.

### Batch Mode

Pass multiple URLs to audit them sequentially. Each gets its own full report, followed by a summary table:

```
  ═══ Batch Summary ═══

  URL                                     Score       Grade
  ────────────────────────────────────────────────────────────
  https://example.com                     92/100    Excellent
  https://other-site.com                  45/100         Poor

  2 URLs audited: 1 passed, 1 failed
  ████████████████████████████░░░░░░░░░░░░  69/100 avg  Fair
```

Exit code: `0` if all URLs score >= 70, `1` if any fails.

### HTML Report

Generate a self-contained HTML report you can open in any browser or share with your team:

```bash
ax-audit https://example.com --output html > report.html
```

Features: circular score gauge, dark/light mode, collapsible check sections, responsive design. Works for both single and batch audits.

## Programmatic API

Full TypeScript support with all types exported.

```typescript
import { audit, batchAudit } from 'ax-audit';
import type { AuditReport, BatchAuditReport } from 'ax-audit';

// Single URL
const report: AuditReport = await audit({ url: 'https://example.com' });
console.log(report.overallScore); // 0-100
console.log(report.grade.label);  // 'Excellent' | 'Good' | 'Fair' | 'Poor'
console.log(report.results);      // Individual check results with findings

// Batch audit (optionally in parallel)
const batch: BatchAuditReport = await batchAudit(
  ['https://example.com', 'https://other.com'],
  { timeout: 10000, concurrency: 3, retries: 2 }
);
console.log(batch.summary.averageScore); // Average across all URLs
console.log(batch.summary.passed);       // Number of URLs scoring >= 70
```

Also exports `calculateOverallScore`, `getGrade`, `checks`, `saveBaseline`, `loadBaseline`, `diffBaseline`, and `toBaselineData` for advanced usage.

## Scoring

Each check returns a score from 0 to 100. The overall score is a weighted average across all checks.

| Grade | Score | Exit Code |
|---|---|---|
| Excellent | 90 - 100 | `0` |
| Good | 70 - 89 | `0` |
| Fair | 50 - 69 | `1` |
| Poor | 0 - 49 | `1` |

Exit codes make it easy to gate CI/CD deployments on AX readiness.

## CI Integration

### GitHub Actions

```yaml
- name: AX Audit
  run: npx ax-audit https://your-site.com
  # Fails the step if score < 70
```

Save the report as an artifact:

```yaml
- name: AX Audit (JSON)
  run: npx ax-audit https://your-site.com --json > ax-report.json

- uses: actions/upload-artifact@v4
  with:
    name: ax-audit-report
    path: ax-report.json
```

Fail on regressions using a committed baseline:

```yaml
- name: AX Audit (regression gate)
  run: npx ax-audit https://your-site.com --baseline .ax-baseline.json --fail-on-regression 5
```

## Available Checks

| Check ID | Use with `--checks` |
|---|---|
| `llms-txt` | LLMs.txt spec + Content-Type |
| `robots-txt` | AI crawler configuration (40+ crawlers) + Content Signals |
| `html-rendering` | SSR / SPA-shell detection + semantic HTML |
| `structured-data` | JSON-LD structured data |
| `http-headers` | Security + AI discovery headers |
| `agent-json` | A2A Agent Card + same-origin validation |
| `mcp` | MCP server configuration |
| `seo-basics` | title / description / canonical / lang / hreflang |
| `security-txt` | RFC 9116 Security.txt |
| `meta-tags` | AI meta tags + OpenGraph + Twitter Card |
| `openapi` | OpenAPI specification |
| `tls-https` | HTTPS + HTTP→HTTPS redirect + HSTS preload |
| `sitemap` | sitemap.xml validation + freshness |
| `well-known-ai` | Emerging AI discovery files |
| `content-negotiation` | Markdown via `Accept: text/markdown` (informational) |
| `rsl` | Really Simple Licensing discovery + validation (informational) |
| `agent-access` | AI crawler UA blocking / cloaking detection (informational) |
| `crawl-efficiency` | Compression + conditional GET + response size (informational) |

## Testing

```bash
npm test
```

301 tests covering all 18 checks, the scorer, the HTTP fetcher (retries + per-header caching, against a real local server), the batch orchestrator (ordering + concurrency), the Markdown reporter, baseline comparison, HTML parsing utilities, and edge cases. Uses Node.js built-in test runner (`node:test`), no extra test dependencies.

## Tech Stack

- **TypeScript** with strict mode
- **2 runtime dependencies**: `chalk` + `commander`
- **Node.js 18+** built-in `fetch` (zero HTTP libraries)
- Parallel check execution via `Promise.allSettled`
- In-memory request caching per audit run

## Contributing

Contributions are welcome. To add a new check:

1. Create `src/checks/your-check.ts` exporting `default` (async check function) and `meta` (CheckMeta)
2. Use `buildResult(meta, score, findings, start)` from `./utils.js` to return results
3. Register it in `src/checks/index.ts`
4. Add its weight to `CHECK_WEIGHTS` in `src/constants.ts`

## License

[Apache 2.0](LICENSE)

---

Built by [Lucio Duran](https://lucioduran.com)
