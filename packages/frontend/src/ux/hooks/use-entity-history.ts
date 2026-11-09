import {
  useActivityFeed,
  useEntityHistory,
  type ActivityFeedQuery,
  type AuditSortKey,
} from "@/api/hooks/audit";
import type { ListPaginationProps } from "@/ux/components/patterns/list-pagination";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useSubListState } from "@/ux/hooks/use-sub-list-state";

/**
 * Paged audit feeds for detail/history views (spec 068 review T065).
 *
 * Detail-page sub-lists are exempt from URL-backed state (same convention
 * as the run-detail errors/changes tables), so paging lives in local
 * `useSubListState`; the feed still gets the standard 25/50/100 pager via
 * the returned `pagination` props (spread into `ListPagination` or passed
 * to `EntityHistory`/detail components as `activityPagination`).
 *
 * Both hooks pin `sort: "createdAt"`, `order: "desc"` — the audit feeds
 * have no sort UI and the endpoint defaults are identical. The out-of-range
 * page clamp runs inside, so a shrunken feed can't strand the view on an
 * empty page.
 */

/** Feed result shape shared by the audit compatibility views. */
interface AuditPageData {
  total: number;
  pageCount: number;
}

function useAuditPaging() {
  const list = useSubListState<AuditSortKey>("createdAt");
  const paginationFor = (data: AuditPageData | undefined): ListPaginationProps | undefined =>
    data && data.total > 0
      ? {
          page: list.page,
          pageSize: list.pageSize,
          total: data.total,
          pageCount: data.pageCount,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }
      : undefined;
  return { list, paginationFor };
}

/**
 * `GET /audit/entities/:entityType/:entityId` with pager state — replaces
 * the old fixed `pageSize: 100` window that silently truncated history.
 */
export function usePagedEntityHistory(entityType: string, entityId: string) {
  const { list, paginationFor } = useAuditPaging();
  const query = useEntityHistory(entityType, entityId, {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort ?? "createdAt",
    order: list.order,
  });
  useClampPage({ page: list.page, setPage: list.setPage }, query.data);
  return { ...query, pagination: paginationFor(query.data) };
}

/**
 * `GET /audit/activity` with pager state — for detail surfaces that show a
 * filtered feed slice (e.g. the per-user activity tab).
 */
export function usePagedActivityFeed(
  query: Omit<ActivityFeedQuery, "page" | "pageSize" | "sort" | "order">,
) {
  const { list, paginationFor } = useAuditPaging();
  const result = useActivityFeed({
    ...query,
    page: list.page,
    pageSize: list.pageSize,
    sort: "createdAt",
    order: "desc",
  });
  useClampPage({ page: list.page, setPage: list.setPage }, result.data);
  return { ...result, pagination: paginationFor(result.data) };
}
