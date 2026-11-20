import type { BomDependencyScope } from "../constants/bom-entry.js";
import type { Paginated } from "../schemas/list-params.js";

// Spec 074 — workspace package rollup. One row per normalized, version-free
// purl identity (bom_entries.purlIdentity, migration 034) — the where-used
// answer to "which components contain package X?". Derived by query over
// bom_entries joined to ACTIVE components; not a stored entity.
export interface PackageListItem {
  /** The group key — normalized, version-free purl (`pkg:npm/lodash`). */
  purl: string;
  /** Representative package name (most recently reported in the group). */
  name: string;
  /** purl `type` fragment (npm, pypi, deb, …) — one per identity. */
  ecosystem: string;
  /** Distinct versions reported for this package. */
  versionCount: number;
  /** Top 5 versions by consuming-component count. */
  versions: { version: string; componentCount: number }[];
  /** Distinct ACTIVE components reporting this package. */
  componentCount: number;
  /** Phase 2 contract placeholder — Library component match. Always null in Phase 1b. */
  catalogComponent: { id: string; slug: string; name: string } | null;
  /** Phase 2 contract placeholder — pending curation suggestions. Always 0 in Phase 1b. */
  pendingSuggestionCount: number;
}

/**
 * Filter facets returned alongside the page — computed over the whole
 * ACTIVE-component inventory regardless of applied filters, so the
 * ecosystem filter can offer every selectable value even when the
 * current page contains none of them.
 */
export interface PackagesFacets {
  ecosystems: string[];
}

export type PackagesResponse = Paginated<PackageListItem> & {
  facets: PackagesFacets;
};

// GET /packages/consumers — one row per (component, version, scope)
// combination reporting the package (merged-view parity with the BOM tab).
export interface PackageConsumerListItem {
  /** Consuming component — deep-link target for `?tab=bom&q={purl}`. */
  component: { id: string; slug: string; name: string; category: string };
  version: string | null;
  scope: BomDependencyScope;
  /** true when any instance/source reports the package as directly declared. */
  direct: boolean;
  /** Most recent report across the group. */
  lastReportedAt: string;
}
