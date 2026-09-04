# FAQ & Troubleshooting

## Scores & results

### Why did my score change after upgrading ax-audit?

In 3.x, score changes on the same site are treated as **breaking** and only happen in major or minor releases that explicitly say so. The 3.0.0 release redistributed weights across 14 checks and added Content-Type penalties — see its CHANGELOG entry. Every check added since (3.1.0–3.6.0) ships at **weight 0** precisely so your score and baselines don't move. To track changes deliberately, use `--baseline` (see [cli.md](./cli.md)).

### Why is my score lower than my Lighthouse / SEO score?

ax-audit measures the *AI-agent* surface, not performance, accessibility, or human SEO. A fast, beautiful site can still score poorly if it has no `llms.txt`, ships an empty SPA shell to non-JS crawlers, and exposes no structured data. That gap is the reason the tool exists.

### A check shows 0 but the file exists — why?

Most "not found" hard-fails mean the request didn't return a 2xx. Common causes: the file is served with a redirect chain that breaks, a non-2xx status, or — most often — a WAF/bot-rule blocking ax-audit's request (see below). Re-run with `--verbose` to see the exact status per request.

### What's the difference between a weighted and an informational check?

Weighted checks (14) sum to 100% and determine your overall score. Informational checks (4: `content-negotiation`, `rsl`, `agent-access`, `crawl-efficiency`) run and report full findings but contribute 0 to the score in 3.x. They gain weight in v4.0. The Content Signals findings inside `robots-txt` are likewise informational.

## False positives & caveats

### `agent-access` flags crawlers as blocked, but my real crawlers work fine

This is the most important caveat in the tool. ax-audit's probe sends a user-agent *containing* the crawler token (e.g. `...GPTBot/1.0`) but it is **not** the real, verified crawler. If your WAF verifies bots cryptographically ([Web Bot Auth](./concepts.md)) or by IP range, it will correctly pass the genuine GPTBot while rejecting ax-audit's unverified probe. **Before changing any WAF rule, confirm against your WAF logs** whether real crawler traffic is actually being served. If it is, this finding is a false positive for your setup.

### Where did `well-known-ai` go?

Removed in 4.0. Three of the five files it scored turned out to have no consumer at all: `/.well-known/nlweb.json` appears in no NLWeb release, document or commit; `genai.txt` has no specification; and `/ai-plugin.json` described ChatGPT plugins, shut down in April 2024. Marking a site down for omitting a file nobody specified is worse than not checking it.

### A check says `n/a` — is that bad?

No, it is the point. A blog has no API to describe and no MCP server to advertise, so those checks report `n/a` and leave the score entirely rather than counting as failures. Everything counted against your site is something your site could have done.

If you are *planning* to build one of those surfaces and want it audited anyway, use `--profile api`, `--profile mcp`, or `--profile all`.

### My score changed after upgrading to 4.0

Expected. 4.0 redistributed the weights and made protocol checks conditional. Sites with no API or MCP surface generally rise, because they are no longer marked down for lacking things they do not have.

Your saved baseline still works, but regression gating is suspended until you re-save it: comparing across a scoring change would report regressions your site did not cause. Run `ax-audit <url> --save-baseline .ax-baseline.json` to resume gating.

### `crawl-efficiency` says no compression, but my CDN compresses

The check reads the `Content-Encoding` header on the response it received. If a proxy between ax-audit and your origin strips or fails to negotiate compression, you'll see this. Verify directly: `curl -sI -H 'Accept-Encoding: br, gzip' https://your-site.com | grep -i content-encoding`.

### `content-negotiation` fails but I don't serve Markdown

That's expected — most sites don't yet. It's informational (weight 0). Adopt it when you're ready; the [guide](https://axrush.com/guides/content-negotiation) covers Cloudflare/Vercel zero-code options.

## Running the tool

### My WAF is blocking ax-audit itself

ax-audit sends a `User-Agent` of `ax-audit/<version> (+https://github.com/axrush/ax-audit)`. If your firewall challenges unknown agents, allowlist that UA (or the IP you run from) for the duration of the audit. Note that several checks deliberately send *other* user-agents (`agent-access`) and unusual `Accept` headers (`content-negotiation`) — a WAF rejecting those is itself a finding, not a tool bug.

### How do I audit a staging site behind auth?

ax-audit has no auth support today. Options: run it from inside the network perimeter, temporarily allowlist its UA/IP, or audit a public preview deployment (the typical CI pattern — see [ci.md](./ci.md)).

### Audits are slow / flaky on cold deployments

Transient failures (timeouts, 5xx) retry automatically with backoff — raise `--retries` (default 2) for very cold preview environments and `--timeout` (default 10000ms) for slow origins. In batch mode, `--concurrency` speeds up multi-URL runs.

### Can I run only some checks?

Yes: `--checks llms-txt,robots-txt,rsl`. Note the overall score then averages *only* those checks, so a subset run isn't comparable to a full-audit score. Unknown IDs error out with the valid list.

### Is there rate limiting I should know about?

The tool itself doesn't rate-limit, but it makes several requests per audit (one per check, plus follow-ups for conditional GET, content negotiation, and the 8 `agent-access` probes). All responses are cached per run, so repeated checks of the same URL don't re-fetch. Be considerate auditing sites you don't own.

## Integration

### Does it work in CI?

Yes — exit codes gate the build (`0` = Good/Excellent, `1` = Fair/Poor). See [ci.md](./ci.md) for GitHub Actions recipes including PR comments via `--output markdown` and regression gates via `--baseline`.

### Can I consume results programmatically?

Yes — `import { audit } from 'ax-audit'` returns a typed `AuditReport`. See [api.md](./api.md).

### How do I generate the files ax-audit checks for?

Use [ax-init](https://github.com/axrush/ax-init) — it generates `llms.txt`, `robots.txt`, an Agent Card, `security.txt`, structured data, and header snippets, then you verify with `npx ax-audit`. Check its output against this tool: the standards moved in 2026, and a generator written against the older paths will produce files agents no longer look for.

## Still stuck?

Open an issue at [github.com/axrush/ax-audit/issues](https://github.com/axrush/ax-audit/issues) with the output of `npx ax-audit <url> --verbose`.
