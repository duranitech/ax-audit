/**
 * Minimal RFC 9651 (Structured Field Values) Dictionary parser.
 *
 * Scope is deliberately narrow: the fields ax-audit reads that are defined as
 * Dictionaries carry token or boolean members with optional parameters —
 * IETF AIPREF `Content-Usage: train-ai=n, search=y`
 * (draft-ietf-aipref-attach-05 §2) and, on the request side, Web Bot Auth's
 * `Signature-Input`. A full Structured Fields implementation (inner lists,
 * byte sequences, dates, display strings) would be dead weight, so this parser
 * covers dictionaries of bare items and reports anything else as malformed
 * rather than guessing.
 *
 * The parser never throws. Malformed members are collected so callers can
 * report *which* segment was wrong instead of discarding the whole header.
 */

export interface DictMember {
  /** Member key, lowercased (RFC 9651 keys are case-sensitive but every field we read is lowercase). */
  key: string;
  /**
   * Bare item value as written. A key with no `=` is a boolean true and
   * yields `'?1'`, matching the RFC's serialization of a true Boolean.
   */
  value: string;
  /** Parameters attached to the member (`;key=value`), values as written. */
  params: Record<string, string>;
  /** The member as it appeared in the input, trimmed. */
  raw: string;
}

export interface ParsedDictionary {
  members: DictMember[];
  /** Segments that could not be parsed as `key[=value][;param...]`. */
  malformed: string[];
}

/** RFC 9651 keys: lowercase alpha / `*` start, then alphanumerics and `_-.*`. */
const KEY_RE = /^[a-z*][a-z0-9_\-.*]*$/;

/**
 * Split on top-level commas, keeping quoted strings intact so a value like
 * `note="a, b"` stays one member.
 */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inQuote) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (ch === separator && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Strip surrounding double quotes from a string item, unescaping `\"` and `\\`. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return value;
}

/**
 * Parse a Structured Field Dictionary. Returns members in source order plus the
 * segments that failed to parse.
 *
 * ```
 * parseDictionary('train-ai=n, search=y')
 * // members: [{key:'train-ai', value:'n'}, {key:'search', value:'y'}]
 * ```
 */
export function parseDictionary(input: string): ParsedDictionary {
  const members: DictMember[] = [];
  const malformed: string[] = [];

  if (!input || !input.trim()) return { members, malformed };

  for (const segment of splitTopLevel(input, ',')) {
    const raw = segment.trim();
    if (!raw) continue;

    const [head, ...paramParts] = splitTopLevel(raw, ';');
    const eq = head.indexOf('=');
    const key = (eq === -1 ? head : head.slice(0, eq)).trim().toLowerCase();
    const rawValue = eq === -1 ? '?1' : head.slice(eq + 1).trim();

    if (!KEY_RE.test(key) || (eq !== -1 && rawValue === '')) {
      malformed.push(raw);
      continue;
    }

    const params: Record<string, string> = {};
    let paramsOk = true;
    for (const part of paramParts) {
      const p = part.trim();
      if (!p) continue;
      const pEq = p.indexOf('=');
      const pKey = (pEq === -1 ? p : p.slice(0, pEq)).trim().toLowerCase();
      if (!KEY_RE.test(pKey)) {
        paramsOk = false;
        break;
      }
      params[pKey] = pEq === -1 ? '?1' : unquote(p.slice(pEq + 1).trim());
    }
    if (!paramsOk) {
      malformed.push(raw);
      continue;
    }

    members.push({ key, value: unquote(rawValue), params, raw });
  }

  return { members, malformed };
}

/** Convenience: look up one member's value, or `null` when absent. */
export function dictValue(parsed: ParsedDictionary, key: string): string | null {
  return parsed.members.find((m) => m.key === key.toLowerCase())?.value ?? null;
}
