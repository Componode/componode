// Canonical slug derivation (spec 081). The collapse step guarantees '-'
// runs of length <= 1, so edge-trimming uses index checks — no
// '+'-quantified regex on '-' (polynomial-backtracking pattern flagged by
// code scanning).
export function slugify(input: string, maxLength?: number): string {
  const collapsed = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-");
  const start = collapsed.startsWith("-") ? 1 : 0;
  const end = collapsed.endsWith("-") ? collapsed.length - 1 : collapsed.length;
  let slug = collapsed.slice(start, end);
  if (maxLength !== undefined && slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    if (slug.endsWith("-")) slug = slug.slice(0, -1);
  }
  return slug;
}
