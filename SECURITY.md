# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately — do **not** open a public issue for them.

- Use [GitHub Security Advisories](https://github.com/axrush/ax-audit/security/advisories/new) to report privately, or
- email **info@axrush.com** with the details.

Please include:

- a description of the vulnerability and its impact,
- steps to reproduce (a minimal case is ideal),
- the ax-audit version (`npx ax-audit --version`) and Node.js version.

You can expect an acknowledgement within a few days. Once a fix is available, a patched release will be published to npm and the advisory disclosed.

## Scope

ax-audit is a CLI/library that makes outbound HTTP requests to URLs you provide and parses the responses. The most relevant security considerations:

- **Untrusted input from audited sites.** Responses (HTML, robots.txt, JSON manifests, XML sitemaps, RSL documents) are untrusted. Checks parse them with bounded regex primitives and `JSON.parse`, never `eval` or a DOM. Reports of parser denial-of-service (catastrophic backtracking, unbounded memory on a crafted response) are in scope.
- **SSRF awareness.** The tool fetches exactly the URLs you pass it and the well-known paths derived from them; it follows redirects. If you run it against attacker-controlled input in an automated context, treat it like any other outbound-fetch tool and sandbox network egress accordingly.
- **Supply chain.** Two runtime dependencies (`chalk`, `commander`) and no test dependencies, to keep the surface small.

## Supported versions

Security fixes target the latest published `3.x` release. Older majors are not maintained.

## Out of scope

- Findings ax-audit reports about *audited* sites (those are the product, not vulnerabilities in ax-audit).
- Issues requiring a malicious local environment or modified ax-audit source.
