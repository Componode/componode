import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateComponentInput,
  CreateInstanceBlock,
} from "@componode/core";
import { api } from "@/api/client";
import { fetchAllPages, type ListQueryState } from "@/api/list-query";
import type {
  Component,
  ComponentInstance,
  ComponentWithInstances,
  ComponentListResponse,
  ComponentDependent,
  ComponentRelationshipsResponse,
  PlatformCandidate,
  PromoteToPlatformInput,
  PromoteToPlatformResult,
} from "@/api/types";

/** Spec 068 / ADR-130 sort whitelist for `GET /components` (contract doc). */
export const COMPONENTS_SORT_KEYS = [
  "name",
  "category",
  "resourceType",
  "owner",
  "health",
  "instances",
  "lastSeenAt",
] as const;
export type ComponentsSortKey = (typeof COMPONENTS_SORT_KEYS)[number];

/** URL filter keys managed by the /components list page (useListState). */
export const COMPONENTS_FILTER_KEYS = [
  "provider",
  "category",
  "lifecycle",
  "wired",
  "gone",
] as const;
export type ComponentsFilterKey = (typeof COMPONENTS_FILTER_KEYS)[number];

export interface ComponentListFilters {
  page?: number;
  pageSize?: number;
  category?: string;
  provider?: string;
  lifecycle?: string;
  status?: string;
  group?: string;
  /** Spec 023: coverage filter — CSV of "wired"/"unwired". */
  wired?: string;
  tag?: string;
  search?: string;
  includeRetired?: boolean;
  includeGone?: boolean;
  sort?: ComponentsSortKey;
  order?: "asc" | "desc";
}

function buildQueryString(filters: ComponentListFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Adapts resolved `useListState` output to `/components` API params
 * (spec 068). URL filter sentinels map to API values: `gone=hide|show` →
 * `includeGone=false|true`; `"all"`-sentinel filters are omitted. The page
 * always sends `includeRetired=true` so RETIRED rows stay reachable via
 * the lifecycle filter/badge (unchanged pre-068 behavior).
 */
export function componentsListParams(state: ListQueryState): ComponentListFilters {
  const f = state.filters;
  const facet = (key: string) => {
    const v = f[key];
    return v !== undefined && v !== "" && v !== "all" ? v : undefined;
  };
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ComponentsSortKey | null) ?? "name",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
    provider: facet("provider"),
    category: facet("category"),
    lifecycle: facet("lifecycle"),
    wired: facet("wired"),
    includeRetired: true,
    includeGone: f.gone === "show",
  };
}

export function useComponents(filters: ComponentListFilters = {}) {
  return useQuery({
    queryKey: ["components", filters],
    queryFn: () =>
      api<ComponentListResponse>(`/components${buildQueryString(filters)}`),
    // Keep the current page visible while the next page/sort/filter loads
    // (docs/ux.md §6 refetch row; spec 068 gradual consumption).
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetch every matching component by paging through the list endpoint
 * (pageSize caps at 100) — for pickers that must offer the full set.
 */
export function useAllComponents(
  filters: ComponentListFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["components", "all", filters],
    enabled,
    queryFn: () =>
      fetchAllPages((page) =>
        api<ComponentListResponse>(
          `/components${buildQueryString({ ...filters, page, pageSize: 100 })}`,
        ),
      ),
  });
}

export function useComponentDetail(id: string | null) {
  return useQuery({
    queryKey: ["components", id],
    queryFn: () =>
      api<{ component: ComponentWithInstances }>(`/components/${id}`),
    enabled: id !== null,
  });
}

/** Spec 060: one-hop typed relationships for the read-only Relationships tab. */
export function useComponentRelationships(
  id: string | null,
  options: { includeGone?: boolean } = {},
) {
  const includeGone = options.includeGone ?? false;
  return useQuery({
    queryKey: ["component-relationships", id, includeGone],
    queryFn: () =>
      api<ComponentRelationshipsResponse>(
        `/components/${id}/relationships${includeGone ? "?includeGone=true" : ""}`,
      ),
    enabled: id !== null,
  });
}

export function useUpdateComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & Record<string, unknown>) => {
      // id is the URL param — updateComponentSchema is .strict() and rejects it.
      const { id, ...body } = vars;
      return api<{ component: unknown }>(`/components/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["components"] });
    },
  });
}

/** Manual component creation (spec 042, G29) — re-exports the core schema type. */
export type { CreateComponentInput };

export function useCreateComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateComponentInput) =>
      api<{ component: Component }>("/components", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Manual first-instance recovery (spec 054) for a zero-instance component. */
export function useCreateComponentInstance(componentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInstanceBlock) =>
      api<{ instance: ComponentInstance }>(
        `/components/${componentId}/instances`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** ADR-017 detection: components depended on by ≥2 active products. */
export function usePlatformCandidates() {
  return useQuery({
    queryKey: ["platform-candidates"],
    queryFn: () =>
      api<{ candidates: PlatformCandidate[] }>(
        "/components/platform-candidates",
      ),
    select: (d) => d.candidates,
  });
}

/** Active products with a direct DEPENDS_ON edge on the component. */
export function useComponentDependents(id: string | null) {
  return useQuery({
    queryKey: ["component-dependents", id],
    queryFn: () =>
      api<{ dependents: ComponentDependent[] }>(`/components/${id}/dependents`),
    enabled: id !== null,
    select: (d) => d.dependents,
  });
}

export function usePromoteComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: PromoteToPlatformInput }) =>
      api<PromoteToPlatformResult>(
        `/components/${vars.id}/promote-to-platform`,
        {
          method: "POST",
          body: JSON.stringify(vars.input),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-candidates"] });
      qc.invalidateQueries({ queryKey: ["component-dependents"] });
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    },
  });
}
