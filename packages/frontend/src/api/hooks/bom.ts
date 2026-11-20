import { useQuery } from "@tanstack/react-query";
import type {
  BomEntryListItem,
  BomSummary,
  Paginated,
} from "@componode/core";
import { api } from "@/api/client";
import { buildApiQueryString } from "@/api/list-query";

/**
 * BOM read hooks (spec 073, contracts/bom-api.md). The tab's URL `q`
 * maps to the API's `search` param — every other filter key is already
 * API-shaped (scope/ecosystem/found carry CSV, `depth` is adapted to
 * `direct` by the caller).
 */
export interface BomListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: "asc" | "desc";
  search?: string;
  scope?: string;
  ecosystem?: string;
  found?: string;
  direct?: boolean;
  catalog?: string;
  instanceId?: string;
  view?: "flat" | "tree";
  parentId?: string;
}

export type BomPage = Paginated<BomEntryListItem>;

export function useBomList(
  componentId: string | null,
  params: BomListParams = {},
) {
  return useQuery({
    queryKey: ["component-bom", componentId, params],
    queryFn: () =>
      api<BomPage>(`/components/${componentId}/bom${buildApiQueryString(params)}`),
    enabled: componentId !== null,
    // Keep the current page visible while the next filter/sort/page loads
    // (docs/ux.md §6 refetch row — UX-STATE refetching).
    placeholderData: (prev) => prev,
  });
}

export function useBomSummary(
  componentId: string | null,
  instanceId?: string,
) {
  return useQuery({
    queryKey: ["component-bom-summary", componentId, instanceId ?? null],
    queryFn: () =>
      api<BomSummary>(
        `/components/${componentId}/bom/summary${buildApiQueryString({ instanceId })}`,
      ),
    enabled: componentId !== null,
    placeholderData: (prev) => prev,
  });
}

/**
 * Lazy children for the tree view (UX-BOM-12): direct children of one
 * entry, 50 per page. Called imperatively by the tree-grid on expand —
 * the expanded set is client-only state, so this is not a query hook.
 */
export async function fetchBomChildren(
  componentId: string,
  parentId: string,
  page = 1,
): Promise<BomPage> {
  return api<BomPage>(
    `/components/${componentId}/bom${buildApiQueryString({
      parentId,
      page,
      pageSize: 50,
    })}`,
  );
}

/**
 * Download href for the streamed export endpoint (US4). The browser
 * navigates straight to it — Content-Disposition sets the filename
 * (UX-EXP-04); session cookies ride along (`same-origin` default).
 */
export function bomExportUrl(
  componentId: string,
  format: "json" | "cyclonedx" | "spdx",
  instanceId?: string,
): string {
  return `/api/v1/components/${componentId}/bom/export${buildApiQueryString({
    format,
    instanceId,
  })}`;
}
