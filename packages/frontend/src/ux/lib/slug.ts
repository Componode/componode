/** Slug derivation shared by the create dialogs (spec 042). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Mirror of @componode/core slugify (spec 081, research D8 — frontend stays
// types-only on core, so the algorithm is mirrored, not imported). The
// collapse step leaves '-' runs of length <= 1, so edge-trim uses index
// checks — no '+'-quantified regex on '-'.
export function deriveSlug(name: string): string {
  const collapsed = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-");
  const start = collapsed.startsWith("-") ? 1 : 0;
  const end = collapsed.endsWith("-") ? collapsed.length - 1 : collapsed.length;
  return collapsed.slice(start, end);
}
