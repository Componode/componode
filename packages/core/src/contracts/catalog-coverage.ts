/**
 * Catalog coverage derivations (spec 023). All values are computed per
 * read — nothing is persisted. The coverage population is the
 * default-visible component set: `ACTIVE` and not instances-all-`GONE`
 * (components with zero instances still count).
 */
export interface CatalogCoverage {
  components: {
    /** Default-visible component population size. */
    active: number;
    /** Population members reached by a non-retired product's DEPENDS_ON. */
    wired: number;
    /** `null` when `active` is 0 — renders as "—", never `0%`. */
    wiredPct: number | null;
  };
  products: {
    /** Products where lifecycle != 'RETIRED'. */
    total: number;
    /** `lobOwnerId IS NULL AND teamOwnerId IS NULL`. */
    missingOwner: number;
    /** Not in the dependency-surface set (see backend coverage service). */
    missingDependencies: number;
    /** `description IS NULL OR btrim(description) = ''`. */
    missingDescription: number;
  };
}

/**
 * Per-product completeness facets — three independent booleans, never a
 * score (spec 023, FR-014).
 */
export interface ProductCompleteness {
  /** `lobOwnerId != null || teamOwnerId != null`. */
  owner: boolean;
  /** `description` non-null and non-blank. */
  description: boolean;
  /** Dependency surface non-empty (own DEPENDS_ON/CONSUMES_FROM or a
   *  non-retired COMPOSES descendant's DEPENDS_ON). */
  dependencies: boolean;
}
