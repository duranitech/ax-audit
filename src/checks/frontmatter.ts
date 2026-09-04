/**
 * Minimal YAML frontmatter reader.
 *
 * ax-audit has two runtime dependencies and will not grow a YAML parser for
 * this. The documents it reads frontmatter from — SKILL.md, the Markdown
 * mirrors Vercel and Mintlify serve — use a flat `key: value` block by
 * convention, so a focused reader handles them exactly and reports anything
 * more elaborate as unparsed rather than guessing at it.
 *
 * Supported: `key: value`, single- and double-quoted values, `#` comments on
 * their own line or after a value, and inline flow sequences (`tags: [a, b]`).
 * Nested mappings and block sequences are recognised and skipped, with their
 * keys recorded in `skipped` so a caller can say what it could not read.
 */

export interface Frontmatter {
  /** Flat scalar keys, lowercased, in source order. */
  frontmatter: Record<string, string>;
  /** Inline sequences, e.g. `tags: [a, b]` or `tags: a, b`. */
  lists: Record<string, string[]>;
  /** Keys whose values were nested structures this reader does not parse. */
  skipped: string[];
  /** The document with its frontmatter block removed. */
  body: string;
  /** Whether a frontmatter block was present at all. */
  present: boolean;
}

/** Strip matching surrounding quotes and unescape the pairs YAML defines inside them. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Remove a trailing `#` comment from an unquoted value. */
function stripComment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed;
  const hash = trimmed.search(/\s#/);
  return hash === -1 ? trimmed : trimmed.slice(0, hash).trim();
}

/**
 * Parse a leading `---` delimited frontmatter block.
 *
 * A document with no block returns `present: false` and its whole text as the
 * body, so callers can distinguish "no frontmatter" from "empty frontmatter".
 */
export function parseFrontmatter(document: string): Frontmatter {
  const empty: Frontmatter = { frontmatter: {}, lists: {}, skipped: [], body: document, present: false };

  // Tolerate a BOM and leading blank lines before the opening delimiter.
  const text = document.replace(/^\uFEFF/, '');
  const opening = text.match(/^\s*---[ \t]*\r?\n/);
  if (!opening) return empty;

  const rest = text.slice(opening[0].length);
  const closing = rest.match(/^---[ \t]*(?:\r?\n|$)/m);
  if (!closing || closing.index === undefined) return empty;

  const block = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length);

  const frontmatter: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const skipped: string[] = [];

  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    // Indented lines belong to a structure the previous key opened.
    if (/^\s/.test(line)) continue;

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const raw = match[2];

    if (raw.trim() === '') {
      // A key with no inline value opens a nested mapping or block sequence.
      const next = lines[i + 1] ?? '';
      if (/^\s*-\s+/.test(next)) {
        const items: string[] = [];
        for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) {
          items.push(unquote(stripComment(lines[j].replace(/^\s*-\s+/, ''))));
        }
        lists[key] = items;
      } else if (/^\s+\S/.test(next)) {
        skipped.push(key);
      } else {
        frontmatter[key] = '';
      }
      continue;
    }

    const value = stripComment(raw);
    const flow = value.match(/^\[(.*)\]$/);
    if (flow) {
      lists[key] = flow[1]
        .split(',')
        .map((v) => unquote(v))
        .filter((v) => v !== '');
      continue;
    }

    frontmatter[key] = unquote(value);
  }

  return { frontmatter, lists, skipped, body, present: true };
}
