import type { BomDependencyScope } from "../constants/bom-entry.js";
import type { EdgeProvenance } from "../constants/importer-edge.js";
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
  /** Catalog component match (spec 075): the component the row's BOM entries resolved to, else a non-retired component whose externalId equals this purl verbatim, else null. */
  catalogComponent: { id: string; slug: string; name: string } | null;
  /** Pending dependency suggestions targeting that catalog component (spec 075); 0 when none. */
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
  /**
   * Spec 076 / ADR-133 — provenance of the `component_depends_on_component`
   * edge from this consumer to the package's library component, when one
   * exists. Absent = the component reports the package in its BOM but no
   * catalog edge links the pair.
   */
  edge?: {
    provenance: EdgeProvenance;
    importerSourceId: string | null;
    importerConfigId: string | null;
    importRunId: string | null;
  } | null;
}
