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

1. **Content** — is there substance an agent can read, and can a browser agent act on it? (`html-rendering`, `agent-operability`, `structured-data`, `seo-basics`, `content-negotiation`)
2. **Access** — can an agent actually retrieve it? (`agent-access`, `ai-directives`, `http-hygiene`, `tls-https`, `crawl-efficiency`)
3. **Discovery** — can an agent find your machine-readable files? (`robots-txt`, `llms-txt`, `http-headers`, `sitemap`, `meta-tags`)
4. **Policy** — what usage rights do you declare, and do they agree? (`usage-policy`, `security-txt`, `rsl`)
5. **Protocols** — what can an agent call? (`api-discovery`, `agent-card`, `mcp-discovery`, `agent-skills`, `auth-discovery`)

Protocol checks are conditional: if your site has no API to describe and no MCP server, they report **n/a** and leave the score alone rather than counting as failures.

## 3. Fix in impact order

The fastest path from Fair to Good, by weight and typical effort:

| Step | Check | Weight | Typical effort |
| --- | --- | --- | --- |
| 1 | Verify server-rendered content | 11% | Free if you already render on the server; significant if you ship an SPA shell. Nothing else matters if an agent sees an empty page. |
| 2 | Confirm nothing blocks AI crawlers | 9% | 15 minutes in your WAF. Check `agent-access` first: your robots.txt may say one thing and your firewall another. |
| 3 | Configure `robots.txt` for the 12 core AI crawlers | 9% | 15 minutes; `npx ax-init` generates it |
| 4 | Name your buttons and label your inputs | 7% | Hours to days, and it is accessibility work you owed anyway |
| 5 | Check your page-level AI directives | 6% | 10 minutes. A stray `nosnippet` removes you from AI Overviews. |
| 6 | Add JSON-LD structured data | 6% | 1–2 hours |
| 7 | Create `/llms.txt` | 5% | 30 minutes — it is a Markdown file. Read the check's note on who actually fetches it first. |

Steps 1 and 2 are the ones worth doing today. They are also the two most likely to be silently broken: a hydration-only page and a firewall rule are both invisible from inside the site.

The remaining checks (`seo-basics`, `content-negotiation`, `usage-policy`, `http-hygiene`, `http-headers`, `security-txt`, `tls-https`, `sitemap`, `crawl-efficiency`, `rsl`, `meta-tags`) are mostly configuration; the remediation guides give exact snippets for Nginx, Vercel, Netlify, and Express.

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
- **"Which findings are safe to ignore?"** See the [FAQ](./faq.md) — notably the `agent-access` verified-bots caveat, and the checks resting on draft specifications, which never affect your score.

## Next steps

- [checks.md](./checks.md) — exact scoring of all 26 checks, with the weight table
- [concepts.md](./concepts.md) — the AX standards landscape explained
- [cli.md](./cli.md) — every flag · [ci.md](./ci.md) — CI recipes · [api.md](./api.md) — programmatic use
- [ax-init](https://github.com/duranitech/ax-init) — generates most of the files this tool audits
