# Getting Started

This walkthrough takes you from zero to a passing AX score: run your first audit, learn to read the report, and fix findings in the order that moves your score most.

## 1. Run your first audit

No install needed:

```bash
npx ax-audit https://your-site.com
```

You get a report like:

```
  AX Audit Report
  https://your-site.com

  ██████████████████████░░░░░░░░░░░░░░░░░░  56/100  Fair

  LLMs.txt (0/100)
    FAIL  /llms.txt not found
  ...
```

Three things to locate immediately:

- **The overall score and grade.** 0–100, weighted across 14 checks. Grades: Excellent (≥90), Good (≥70), Fair (≥50), Poor (<50). The CLI exits `0` at Good or better — that is the CI gate.
- **Per-check scores.** Each check is independent and scored 0–100. The weight of each check is in [checks.md](./checks.md).
- **Findings.** Every `WARN`/`FAIL` line carries a hint and a `learnMoreUrl` to a remediation guide with copy-pasteable fixes.

To see only what needs fixing:

```bash
npx ax-audit https://your-site.com --only-failures
```

## 2. Understand what you're optimizing

AI agents interact with your site differently than browsers: most don't execute JavaScript, they look for machine-readable discovery files, and they respect (or at least read) your declared crawler policy. The audit measures three layers — if you're new to the standards involved (llms.txt, A2A, MCP, RSL, Content Signals), read [concepts.md](./concepts.md) first:

1. **Can agents find and read your content?** (`html-rendering`, `robots-txt`, `sitemap`, `tls-https`, `agent-access`)
2. **Did you publish the AI-specific surface?** (`llms-txt`, `agent-json`, `mcp`, `openapi`, `well-known-ai`, `meta-tags`, `structured-data`)
3. **Is the interaction efficient and well-governed?** (`content-negotiation`, `crawl-efficiency`, `rsl`, Content Signals, `http-headers`, `security-txt`, `seo-basics`)

## 3. Fix in impact order

The fastest path from Fair to Good, by weight and typical effort:

| Step | Check | Weight | Typical effort |
| --- | --- | --- | --- |
| 1 | Create `/llms.txt` | 11% | 30 minutes — it's a Markdown file. `npx ax-init` generates it. |
| 2 | Configure `robots.txt` for the 8 core AI crawlers | 11% | 15 minutes; `npx ax-init` generates this too |
| 3 | Verify server-rendered content | 9% | Free if you SSR; significant if you ship an SPA shell |
| 4 | Add JSON-LD structured data | 9% | 1–2 hours |
| 5 | Security + discovery headers | 9% | 30 minutes of server config |
| 6 | `agent.json` + `mcp.json` | 14% combined | An hour with the spec links in the guides |

The remaining weighted checks (`seo-basics`, `security-txt`, `meta-tags`, `openapi`, `tls-https`, `sitemap`, `well-known-ai`) are mostly configuration; the remediation guides give exact snippets for Nginx, Vercel, Netlify, and Express.

Re-run after each fix — all requests are cached per run, so audits are fast and cheap.

## 4. Lock in your progress with a baseline

Once you reach a score you're happy with, freeze it:

```bash
npx ax-audit https://your-site.com --save-baseline .ax-baseline.json
git add .ax-baseline.json && git commit -m "chore: AX baseline"
```

From then on, compare every run against it:

```bash
npx ax-audit https://your-site.com --baseline .ax-baseline.json --fail-on-regression 5
```

This catches drift you didn't cause — a CDN toggle, a WAF rule, a header dropped in a refactor. Wire it into CI with the recipes in [ci.md](./ci.md).

## 5. Look at the informational checks

Four checks report findings without affecting your score yet (they will in v4.0): `content-negotiation`, `rsl`, `agent-access`, `crawl-efficiency`. Treat them as the early-warning lane — they cover the newest standards, and fixing them now means v4.0 changes nothing for you.

The one to check first is `agent-access`: it detects the failure mode you cannot see — your robots.txt allows GPTBot while your WAF returns it a 403:

```bash
npx ax-audit https://your-site.com --checks agent-access
```

## Common first-run questions

- **"My score seems harsh."** The audit measures the AI-agent surface, not site quality. A beautiful SPA with no llms.txt, no structured data, and an empty `#root` div is genuinely poor AX — that's the point of the tool.
- **"A check crashed / network error."** Transient failures retry automatically (`--retries`, default 2). For slow staging environments raise `--timeout`.
- **"Which findings are safe to ignore?"** See the [FAQ](./faq.md) — notably the `agent-access` verified-bots caveat and `well-known-ai`, which is coverage bonus rather than baseline.

## Next steps

- [checks.md](./checks.md) — exact scoring of all 18 checks
- [concepts.md](./concepts.md) — the AX standards landscape explained
- [cli.md](./cli.md) — every flag · [ci.md](./ci.md) — CI recipes · [api.md](./api.md) — programmatic use
- [ax-init](https://github.com/lucioduran/ax-init) — generates most of the files this tool audits
