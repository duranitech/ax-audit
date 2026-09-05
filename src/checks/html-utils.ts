/**
 * Shared HTML parsing primitives used by checks that need to inspect homepage markup.
 *
 * These are deliberately regex-based (no DOM dependency) so the audit stays free of
 * heavyweight HTML parsers. They are designed for resilience over completeness — every
 * helper returns `null` / empty values on malformed input rather than throwing.
 */

/** Escape a string for safe inclusion inside a `RegExp` source. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Decode the small set of HTML entities that show up most often inside attribute values. */
export function unescapeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/**
 * Match the first opening tag (`<tag ...>`) and return its raw attribute string.
 * Returns `null` if the tag is absent.
 */
export function findOpeningTag(html: string, tagName: string): string | null {
  const re = new RegExp(`<${escapeRegex(tagName)}\\b([^>]*)>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

/** Pull a single attribute out of a raw attribute fragment (the `...` in `<tag ...>`). */
export function getAttribute(attrFragment: string, attrName: string): string | null {
  const re = new RegExp(`\\b${escapeRegex(attrName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrFragment.match(re);
  if (!m) return null;
  return unescapeHtml(m[1] ?? m[2] ?? m[3] ?? '');
}

/** Convenience: read an attribute from the first matching opening tag. */
export function getTagAttribute(html: string, tagName: string, attrName: string): string | null {
  const frag = findOpeningTag(html, tagName);
  return frag === null ? null : getAttribute(frag, attrName);
}

/**
 * Extract the `content` value of the first `<meta name="..."|property="..."|http-equiv="...">`
 * matching `key`. Searches `name`, `property`, and `http-equiv` (case-insensitive).
 */
export function getMetaContent(html: string, key: string): string | null {
  const escaped = escapeRegex(key);
  const re = new RegExp(`<meta\\s+[^>]*\\b(?:name|property|http-equiv)\\s*=\\s*["']${escaped}["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  return getAttribute(m[0], 'content');
}

/** Match every `<meta>` tag whose name/property begins with `prefix` (e.g. `og:`, `twitter:`). */
export function findMetaTagsByPrefix(html: string, prefix: string): string[] {
  const re = new RegExp(`<meta\\s+[^>]*\\b(?:name|property)\\s*=\\s*["']${escapeRegex(prefix)}[^"']*["'][^>]*>`, 'gi');
  return [...html.matchAll(re)].map((m) => m[0]);
}

/** Match every `<link rel="...">` tag with the requested `rel` value. */
export function findLinkTags(html: string, rel: string): string[] {
  const re = new RegExp(`<link\\s+[^>]*\\brel\\s*=\\s*["'][^"']*\\b${escapeRegex(rel)}\\b[^"']*["'][^>]*>`, 'gi');
  return [...html.matchAll(re)].map((m) => m[0]);
}

/**
 * Strip `<script>` / `<style>` blocks and HTML tags to produce a rough text-content estimate.
 * Returns the trimmed plain text — used for content-density / SSR heuristics.
 */
export function extractVisibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the contents of every `<script type="application/ld+json">` block.
 *
 * Attribute order matters here, and it is easy to get wrong: a pattern anchored
 * on `<script type=...` misses `<script id="org-json-ld" type="application/ld+json">`,
 * which is how several frameworks emit it. That mistake reads as "no structured
 * data found" on a site whose markup is perfectly good, so the matcher tolerates
 * any attributes before `type`.
 */
export function findJsonLdBlocks(html: string): string[] {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  for (const m of html.matchAll(re)) {
    const type = (getAttribute(m[1], 'type') ?? '').toLowerCase();
    if (type.includes('application/ld+json')) blocks.push(m[2]);
  }
  return blocks;
}

/** Count `<script>` tags (excluding `type="application/ld+json"` data blocks). */
export function countExecutableScripts(html: string): number {
  const re = /<script\b([^>]*)>/gi;
  let count = 0;
  for (const m of html.matchAll(re)) {
    const type = getAttribute(m[1], 'type') ?? '';
    if (/json|template/i.test(type)) continue;
    count++;
  }
  return count;
}

/**
 * How much of the document is markup that could have carried visible text.
 *
 * The denominator for the text-to-markup ratio. Three element classes are
 * emptied rather than counted, because their contents are not markup an
 * agent parses for content: script bodies are code or serialized data (a
 * framework's hydration payload alone can be ten times the page), style
 * bodies are presentation, and svg interiors are drawing instructions —
 * the inline twin of image bytes, which nobody would count against an
 * `<img>`. Comments likewise. The head is metadata by definition — much
 * of it demanded by other checks in this engine — so the measurement
 * starts at `<body>` when one exists.
 *
 * Measured against the raw document instead, vercel.com, stripe.com and
 * nextjs.org all sat under the 5% threshold while serving hundreds of
 * words of visible text: the raw ratio graded framework choice, not
 * agent experience.
 */
export function structuralMarkupLength(html: string): number {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg></svg>')
    .replace(/<!--[\s\S]*?-->/g, '');
  const body = stripped.match(/<body[\s\S]*<\/body>/i);
  return (body ? body[0] : stripped).length;
}
