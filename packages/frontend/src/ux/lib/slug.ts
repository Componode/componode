/** Slug derivation shared by the create dialogs (spec 042). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
