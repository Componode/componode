/**
 * Shared list-query serialization (spec 068 / ADR-130).
 *
 * `useListState` (ux/hooks) keeps table state in the URL under short param
 * names (`page`, `size`, `sort`, `order`, `q`, `<filter keys>`); this helper
 * maps the resolved state onto the API param names (`page`, `pageSize`,
 * `sort`, `order`, `search`, `<filter keys>`) and drops values equal to
 * their defaults so query strings — and therefore TanStack query keys —
 * stay canonical.
 *
 * Filter keys double as API param names and filter values are expected to
 * be API-ready strings (the "unset" sentinel lives only in the URL/state
 * layer and is skipped via `defaults.filters`). A filter whose API param
 * name or value encoding differs must be adapted by the owning hook.
 */

import type { Paginated } from "@/api/types";

export type ListSortOrder = "asc" | "desc";

/** FR-001: rows-per-page choices are exactly 25/50/100 (default 25). */
export const LIST_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/** Resolved list state — the shape `useListState` returns. */
export interface ListQueryState {
  page: number;
  pageSize: number;
  sort: string | null;
  order: ListSortOrder;
  search: string;
  filters: Record<string, string>;
}

/**
 * Values treated as "unset" — entries equal to these are omitted from the
 * query string. `useListState` returns its resolved defaults on
 * `state.defaults`, so `buildListQueryString(state)` works directly.
 */
export interface ListQueryDefaults {
  page?: number;
  pageSize?: number;
  sort?: string | null;
  order?: ListSortOrder;
  search?: string;
  filters?: Record<string, string>;
}

const FALLBACK_DEFAULTS: Required<Omit<ListQueryDefaults, "filters">> & {
  filters?: Record<string, string>;
} = {
  page: 1,
  pageSize: 25,
  sort: null,
  order: "asc",
  search: "",
};

/**
 * Serializes resolved list state to a `?…` API query string (or "" when
 * everything is at its default). Accepts the `useListState` return value
 * directly — its `defaults` member supplies the per-page skip rules — or a
 * plain `ListQueryState` plus an explicit `defaults` argument.
 */
export function buildListQueryString(
  state: ListQueryState & { defaults?: ListQueryDefaults },
  defaults?: ListQueryDefaults,
): string {
  const d = defaults ?? state.defaults ?? {};
  const pageDefault = d.page ?? FALLBACK_DEFAULTS.page;
  const sizeDefault = d.pageSize ?? FALLBACK_DEFAULTS.pageSize;
  const orderDefault = d.order ?? FALLBACK_DEFAULTS.order;
  const searchDefault = d.search ?? FALLBACK_DEFAULTS.search;
  const sortDefault = d.sort ?? FALLBACK_DEFAULTS.sort;

  const params = new URLSearchParams();
  if (state.page >= 1 && state.page !== pageDefault) {
    params.set("page", String(state.page));
  }
  if (state.pageSize >= 1 && state.pageSize !== sizeDefault) {
    params.set("pageSize", String(state.pageSize));
  }
  if (state.sort != null && state.sort !== sortDefault) {
    params.set("sort", state.sort);
  }
  if (state.order !== orderDefault) {
    params.set("order", state.order);
  }
  if (state.search !== searchDefault) {
    params.set("search", state.search);
  }
  for (const [key, value] of Object.entries(state.filters ?? {})) {
    if (value === "" || value === d.filters?.[key]) continue;
    params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Sentinel→param mapping shared by every list adapter (spec 069 / B.4 —
 * replaces the per-hook `facet`/`auditFacet` copies and ad-hoc
 * `v !== "all"` checks). A filter value of `undefined`, `""`, or the
 * `"all"` sentinel means "unset" and serializes to no API param.
 */
export function facetValue(v: string | undefined): string | undefined {
  return v !== undefined && v !== "" && v !== "all" ? v : undefined;
}

export function facetParam(
  state: ListQueryState,
  key: string,
): string | undefined {
  return facetValue(state.filters[key]);
}

/**
 * Serializes a flat API-params record to a `?…` query string, skipping
 * `undefined`/`null`/`""` values. Used by hooks that accept structured
 * filter objects (the `xListParams` adapters) rather than a resolved
 * `useListState`. Every emitted key MUST be a real API param — endpoint
 * schemas are `.strict()` (ADR-095) and reject unknown keys with a 400.
 */
export function buildApiQueryString(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Scalar contract params only — undefined/null/objects are dropped.
    // (Typed filter interfaces lack an index signature, so `object` is the
    // accepted input shape; every emitted key MUST be a real API param —
    // endpoint schemas are `.strict()` and reject unknown keys, ADR-095.)
    if (
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean") ||
      value === ""
    ) {
      continue;
    }
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Query string for one page of a fetch-all sweep: max page size, no sort/
 * filter/search — the endpoint's own defaults apply (deterministic order +
 * id tiebreak per the list contract).
 */
export function allPagesQueryString(page: number): string {
  return buildListQueryString({
    page,
    pageSize: 100,
    sort: null,
    order: "asc",
    search: "",
    filters: {},
  });
}

/**
 * Pages through a standardized list endpoint collecting every row — for
 * pickers/lookups that legitimately need the full set (spec 068 exempt
 * surfaces: slug→id lookups, form pickers, detail-page OwnedTables).
 * Requests `pageSize=100` chunks until `hasNext` is false; never used by
 * primary list pages (FR-002).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<Paginated<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchPage(page);
    rows.push(...res.data);
    if (!res.pagination?.hasNext) return rows;
  }
}
