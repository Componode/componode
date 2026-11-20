import { PackageURL } from "packageurl-js";

// purl is the canonical package identity (research: sbom_research.md §Design
// Principle 2). Verbatim purls are stored on each bom_entry for display and
// export; the normalized version-free form is the cross-provider identity
// used by catalog matching (Phase 2) and where-used grouping (Phase 1b).
// Normalization delegates to packageurl-js — per-type casing/encoding rules
// are NOT hand-rolled (grill amendment).

/** Parses a Package URL, returning null instead of throwing on invalid input. */
export function parsePurl(purl: string): PackageURL | null {
  try {
    return PackageURL.fromString(purl);
  } catch {
    return null;
  }
}

/** True when `purl` is a syntactically valid Package URL. */
export function isValidPurl(purl: string): boolean {
  return parsePurl(purl) !== null;
}

/**
 * The purl `type` fragment — `npm`, `pypi`, `deb`, `rpm`, `golang` …
 * Stored verbatim on `bom_entries.ecosystem`. Null when invalid.
 */
export function purlEcosystem(purl: string): string | null {
  return parsePurl(purl)?.type ?? null;
}

/**
 * Normalized, version-free package identity: version, qualifiers and subpath
 * stripped, per-type normalization (casing/encoding) applied by packageurl-js.
 * `pkg:npm/lodash` for `pkg:npm/Lodash@4.17.21?x#y`. Null when invalid.
 */
export function normalizePurlIdentity(purl: string): string | null {
  const parsed = parsePurl(purl);
  if (!parsed) return null;
  return new PackageURL(
    parsed.type,
    parsed.namespace,
    parsed.name,
    null,
    null,
    null,
  ).toString();
}
