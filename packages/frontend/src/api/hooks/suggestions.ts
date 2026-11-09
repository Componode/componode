import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { buildApiQueryString, type ListQueryState } from "@/api/list-query";
import type {
  EdgeSuggestion,
  SuggestionListResult,
  SuggestionQueueItem,
  SuggestionRescanReport,
} from "@/api/types";

/**
 * Spec 042 / G32: `DECIDED` spans every terminal status
 * (ACCEPTED/DISMISSED/SUPERSEDED) for the decided-history view; `DISMISSED`
 * remains the per-status filter.
 */
export type SuggestionView = "PENDING" | "DISMISSED" | "DECIDED";

/** Spec 068 / ADR-130 sort whitelist for `GET /suggestions`
 * (listSuggestionsQuerySchema). The service resolves the effective key per
 * status view — `decidedAt` orders decided rows, `score` the pending queue;
 * `status` orders the displayed decision badge (T059 / FR-005). */
export const SUGGESTIONS_SORT_KEYS = [
  "score",
  "createdAt",
  "decidedAt",
  "status",
] as const;
export type SuggestionsSortKey = (typeof SUGGESTIONS_SORT_KEYS)[number];

/** URL filter keys managed by the /suggestions list page (useListState). */
export const SUGGESTIONS_FILTER_KEYS = ["status"] as const;
export type SuggestionsFilterKey = (typeof SUGGESTIONS_FILTER_KEYS)[number];

/** API params accepted by `GET /suggestions`. */
export interface SuggestionsListFilters {
  status?: SuggestionView;
  page?: number;
  pageSize?: number;
  sort?: SuggestionsSortKey;
  order?: "asc" | "desc";
}

/**
 * Compatibility view over the `{data, pagination}` envelope — `items` plus
 * flat pagination fields so existing consumers (sidebar badge, product
 * detail, decided-history tab) keep their shape.
 */
export interface SuggestionsFeed {
  items: SuggestionQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNext: boolean;
}

const toFeed = (res: SuggestionListResult): SuggestionsFeed => ({
  items: res.data,
  total: res.pagination.total,
  page: res.pagination.page,
  pageSize: res.pagination.pageSize,
  pageCount: res.pagination.pageCount,
  hasNext: res.pagination.hasNext,
});

/**
 * Adapts resolved `useListState` output to `/suggestions` API params
 * (spec 068). The `status` filter doubles as the pending/history tab
 * driver: `"PENDING"` → pending queue, `"DECIDED"` → decided history.
 */
export function suggestionsListParams(
  state: ListQueryState,
): SuggestionsListFilters {
  const v = state.filters.status;
  return {
    status: v === "DECIDED" || v === "DISMISSED" ? v : "PENDING",
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as SuggestionsSortKey | null) ?? "score",
    order: state.order,
  };
}

/**
 * Read queue — any authenticated role (ADR-113).
 *
 * `useSuggestions(view, options)` — spec 068 params object; `view` supplies
 * the default `status` filter (sidebar badge, product detail pass paging
 * only).
 */
export function useSuggestions(
  view: SuggestionView = "PENDING",
  options?: SuggestionsListFilters,
) {
  const filters: SuggestionsListFilters = { status: view, ...options };

  return useQuery({
    queryKey: ["suggestions", "list", filters],
    queryFn: () =>
      api<SuggestionListResult>(
        `/suggestions${buildApiQueryString(filters)}`,
      ),
    select: toFeed,
    // Keep the previous page only within the same status view — carrying
    // PENDING rows into the DECIDED header would flash the wrong category.
    placeholderData: (prev, prevQuery) => {
      const pk = prevQuery?.queryKey;
      const prevStatus =
        pk?.[0] === "suggestions" && pk?.[1] === "list"
          ? (pk[2] as SuggestionsListFilters | undefined)?.status
          : undefined;
      return prevStatus === filters.status ? prev : undefined;
    },
  });
}

function invalidateSuggestions(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["suggestions"] });
  // Accepting wires a real edge — refresh product dependency queries too.
  qc.invalidateQueries({ queryKey: ["products"] });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ suggestion: EdgeSuggestion }>(`/suggestions/${id}/accept`, {
        method: "POST",
      }),
    onSuccess: () => invalidateSuggestions(qc),
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ suggestion: EdgeSuggestion }>(`/suggestions/${id}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => invalidateSuggestions(qc),
  });
}

export function useRescanSuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<SuggestionRescanReport>("/suggestions/rescan", {
        method: "POST",
      }),
    onSuccess: () => invalidateSuggestions(qc),
  });
}
