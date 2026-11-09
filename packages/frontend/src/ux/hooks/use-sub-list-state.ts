import { useState } from "react";

/**
 * Local (non-URL) list state for detail-page sub-lists — spec 068 exempts
 * detail-page sublists from URL-backed state; they still get server-side
 * pagination, sorting, ordering, and the contract's filters. `sort: null`
 * means "endpoint default" (each sub-list passes its own default key).
 *
 * Shared by the run-detail errors/changes tables and the paged audit
 * feeds (entity history, per-user activity) so every detail sub-list
 * resets to page 1 on sort/order/page-size changes (spec 068 review T065).
 */
export function useSubListState<S extends string>(defaultSort: S) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<S | null>(defaultSort);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const resetPage = () => setPage(1);
  return {
    page,
    pageSize,
    sort,
    order,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size);
      resetPage();
    },
    setOrder: (o: "asc" | "desc") => {
      setOrder(o);
      resetPage();
    },
    setSort: (s: S | null, o: "asc" | "desc") => {
      setSort(s);
      setOrder(o);
      resetPage();
    },
    resetPage,
  };
}
