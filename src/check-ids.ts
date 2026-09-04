/**
 * Check-id resolution across renames.
 *
 * Check ids are a public interface twice over: they appear in `--checks`
 * invocations that live in CI configs, and as keys in saved baseline files. So
 * a rename cannot be a silent break — `--checks mcp` must keep working, and a
 * baseline recorded when the check was called `mcp` must still compare against
 * the check now called `mcp-discovery` rather than reporting one check removed
 * and another added.
 *
 * A check declares its former names in `meta.aliases`; everything here reads
 * from that, so adding an alias is a one-line change on the check itself.
 */
import { checks as allChecks } from './checks/index.js';
import type { CheckMeta } from './types.js';

/** Map of alias → current id, built from the registered checks. */
export function buildAliasMap(metas: CheckMeta[] = allChecks.map((c) => c.meta)): Map<string, string> {
  const map = new Map<string, string>();
  for (const meta of metas) {
    for (const alias of meta.aliases ?? []) {
      map.set(alias.toLowerCase(), meta.id);
    }
  }
  return map;
}

/**
 * Resolve a possibly-former check id to its current one. Unknown ids are
 * returned unchanged so callers can report them as invalid with the name the
 * user actually typed.
 */
export function resolveCheckId(id: string, metas?: CheckMeta[]): string {
  const current = metas ?? allChecks.map((c) => c.meta);
  const lower = id.toLowerCase();
  if (current.some((m) => m.id.toLowerCase() === lower)) return current.find((m) => m.id.toLowerCase() === lower)!.id;
  return buildAliasMap(current).get(lower) ?? id;
}

/** Every id a check answers to, current name first. */
export function allIdsFor(meta: CheckMeta): string[] {
  return [meta.id, ...(meta.aliases ?? [])];
}

/** Every selectable id across all checks, aliases included. */
export function allSelectableIds(metas: CheckMeta[] = allChecks.map((c) => c.meta)): string[] {
  return metas.flatMap(allIdsFor);
}

/**
 * Whether a check should run given a `--checks` selection, matching on its
 * current id or any alias.
 */
export function isSelected(meta: CheckMeta, selection: string[]): boolean {
  const wanted = new Set(selection.map((s) => s.toLowerCase()));
  return allIdsFor(meta).some((id) => wanted.has(id.toLowerCase()));
}
