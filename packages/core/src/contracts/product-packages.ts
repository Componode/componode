import type { BomDependencyScope } from "../constants/bom-entry.js";
import type { Paginated } from "../schemas/list-params.js";
import type { DepSource } from "./digital-product.js";

/**
 * Declared-dependency attribution — the DepSource through which the
 * product reaches the matched Library component (DIRECT edge, GROUP
 * membership, or INHERITED via a named composed child).
 */
export type DeclaredDependency = DepSource;

// Spec 080 — per-product package roll-up (research Q7): bom_entries
// aggregated across the product's reachable component set (direct DEPENDS_ON,
// group-expanded DEPENDS_ON, COMPOSES-inherited — the same DepSource model
// the Components tab uses). Derived by query, never stored; one row per
// normalized, version-free purl identity (bom_entries.purlIdentity).
export interface ProductPackageListItem {
  /** The group key — normalized, version-free purl (`pkg:npm/lodash`). */
  purl: string;
  /** Representative package name (most recently reported in the group). */
  name: string;
  /** purl `type` fragment (npm, pypi, deb, …) — one per identity. */
  ecosystem: string;
  /** Distinct versions reported by the product's components. `> 1` ⇒ skew. */
  versionCount: number;
  /** Top 5 versions by contributing-component count. */
  versions: { version: string; componentCount: number }[];
  /** Distinct contributing (reachable, ACTIVE) components reporting this package. */
  componentCount: number;
  /** Most recent report across the group — freshness signal. */
  lastReportedAt: string;
  /** Catalog match (spec-075 semantics): resolved BOM component, else a non-retired component whose externalId equals this purl verbatim, else null. */
  catalogComponent: { id: string; slug: string; name: string } | null;
  /**
   * Declared-dependency signal (clarified 2026-11-23): non-null when the
   * matched catalog component is itself in the product's reachable set —
   * the product already declares a DEPENDS_ON edge to the library. The
   * DepSource attribution distinguishes the product's own edge (DIRECT /
   * GROUP) from a declaration inherited through a composed child.
   */
  declared: DeclaredDependency | null;
}

/**
 * Coverage of the contributing set — `reporting` of `total` monitored
 * (non-LIBRARY) reachable ACTIVE components with ≥1 BOM entry; `reachable`
 * counts the whole non-retired reachable set including libraries (D5:
 * libraries aggregate packages but never inflate the coverage denominator).
 * Distinguishes "no packages" from "components have not reported package
 * data" (FR-009/FR-013).
 */
export interface ProductPackageCoverage {
  reporting: number;
  total: number;
  reachable: number;
}

export type ProductPackagesResponse = Paginated<ProductPackageListItem> & {
  coverage: ProductPackageCoverage;
  /** Workspace stale threshold (`bom.staleThresholdDays`) for client-side isStale. */
  staleThresholdDays: number;
  facets: { ecosystems: string[] };
};

/**
 * `GET /products/:slug/packages/consumers` — one row per (component,
 * version, scope) combination reporting the package within the product's
 * reachable set (merged-view parity with the BOM tab). `depSource` carries
 * how the component is reachable from the product.
 */
export interface ProductPackageConsumerListItem {
  /** Contributing component — deep-link target for `?tab=bom&q={purl}`. */
  component: { id: string; slug: string; name: string; category: string };
  /** Reachability from the product: DIRECT, GROUP (named group), or INHERITED (named composed child). */
  depSource: DepSource;
  version: string | null;
  scope: BomDependencyScope;
  /** true when any instance/source reports the package as directly declared. */
  direct: boolean;
  /** Most recent report across the group. */
  lastReportedAt: string;
}
