import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { buildApiQueryString, facetParam, type ListQueryState } from "@/api/list-query";
import type { Paginated } from "@/api/types";
import type { ActivityFeedItem, EntityChange } from "@componode/core";

/**
 * Spec 068 / ADR-130: the audit reads migrated to the standardized
 * `{data, pagination}` envelope (`limit`/`offset` → `page`/`pageSize`).
 * Hooks keep a compatibility view — `items` + flat pagination fields — so
 * existing detail-page consumers (`EntityHistory`, dashboard widgets,
 * per-user activity) keep working unchanged.
 */
export interface AuditFeedResult {
  items: ActivityFeedItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNext: boolean;
}

const toFeedResult = (res: Paginated<ActivityFeedItem>): AuditFeedResult => ({
  items: res.data,
  total: res.pagination.total,
  page: res.pagination.page,
  pageSize: res.pagination.pageSize,
  pageCount: res.pagination.pageCount,
  hasNext: res.pagination.hasNext,
});

/**
 * Query params accepted by `GET /audit/activity` and
 * `GET /audit/entities/:entityType/:entityId` — the spec-068
 * `page`/`pageSize` contract only (spec 069 dropped the pre-068
 * `limit`/`offset` spellings).
 */
export interface ActivityFeedQuery {
  kind?: "entity" | "edge";
  entityType?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: "createdAt" | "action" | "actor" | "kind" | "entityType";
  order?: "asc" | "desc";
}

/** Sort whitelist for the audit feed (activityFeedQuerySchema). */
export const AUDIT_SORT_KEYS = [
  "createdAt",
  "action",
  "actor",
  "kind",
  "entityType",
] as const;
export type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];

/** URL filter keys managed by the /activity list page (useListState). */
export const ACTIVITY_FILTER_KEYS = [
  "kind",
  "entityType",
  "action",
  "actor",
  "from",
  "to",
] as const;
export type ActivityFilterKey = (typeof ACTIVITY_FILTER_KEYS)[number];

/**
 * The activity page stores `from`/`to` as `datetime-local` strings in the
 * URL; the API schema requires ISO datetimes (`z.string().datetime()`), so
 * the adapter converts — unparseable hand-edits degrade to "unset".
 */
const isoDateParam = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/**
 * Adapts resolved `useListState` output to `/audit/activity` API params
 * (spec 068). `"all"`-sentinel filters are omitted; `from`/`to` arrive as
 * `datetime-local` strings and are converted to ISO here.
 */
export function activityFeedParams(state: ListQueryState): ActivityFeedQuery {
  return {
    kind: facetParam(state, "kind") as "entity" | "edge" | undefined,
    entityType: facetParam(state, "entityType"),
    action: facetParam(state, "action"),
    actor: facetParam(state, "actor"),
    from: isoDateParam(facetParam(state, "from")),
    to: isoDateParam(facetParam(state, "to")),
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as AuditSortKey | null) ?? undefined,
    order: state.order,
  };
}

export function useActivityFeed(query: ActivityFeedQuery = {}) {
  return useQuery<AuditFeedResult>({
    queryKey: ["audit", "activity", query],
    queryFn: async () =>
      toFeedResult(
        await api<Paginated<ActivityFeedItem>>(
          `/audit/activity${buildApiQueryString(query)}`,
        ),
      ),
    placeholderData: (prev) => prev,
  });
}

export function useEntityHistory(
  entityType: string,
  entityId: string,
  query: Omit<ActivityFeedQuery, "entityType"> = {},
) {
  // Detail sub-lists are exempt from primary-list pagination (spec 068) —
  // the default is one standard pager page; callers that render a pager
  // (usePagedEntityHistory) pass explicit page/pageSize. The pre-T065
  // fixed 100-row window silently truncated longer histories.
  const normalized = { pageSize: 25, ...query };
  return useQuery<AuditFeedResult>({
    queryKey: ["audit", "history", entityType, entityId, normalized],
    queryFn: async () =>
      toFeedResult(
        await api<Paginated<ActivityFeedItem>>(
          `/audit/entities/${entityType}/${entityId}${buildApiQueryString(normalized)}`,
        ),
      ),
    enabled: !!entityType && !!entityId,
    placeholderData: (prev) => prev,
  });
}

/** Spec 068 / ADR-130 sort whitelist for
 *  `GET /importer-configs/:configId/runs/:runId/changes`
 *  (listRunChangesQuerySchema) — the stored columns behind the changes
 *  table's Type/Action/Actor/Time cells (FR-005). */
export const RUN_CHANGES_SORT_KEYS = [
  "createdAt",
  "action",
  "entityType",
  "actor",
] as const;
export type RunChangesSortKey = (typeof RUN_CHANGES_SORT_KEYS)[number];

/**
 * API params accepted by
 * `GET /importer-configs/:configId/runs/:runId/changes` (spec 068):
 * `action` is the change-type filter; `sort`/`order` drive the
 * stored-column sorts. No `search` param (T061).
 */
export interface RunChangesListParams {
  page?: number;
  pageSize?: number;
  sort?: RunChangesSortKey;
  order?: "asc" | "desc";
  action?: string;
}

export function useRunChanges(
  configId: string,
  runId: string,
  params: RunChangesListParams = {},
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ["importer", "run", configId, runId, "changes", params],
    queryFn: async () =>
      api<Paginated<EntityChange>>(
        `/importer-configs/${configId}/runs/${runId}/changes${buildApiQueryString(params)}`,
      ),
    enabled: !!configId && !!runId,
    refetchInterval: options?.refetchInterval ?? false,
    placeholderData: (prev) => prev,
  });
}
