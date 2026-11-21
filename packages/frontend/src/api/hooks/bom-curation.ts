import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AddToCatalogPreview,
  CurationResult,
  DependencyBulkResult,
  DependencySuggestion,
  DependencySuggestionGroupListResult,
  DependencySuggestionListResult,
  PackageVersionListItem,
  Paginated,
} from "@componode/core";
import { api } from "@/api/client";
import { buildApiQueryString } from "@/api/list-query";

/**
 * Spec 075 / ADR-132 — BOM catalog curation + dependency-suggestion
 * hooks. Reads are any-role `verifySession` GETs; writes are Editor-only
 * (`component:edge:add`) — the UI hides them from Viewers and the API
 * still enforces.
 */

/** `GET /packages/add-to-catalog/preview` — enabled only with a purl. */
export function useAddToCatalogPreview(purl: string | null) {
  return useQuery({
    queryKey: ["packages", "add-to-catalog-preview", purl],
    queryFn: () =>
      api<AddToCatalogPreview>(
        `/packages/add-to-catalog/preview${buildApiQueryString({ purl: purl ?? "" })}`,
      ),
    enabled: purl !== null,
  });
}

/** `GET /packages/versions` — every reported version for one identity. */
export function usePackageVersions(purl: string | null) {
  return useQuery({
    queryKey: ["packages", "versions", purl],
    queryFn: () =>
      api<Paginated<PackageVersionListItem>>(
        `/packages/versions${buildApiQueryString({ purl: purl ?? "", pageSize: 100 })}`,
      ),
    enabled: purl !== null,
    placeholderData: (prev) => prev,
  });
}

/**
 * Curation writes invalidate every surface the atomic result can touch:
 * the packages rollup, BOM lists, both suggestion queues, and component
 * reads (the created Library, `resolvedComponentId` repoints, edges).
 */
function invalidateCuration(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["packages"] });
  qc.invalidateQueries({ queryKey: ["component-bom"] });
  qc.invalidateQueries({ queryKey: ["suggestions"] });
  qc.invalidateQueries({ queryKey: ["components"] });
}

export function useAddToCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { purl: string; linkConsumers: boolean }) =>
      api<CurationResult>("/packages/add-to-catalog", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => invalidateCuration(qc),
  });
}

export function useLinkPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      purl: string;
      componentId: string;
      linkConsumers: boolean;
    }) =>
      api<CurationResult>("/packages/link", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => invalidateCuration(qc),
  });
}

// --- Dependency suggestions queue (kind=dependency) --------------------

/** API params accepted by `GET /suggestions` with `kind=dependency`. */
export interface DependencySuggestionsFilters {
  status?: "PENDING" | "DISMISSED" | "DECIDED";
  childComponentId?: string;
  page?: number;
  pageSize?: number;
  sort?: "score" | "createdAt" | "decidedAt" | "status";
  order?: "asc" | "desc";
}

/** Flat per-parent queue/decided rows (`GET /suggestions?kind=dependency`). */
export function useDependencySuggestions(
  params: DependencySuggestionsFilters = {},
  opts: { enabled?: boolean } = {},
) {
  const query = { kind: "dependency", status: "PENDING", ...params };
  return useQuery({
    queryKey: ["suggestions", "dependencies", query],
    queryFn: () =>
      api<DependencySuggestionListResult>(
        `/suggestions${buildApiQueryString(query)}`,
      ),
    placeholderData: (prev) => prev,
    enabled: opts.enabled ?? true,
  });
}

/** API params accepted by `GET /suggestions/dependencies/groups`. */
export interface DependencyGroupsFilters {
  sort?: "score" | "components" | "name";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  childComponentId?: string;
}

/** Pending suggestions grouped per library — the segment's default view. */
export function useDependencyGroups(params: DependencyGroupsFilters = {}) {
  const query = { sort: "score", order: "desc", ...params };
  return useQuery({
    queryKey: ["suggestions", "dependency-groups", query],
    queryFn: () =>
      api<DependencySuggestionGroupListResult>(
        `/suggestions/dependencies/groups${buildApiQueryString(query)}`,
      ),
    placeholderData: (prev) => prev,
  });
}

function invalidateDependencySuggestions(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["suggestions"] });
  qc.invalidateQueries({ queryKey: ["components"] });
  // `pendingSuggestionCount` on /packages rows changes with each decision.
  qc.invalidateQueries({ queryKey: ["packages"] });
}

export function useAcceptDependencySuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ suggestion: DependencySuggestion }>(
        `/suggestions/dependencies/${id}/accept`,
        { method: "POST" },
      ),
    onSuccess: () => invalidateDependencySuggestions(qc),
  });
}

export function useDismissDependencySuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ suggestion: DependencySuggestion }>(
        `/suggestions/dependencies/${id}/dismiss`,
        { method: "POST" },
      ),
    onSuccess: () => invalidateDependencySuggestions(qc),
  });
}

export function useBulkDecideDependencies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      childComponentId: string;
      action: "accept" | "dismiss";
    }) =>
      api<DependencyBulkResult>("/suggestions/dependencies/bulk", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => invalidateDependencySuggestions(qc),
  });
}
