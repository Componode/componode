import type {
  BomSuggestionReason,
  BomSuggestionStatus,
} from "../constants/bom-component-suggestion.js";
import type { ComponentCategory } from "../constants/component-categories.js";
import type { Paginated } from "../schemas/list-params.js";

// Spec 075 / ADR-132 — staged component→library DEPENDS_ON candidates.
// Lifecycle mirrors EdgeSuggestion (ADR-113): PENDING actionable, the rest
// terminal.

/** Persisted staged dependency pair (bom_component_suggestions row). */
export interface DependencySuggestion {
  id: string;
  /** Consuming component (edge source / suggestion parent). */
  parentComponentId: string;
  /** Library/candidate component (edge target / suggestion child). */
  childComponentId: string;
  /** The BOM entry that produced this candidate; NULL after BOM pruning removes it (decided pairs stay terminal regardless). */
  bomEntryId: string | null;
  /** NULL on SUPERSEDED tombstones. */
  reason: BomSuggestionReason | null;
  /** Decimal score; NULL on tombstones. */
  score: number | null;
  status: BomSuggestionStatus;
  createdAt: string;
  decidedAt: string | null;
  /** persons.id of the deciding user; NULL on system-marked tombstones. */
  decidedBy: string | null;
}

interface ComponentRef {
  id: string;
  slug: string;
  name: string;
  category: ComponentCategory;
}

/** Queue/list row — the suggestion joined to both endpoint refs. */
export interface DependencySuggestionQueueItem extends DependencySuggestion {
  parentComponent: ComponentRef;
  childComponent: ComponentRef;
  decidedByName: string | null;
}

export type DependencySuggestionListResult =
  Paginated<DependencySuggestionQueueItem>;

/**
 * Pending suggestions grouped per library (GET /suggestions/dependencies/
 * groups) — the dependency segment's default view.
 */
export interface DependencySuggestionGroup {
  childComponent: ComponentRef;
  /** The library's normalized version-free purl (`externalId`). */
  purl: string | null;
  /** Pending rows in the group. */
  pendingCount: number;
  /** Distinct versions reported on the underlying entries. */
  versions: number;
  /** Distinct pending reasons in the group. */
  reasons: BomSuggestionReason[];
  /** Highest pending score in the group. */
  topScore: number | null;
  /** Server-computed bulk-accept eligibility (all PURL_EXACT). */
  bulkAcceptable: boolean;
}

export type DependencySuggestionGroupListResult =
  Paginated<DependencySuggestionGroup>;

/** Result of POST /suggestions/dependencies/bulk. */
export interface DependencyBulkResult {
  /** Rows that reached a terminal state this call. */
  decided: number;
  /** Pairs whose edge write failed (siblings unaffected). */
  failed: number;
  /** Dependency edges created. */
  edges: number;
  /** Suggestion ids whose edge write failed — retry subset. */
  failedIds: string[];
}
