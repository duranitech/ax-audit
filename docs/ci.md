# CI Integration

ax-audit's exit codes (see [cli.md](./cli.md)) make it a drop-in quality gate: `0` for Good/Excellent, `1` for Fair/Poor or regressions.

## GitHub Actions

### Basic gate

```yaml
- name: AX Audit
  run: npx ax-audit https://your-site.com
  # Fails the step if the score < 70
```

### Regression gate with a committed baseline

Commit `.ax-baseline.json` to the repo and fail the build only when a check drops:

```yaml
- name: AX Audit (regression gate)
  run: npx ax-audit https://your-site.com --baseline .ax-baseline.json --fail-on-regression 5
```

Refresh the baseline deliberately (e.g., after intentional changes):

```bash
npx ax-audit https://your-site.com --save-baseline .ax-baseline.json
git add .ax-baseline.json && git commit -m "chore: refresh AX baseline"
```

### Markdown report as a PR comment

```yaml
- name: AX Audit (markdown)
  run: npx ax-audit ${{ env.PREVIEW_URL }} --output markdown > ax-report.md
  continue-on-error: true

- name: Comment PR
  uses: marocchino/sticky-pull-request-comment@v2
  with:
    path: ax-report.md
```

This pairs naturally with Vercel/Netlify preview deployments: audit the preview URL on every PR and the reviewer sees the AX impact inline.

### Artifacts

```yaml
- name: AX Audit (JSON)
  run: npx ax-audit https://your-site.com --json > ax-report.json

- uses: actions/upload-artifact@v4
  with:
    name: ax-audit-report
    path: ax-report.json
```

## Auditing multiple environments

```yaml
- name: AX Audit (all properties)
  run: npx ax-audit https://www.your-site.com https://docs.your-site.com https://api.your-site.com --concurrency 3
  # Exit 1 if any property scores < 70
```

## Tuning for CI stability

- `--retries 3` absorbs transient 5xx/timeouts from cold preview deployments (default is 2).
- `--timeout 15000` for slow staging environments.
- `--checks ...` to gate only on the surface you are iterating on — but remember the overall score then averages only the selected checks.

## Scheduled audits

A weekly audit catches drift from infrastructure changes (CDN settings, WAF rules, header changes deployed by other teams):

```yaml
on:
  schedule:
    - cron: '0 6 * * 1'

jobs:
  ax-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx ax-audit https://your-site.com --baseline .ax-baseline.json --fail-on-regression 0
```

`--fail-on-regression 0` makes any per-check drop fail the workflow — appropriate for scheduled runs where every change is unexpected.
