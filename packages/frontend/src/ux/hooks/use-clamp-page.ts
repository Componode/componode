import { useEffect } from "react";

/**
 * Minimal pagination meta the clamp needs — satisfied by both
 * `Paginated<T>.pagination` (`PaginationMeta`) and the audit/suggestions
 * compatibility views that flatten the envelope (`{items,total,pageCount,…}`).
 */
export interface PageClampMeta {
  total: number;
  pageCount: number;
}

/**
 * Corrects an out-of-range `?page=` once the list query resolves (spec 068
 * review T064). A stale URL or a shrunken result set must not leave an
 * empty table on screen while `ListPagination` clamps its own display:
 *
 * – `page > pageCount` with `total > 0` → `setPage(pageCount)` rewrites
 *   the URL param (replace nav — other params preserved, canonical link).
 * – `total === 0` → `page` resets to 1 so the URL stays canonical; page 1
 *   is a fixed point, so the effect cannot loop.
 * – `pagination` unresolved (`undefined`) → no-op; the clamp only fires
 *   on real server metadata, never on placeholder guesses.
 *
 * `setPage` may come from `useListState` (URL-backed) or a local
 * `useSubListState` — both accept a 1-based target page.
 */
export function useClampPage(
  list: { page: number; setPage: (page: number) => void },
  pagination: PageClampMeta | null | undefined,
): void {
  const { page, setPage } = list;
  const total = pagination?.total;
  const pageCount = pagination?.pageCount;
  useEffect(() => {
    if (total === undefined || pageCount === undefined) return;
    if (total === 0) {
      if (page > 1) setPage(1);
      return;
    }
    if (page > pageCount) setPage(pageCount);
  }, [page, total, pageCount, setPage]);
}
