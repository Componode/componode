import { useQuery } from "@tanstack/react-query";
import type {
  PackageConsumerListItem,
  PackagesResponse,
  Paginated,
} from "@componode/core";
import { api } from "@/api/client";
import {
  buildApiQueryString,
  facetParam,
  type ListQueryState,
} from "@/api/list-query";

/**
 * Packages explorer read hooks (spec 074, contracts/packages-api.md).
 * The `/packages` page's URL `q` maps to the API `search` param; filter
 * keys (ecosystem/scope/catalog) are API-shaped strings — the endpoint
 * accepts a scalar or CSV and coerces to arrays.
 */
export const PACKAGES_SORT_KEYS = [
  "name",
  "components",
  "versions",
  "ecosystem",
] as const;
export type PackagesSortKey = (typeof PACKAGES_SORT_KEYS)[number];

/** URL filter keys managed by the /packages list page (useListState). */
export const PACKAGES_FILTER_KEYS = ["ecosystem", "scope", "catalog"] as const;
export type PackagesFilterKey = (typeof PACKAGES_FILTER_KEYS)[number];

/** API params accepted by `GET /packages`. */
export interface PackagesListFilters {
  search?: string;
  ecosystem?: string;
  scope?: string;
  catalog?: string;
  page?: number;
  pageSize?: number;
  sort?: PackagesSortKey;
  order?: "asc" | "desc";
}

export type PackagesPage = PackagesResponse;
export type PackageConsumersPage = Paginated<PackageConsumerListItem>;

/**
 * Adapts resolved `useListState` output to `GET /packages` params.
 * Default sort is `components` desc (spec: most consumed first), which
 * the page passes through unchanged.
 */
export function packagesListParams(state: ListQueryState): PackagesListFilters {
  return {
    // Sub-2-char searches are not sent — the page shows a hint instead
    // (spec 074; keeps `?q=l` from firing a workspace-wide LIKE scan).
    search: state.search.trim().length >= 2 ? state.search.trim() : undefined,
    ecosystem: facetParam(state, "ecosystem"),
    scope: facetParam(state, "scope"),
    catalog: facetParam(state, "catalog"),
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as PackagesSortKey | null) ?? "components",
    order: state.order,
  };
}

export function usePackages(
  filters: PackagesListFilters,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["packages", "list", filters],
    queryFn: () => api<PackagesPage>(`/packages${buildApiQueryString(filters)}`),
    enabled: options.enabled ?? true,
    // Keep the current page visible while the next filter/sort/page loads
    // (docs/ux.md §6 refetch row — UX-STATE refetching).
    placeholderData: (prev) => prev,
  });
}

/** Inner consumers panel is fixed at 25 rows (no page-size picker). */
export const CONSUMERS_PAGE_SIZE = 25;

/** `GET /packages/consumers` — enabled only when a purl is supplied. */
export function usePackageConsumers(
  purl: string | null,
  options: { version?: string; page?: number; pageSize?: number } = {},
) {
  const params = { purl: purl ?? "", pageSize: CONSUMERS_PAGE_SIZE, ...options };
  return useQuery({
    queryKey: ["packages", "consumers", params],
    queryFn: () =>
      api<PackageConsumersPage>(
        `/packages/consumers${buildApiQueryString(params)}`,
      ),
    enabled: purl !== null,
    placeholderData: (prev) => prev,
  });
}
