/**
 * ADR-114 bootstrap import report — returned by
 * POST /api/v1/products/bootstrap for both apply and `?dryRun=true`.
 * Transient: computed per request, never persisted.
 */
export interface BootstrapSkippedItem {
  /** Readable identifier — product name, or product + unresolved ref. */
  item: string;
  /** Short stable reason phrase (e.g. "component not found"). */
  reason: string;
}

export interface BootstrapReport {
  created: number;
  updated: number;
  edgesAdded: number;
  skipped: BootstrapSkippedItem[];
}
