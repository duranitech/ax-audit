# CLI Reference

```bash
ax-audit <urls...> [options]
```

One or more fully qualified URLs (scheme required). A single URL produces a full report; multiple URLs run in batch mode with a summary table.

## Options

| Flag | Default | Description |
| --- | --- | --- |
| `--output <format>` | `terminal` | Output format: `terminal`, `json`, `html`, `markdown`. Invalid values error out. |
| `--json` | — | Shorthand for `--output json`. |
| `--checks <list>` | all | Comma-separated check IDs to run (see [checks.md](./checks.md)). Unknown IDs error with the list of valid ones. |
| `--timeout <ms>` | `10000` | Per-request timeout in milliseconds. |
| `--retries <n>` | `2` | Retry attempts for transient fetch failures (network errors, timeouts, 408/425/429/5xx) with exponential backoff from 250ms. `0` disables retries. |
| `--concurrency <n>` | `1` | Batch mode only: maximum URLs audited in parallel. Output order always matches input order. |
| `--verbose` | — | Log every HTTP request, cache hit, retry, and per-check score to stderr. |
| `--only-failures` | — | Hide passing findings; checks with only passes are omitted entirely. |
| `--save-baseline <path>` | — | Save this audit as a baseline JSON file. |
| `--baseline <path>` | — | Compare against a saved baseline; shows per-check deltas (▲/▼). Single-URL mode only. |
| `--fail-on-regression <points>` | — | Exit 1 if any check regresses more than N points vs the baseline. Requires `--baseline`. |
| `-v, --version` | — | Print version. |

## Output formats

- **terminal** — colored report with score bar, per-check sections, and PASS/WARN/FAIL findings.
- **json** — the full `AuditReport` (plus `baselineDiff` when `--baseline` is used). Stable shape for CI pipelines.
- **html** — self-contained page (score gauge, dark/light mode, collapsible sections). Pipe to a file: `ax-audit <url> --output html > report.html`.
- **markdown** — summary table + per-check findings with status emoji. Built for CI logs and PR comments: `ax-audit <url> --output markdown > report.md`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Score ≥ 70 (single), or all URLs ≥ 70 (batch), and no regression beyond the `--fail-on-regression` threshold. |
| `1` | Score < 70, any batch URL < 70, invalid arguments, or regression beyond threshold. |
| `2` | Fatal error (network failure on the audit itself, unreadable baseline file). |

## Baseline workflow

```bash
# First run — record the baseline
ax-audit https://your-site.com --save-baseline .ax-baseline.json

# Subsequent runs — compare and gate
ax-audit https://your-site.com --baseline .ax-baseline.json --fail-on-regression 5
```

The baseline stores the overall score and per-check scores. Checks added after the baseline was saved appear as new (no delta); removed checks are ignored.

## Examples

```bash
# Quick audit
npx ax-audit https://your-site.com

# Only the AI-licensing surface
npx ax-audit https://your-site.com --checks robots-txt,rsl,content-negotiation

# Batch, 4 at a time, machine-readable
npx ax-audit $(cat urls.txt) --concurrency 4 --json > batch.json

# Show me only what is broken
npx ax-audit https://your-site.com --only-failures
```
