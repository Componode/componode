import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LIST_PAGE_SIZE_OPTIONS,
  type ListQueryDefaults,
  type ListSortOrder,
} from "@/api/list-query";

/**
 * URL-backed table state for primary list pages (spec 068 / ADR-130).
 *
 * URL param names are deliberately short — `page`, `size`, `sort`,
 * `order`, `q`, plus one param per declared filter — while the resolved
 * state uses API names (`pageSize`, `search`). `buildListQueryString`
 * performs the mapping when calling the API.
 *
 * Rules (data-model.md "Table State"):
 * – Missing or invalid values resolve to the declared defaults — a GET
 *   list page never surfaces a 400 for hand-edited params.
 * – Changing search, a filter, sort, order, or page size resets `page`
 *   to 1; `setPage` preserves everything else.
 * – Values equal to their default are removed from the URL so links stay
 *   canonical; unrelated params (`?tab=`, `?incomplete=1`, …) are
 *   preserved.
 * – All writes use `replace` navigation (same convention as
 *   `useValidatedTab`) so list interactions don't stack history entries.
 *
 * React Router caveat this hook works around: `setSearchParams` computes
 * functional updates from the `searchParams` snapshot of the last render,
 * so several setter calls inside one event (e.g. ListToolbar's Clear,
 * which resets the query and every filter) would otherwise overwrite each
 * other. `pendingRef` accumulates same-tick writes into one param set and
 * is dropped once the router confirms them, so composed writes always see
 * the latest pending state.
 */

export const LIST_SEARCH_MAX_LENGTH = 100; // mirrors the backend `search` cap

const PAGE_PARAM = "page";
const SIZE_PARAM = "size";
const SORT_PARAM = "sort";
const ORDER_PARAM = "order";
const SEARCH_PARAM = "q";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

/** Per-filter URL/state contract. */
export interface ListFilterConfig {
  /**
   * "Unset" sentinel — missing, empty, or invalid URL values resolve to
   * it, `setFilter(key, default)` removes the param, and it is the value
   * `reset` restores. Must be non-empty: Radix `Select.Item` rejects empty
   * values, so pick a domain-native sentinel (e.g. `"all"`, `"hide"`).
   */
  default: string;
  /** Whitelist of URL-legal values; anything else resolves to `default`. */
  values?: readonly string[];
  /**
   * Custom validator for open domains (e.g. CSV facets like
   * `?status=a,b`); takes precedence over `values` when both are set.
   */
  isValid?: (value: string) => boolean;
}

export interface ListStateConfig<S extends string = string, F extends string = string> {
  /** Endpoint sort whitelist — empty/absent disables sorting (`sort` stays null). */
  sortKeys?: readonly S[];
  /**
   * Sort applied when `?sort=` is missing or invalid. Defaults to the
   * first `sortKeys` entry; pass `null` for an unsorted-by-default list.
   */
  defaultSort?: S | null;
  /** Direction applied when `?order=` is missing or invalid (default `"asc"`). */
  defaultOrder?: ListSortOrder;
  /** Page sizes the UI may request — must contain `defaultPageSize`. */
  pageSizes?: readonly number[];
  defaultPageSize?: number;
  /** URL-param-backed filters; the key is the param name (and API param name). */
  filters?: { [K in F]: ListFilterConfig };
}

export interface ListState<S extends string = string, F extends string = string> {
  page: number;
  pageSize: number;
  /** Resolved sort key, or null when the list sorts by nothing. */
  sort: S | null;
  order: ListSortOrder;
  /** Search text from `?q=` (capped at LIST_SEARCH_MAX_LENGTH). */
  search: string;
  /** Resolved value per declared filter key. */
  filters: Record<F, string>;
  /** Resolved defaults — pass to `buildListQueryString` (or rely on its auto-detect). */
  defaults: ListQueryDefaults;
  /** Jump to a page; preserves all other state. */
  setPage: (page: number) => void;
  /** Change rows-per-page; invalid sizes fall back to the default. Resets page. */
  setPageSize: (pageSize: number) => void;
  /**
   * Set the sort column. `null`/invalid clears back to `defaultSort`.
   * Pass `order` to set the direction in the same write; omit it to keep
   * the current direction. Resets page.
   */
  setSort: (sort: S | null, order?: ListSortOrder) => void;
  /** Set sort direction; keeps the current sort column. Resets page. */
  setOrder: (order: ListSortOrder) => void;
  /** Set search text (truncated to the API cap). Resets page. */
  setSearch: (search: string) => void;
  /** Set one filter; invalid values coerce to its default. Resets page. */
  setFilter: (key: F, value: string) => void;
  /** Clear every managed param back to defaults (preserves unrelated params). */
  reset: () => void;
}

function parsePositiveInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function isValidFilterValue(fc: ListFilterConfig, value: string): boolean {
  if (fc.isValid) return fc.isValid(value);
  if (fc.values) return fc.values.includes(value);
  return value !== "";
}

export function useListState<S extends string = string, F extends string = string>(
  config: ListStateConfig<S, F> = {},
): ListState<S, F> {
  const [searchParams, setSearchParams] = useSearchParams();

  // Same-tick write overlay — see the module docstring. `null` means "seed
  // from the router snapshot"; once the router re-renders with our params
  // the effect below clears it so later writes re-sync with external nav.
  const pendingRef = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    pendingRef.current = null;
  }, [searchParams]);

  const applyUpdates = (mutate: (next: URLSearchParams) => void) => {
    if (pendingRef.current === null) {
      pendingRef.current = new URLSearchParams(searchParams);
    }
    mutate(pendingRef.current);
    // Navigate on every call: same-tick callers keep accumulating into
    // pendingRef, and the last navigate carries the complete param set.
    setSearchParams(pendingRef.current, { replace: true });
  };

  // --- resolve -----------------------------------------------------------

  const sortKeys = config.sortKeys ?? [];
  const pageSizes: readonly number[] = config.pageSizes ?? LIST_PAGE_SIZE_OPTIONS;
  const defaultPageSize =
    config.defaultPageSize !== undefined && pageSizes.includes(config.defaultPageSize)
      ? config.defaultPageSize
      : (pageSizes[0] ?? DEFAULT_PAGE_SIZE);

  const configuredDefaultSort =
    config.defaultSort !== undefined ? config.defaultSort : (sortKeys[0] ?? null);
  const defaultSort =
    configuredDefaultSort !== null && !(sortKeys as readonly string[]).includes(configuredDefaultSort)
      ? (sortKeys[0] ?? null)
      : configuredDefaultSort;

  const defaultOrder: ListSortOrder = config.defaultOrder === "desc" ? "desc" : "asc";

  const page = parsePositiveInt(searchParams.get(PAGE_PARAM)) ?? DEFAULT_PAGE;

  const sizeParam = parsePositiveInt(searchParams.get(SIZE_PARAM));
  const pageSize =
    sizeParam !== null && pageSizes.includes(sizeParam) ? sizeParam : defaultPageSize;

  const sortParam = searchParams.get(SORT_PARAM);
  const sort =
    sortKeys.length > 0 && sortParam !== null && (sortKeys as readonly string[]).includes(sortParam)
      ? (sortParam as S)
      : defaultSort;

  const orderParam = searchParams.get(ORDER_PARAM);
  const order: ListSortOrder =
    orderParam === "asc" || orderParam === "desc" ? orderParam : defaultOrder;

  const search = (searchParams.get(SEARCH_PARAM) ?? "").slice(0, LIST_SEARCH_MAX_LENGTH);

  // Partial view for safe runtime access — typed callers always declare
  // every filter, but a missing entry must degrade, not throw.
  const filtersConfig = (config.filters ?? {}) as { [K in F]?: ListFilterConfig };
  const filters = {} as Record<F, string>;
  const filterDefaults: Record<string, string> = {};
  for (const key of Object.keys(filtersConfig) as F[]) {
    const fc = filtersConfig[key];
    if (!fc) continue;
    const raw = searchParams.get(key);
    let value = fc.default;
    if (raw !== null && raw !== "" && isValidFilterValue(fc, raw)) {
      value = raw;
    }
    filters[key] = value;
    filterDefaults[key] = fc.default;
  }

  const defaults: ListQueryDefaults = {
    page: DEFAULT_PAGE,
    pageSize: defaultPageSize,
    sort: defaultSort,
    order: defaultOrder,
    search: "",
    filters: filterDefaults,
  };

  // --- writers -----------------------------------------------------------

  const resetPage = (next: URLSearchParams) => next.delete(PAGE_PARAM);

  const setPage = (target: number) => {
    applyUpdates((next) => {
      const p = Number.isInteger(target) && target >= 1 ? target : DEFAULT_PAGE;
      if (p <= DEFAULT_PAGE) next.delete(PAGE_PARAM);
      else next.set(PAGE_PARAM, String(p));
    });
  };

  const setPageSize = (size: number) => {
    applyUpdates((next) => {
      resetPage(next);
      const valid = pageSizes.includes(size) ? size : defaultPageSize;
      if (valid === defaultPageSize) next.delete(SIZE_PARAM);
      else next.set(SIZE_PARAM, String(valid));
    });
  };

  const setSort = (target: S | null, order?: ListSortOrder) => {
    applyUpdates((next) => {
      resetPage(next);
      const resolved =
        target !== null && (sortKeys as readonly string[]).includes(target) ? target : null;
      const effective = resolved ?? defaultSort;
      if (effective === null || effective === defaultSort) next.delete(SORT_PARAM);
      else next.set(SORT_PARAM, effective);
      if (order !== undefined) {
        const validOrder = order === "desc" ? "desc" : "asc";
        if (validOrder === defaultOrder) next.delete(ORDER_PARAM);
        else next.set(ORDER_PARAM, validOrder);
      }
    });
  };

  const setOrder = (target: ListSortOrder) => {
    applyUpdates((next) => {
      resetPage(next);
      const valid = target === "desc" ? "desc" : "asc";
      if (valid === defaultOrder) next.delete(ORDER_PARAM);
      else next.set(ORDER_PARAM, valid);
    });
  };

  const setSearch = (value: string) => {
    applyUpdates((next) => {
      resetPage(next);
      const q = value.slice(0, LIST_SEARCH_MAX_LENGTH);
      if (q === "") next.delete(SEARCH_PARAM);
      else next.set(SEARCH_PARAM, q);
    });
  };

  const setFilter = (key: F, value: string) => {
    const fc = filtersConfig[key];
    if (!fc) return;
    applyUpdates((next) => {
      resetPage(next);
      const coerced = value === "" ? fc.default : value;
      const valid = isValidFilterValue(fc, coerced) ? coerced : fc.default;
      if (valid === fc.default) next.delete(key);
      else next.set(key, valid);
    });
  };

  const reset = () => {
    applyUpdates((next) => {
      next.delete(PAGE_PARAM);
      next.delete(SIZE_PARAM);
      next.delete(SORT_PARAM);
      next.delete(ORDER_PARAM);
      next.delete(SEARCH_PARAM);
      for (const key of Object.keys(filtersConfig)) next.delete(key);
    });
  };

  return {
    page,
    pageSize,
    sort,
    order,
    search,
    filters,
    defaults,
    setPage,
    setPageSize,
    setSort,
    setOrder,
    setSearch,
    setFilter,
    reset,
  };
}
