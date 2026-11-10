import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  buildApiQueryString,
  facetParam,
  fetchAllPages,
  type ListQueryState,
} from "@/api/list-query";
import type { Paginated } from "@/api/types";
import type {
  ImportRun,
  ImporterSource,
  ImporterSourceListItem,
  SourceMembershipsResponse,
} from "@/api/types";

/** Spec 068 / ADR-130 sort whitelist for `GET /importer-sources`
 *  (importerSourceListQuerySchema). `name` sorts by externalIdentity. */
export const IMPORTER_SOURCES_SORT_KEYS = [
  "name",
  "importerName",
  "status",
  "boundConfig",
  "components",
  "instances",
  "lastCompletedRunAt",
  "createdAt",
] as const;
export type ImporterSourcesSortKey = (typeof IMPORTER_SOURCES_SORT_KEYS)[number];

/** URL filter keys managed by the /sources list page (useListState). */
export const IMPORTER_SOURCES_FILTER_KEYS = ["status", "importerName"] as const;
export type ImporterSourcesFilterKey = (typeof IMPORTER_SOURCES_FILTER_KEYS)[number];

/** API params accepted by `GET /importer-sources`. */
export interface ImporterSourcesListFilters {
  page?: number;
  pageSize?: number;
  sort?: ImporterSourcesSortKey;
  order?: "asc" | "desc";
  search?: string;
  status?: string;
  importerName?: string;
}

/**
 * Adapts resolved `useListState` output to `/importer-sources` API params
 * (spec 068). `"all"`-sentinel filters are omitted; other values pass
 * through as the API enum / free-text importer name.
 */
export function importerSourcesListParams(
  state: ListQueryState,
): ImporterSourcesListFilters {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ImporterSourcesSortKey | null) ?? "createdAt",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
    status: facetParam(state, "status"),
    importerName: facetParam(state, "importerName"),
  };
}

/**
 * Primary paginated importer-sources list (`{data, pagination}` envelope).
 * Keep the current page visible while the next page/sort/filter loads.
 */
export function useImporterSources(filters: ImporterSourcesListFilters = {}) {
  return useQuery({
    queryKey: ["importer-sources", "list", filters],
    queryFn: () =>
      api<Paginated<ImporterSourceListItem>>(
        `/importer-sources${buildApiQueryString(filters)}`,
      ),
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetch every matching importer source by paging through the list endpoint
 * (pageSize caps at 100) — for pickers that legitimately need the full set
 * (e.g. the reattach-source select in the importer form, spec 068 exempt).
 */
export function useAllImporterSources(
  filters: ImporterSourcesListFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["importer-sources", "all", filters],
    enabled,
    queryFn: () =>
      fetchAllPages((page) =>
        api<Paginated<ImporterSourceListItem>>(
          `/importer-sources${buildApiQueryString({ ...filters, page, pageSize: 100 })}`,
        ),
      ),
  });
}

export function useImporterSource(id: string | null) {
  return useQuery({
    queryKey: ["importer-sources", id],
    queryFn: () => api<{ source: ImporterSourceListItem }>(`/importer-sources/${id}`),
    enabled: id !== null,
  });
}

export function useSourceRuns(id: string | null) {
  return useQuery({
    queryKey: ["importer-sources", id, "runs"],
    queryFn: () => api<{ runs: ImportRun[] }>(`/importer-sources/${id}/runs`),
    enabled: id !== null,
  });
}

export function useSourceMemberships(id: string | null) {
  return useQuery({
    queryKey: ["importer-sources", id, "memberships"],
    queryFn: () =>
      api<SourceMembershipsResponse>(`/importer-sources/${id}/memberships`),
    enabled: id !== null,
  });
}

// Retire/reactivate return the raw importer_sources row, not the enriched
// list shape — invalidate on settle so a 409 SOURCE_STATE_CONFLICT also
// refreshes the control state to the server's truth.
export function useRetireSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ source: ImporterSource }>(`/importer-sources/${id}/retire`, {
        method: "POST",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["importer-sources"] });
    },
  });
}

export function useReactivateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ source: ImporterSource }>(`/importer-sources/${id}/reactivate`, {
        method: "POST",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["importer-sources"] });
    },
  });
}
