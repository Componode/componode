import type { EdgeSuggestionReason, EdgeSuggestionStatus } from "../constants/edge-suggestion.js";

/** Persisted staged candidate DEPENDS_ON pair (ADR-113, spec 022). */
export interface EdgeSuggestion {
  id: string;
  productId: string;
  componentId: string;
  /** NULL on coverage tombstones (pairs superseded without a signal). */
  reason: EdgeSuggestionReason | null;
  /** Decimal score (e.g. 1.05); NULL on tombstones. */
  score: number | null;
  status: EdgeSuggestionStatus;
  createdAt: string;
  decidedAt: string | null;
  /** persons.id of the deciding user; NULL on system-marked tombstones. */
  decidedBy: string | null;
}

/** Queue/list row — the suggestion joined to both endpoint refs. */
export interface SuggestionQueueItem extends EdgeSuggestion {
  product: { id: string; name: string; slug: string };
  component: { id: string; name: string; slug: string; category: string };
  /** persons displayName/username coalesce for the dismissed view; NULL when undecided/deleted. */
  decidedByName: string | null;
}

export interface SuggestionListResult {
  items: SuggestionQueueItem[];
  total: number;
}

/** Result of a whole-catalog generation pass (POST /suggestions/rescan). */
export interface SuggestionRescanReport {
  productsScanned: number;
  componentsScanned: number;
  /** Pairs newly PENDING or rescored this pass. */
  staged: number;
  /** Pairs tombstoned SUPERSEDED by coverage this pass. */
  superseded: number;
}
