import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { fetchAllPages, type ListQueryState } from "@/api/list-query";
import type { ComponentGroup, Paginated } from "@/api/types";

/** Spec 068 / ADR-130 sort whitelist for `GET /component-groups`. */
export const COMPONENT_GROUPS_SORT_KEYS = ["name", "lifecycle", "createdAt"] as const;
export type ComponentGroupsSortKey = (typeof COMPONENT_GROUPS_SORT_KEYS)[number];

/** URL filter keys managed by the /component-groups list page. */
export const COMPONENT_GROUPS_FILTER_KEYS = ["lifecycle"] as const;
export type ComponentGroupsFilterKey = (typeof COMPONENT_GROUPS_FILTER_KEYS)[number];

/**
 * Spec 068 / ADR-130: `/component-groups` returns the unified
 * `{data, pagination}` envelope. `lifecycle` filters to one lifecycle;
 * `includeRetired` admits RETIRED rows alongside ACTIVE (the "all" view).
 */
export interface ComponentGroupListParams {
  page?: number;
  pageSize?: number;
  sort?: ComponentGroupsSortKey;
  order?: "asc" | "desc";
  search?: string;
  lifecycle?: string;
  includeRetired?: boolean;
}

export type ComponentGroupListResponse = Paginated<ComponentGroup>;

/**
 * Adapts resolved `useListState` output to `/component-groups` params.
 * The URL `lifecycle` filter defaults to `ACTIVE` (retired groups stay
 * hidden unless requested — unchanged pre-068 behavior): `ACTIVE`/`RETIRED`
 * are sent verbatim (an explicit lifecycle overrides the default RETIRED
 * exclusion server-side), while `all` maps to `includeRetired=true` with no
 * lifecycle predicate.
 */
export function componentGroupsListParams(state: ListQueryState): ComponentGroupListParams {
  const lifecycle = state.filters.lifecycle;
  const concrete =
    lifecycle !== undefined && lifecycle !== "" && lifecycle !== "all"
      ? lifecycle
      : undefined;
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ComponentGroupsSortKey | null) ?? "name",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
    lifecycle: concrete,
    includeRetired: concrete === undefined ? true : undefined,
  };
}

function buildComponentGroupsQs(params: ComponentGroupListParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.search) search.set("search", params.search);
  if (params.lifecycle) search.set("lifecycle", params.lifecycle);
  if (params.includeRetired) search.set("includeRetired", "true");
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Paged list read — one page of the standardized envelope (spec 068). */
export function useComponentGroups(
  params: ComponentGroupListParams = {},
  enabled = true,
) {
  const qs = buildComponentGroupsQs(params);
  return useQuery({
    queryKey: ["component-groups", qs],
    queryFn: () => api<ComponentGroupListResponse>(`/component-groups${qs}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetch every matching group by paging through the list endpoint
 * (pageSize caps at 100) — for pickers/lookups that must offer the full
 * set (spec 068: pickers are exempt from the one-page standard).
 */
export function useAllComponentGroups(
  params: Omit<ComponentGroupListParams, "page" | "pageSize"> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["component-groups", "all", params],
    enabled,
    queryFn: () =>
      fetchAllPages((page) =>
        api<ComponentGroupListResponse>(
          `/component-groups${buildComponentGroupsQs({ ...params, page, pageSize: 100 })}`,
        ),
      ),
  });
}

export interface CreateComponentGroupInput {
  name: string;
  slug: string;
  description?: string;
  teamOwnerId?: string;
}

export interface UpdateComponentGroupInput {
  name?: string;
  slug?: string;
  /** Explicit null clears the field (bugfix 066). */
  description?: string | null;
  lifecycle?: string;
  /** Explicit null clears the owning team (bugfix 066). */
  teamOwnerId?: string | null;
}

export interface AssignComponentGroupInput {
  componentId: string;
  componentGroupId: string | null;
}

// Detail read accepts id-or-slug — the route slug resolves directly (spec 033).
export function useComponentGroup(idOrSlug: string | undefined) {
  return useQuery({
    queryKey: ["component-groups", "detail", idOrSlug],
    queryFn: () => api<{ group: ComponentGroup }>(`/component-groups/${idOrSlug}`),
    enabled: !!idOrSlug,
  });
}

export function useCreateComponentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateComponentGroupInput) =>
      api<{ group: ComponentGroup }>("/component-groups", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["component-groups"] });
    },
  });
}

export function useUpdateComponentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & UpdateComponentGroupInput) => {
      // id is the URL param — updateComponentGroupSchema is .strict() and rejects it.
      const { id, ...body } = vars;
      return api<{ group: ComponentGroup }>(`/component-groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["component-groups"] });
    },
  });
}

export function useDeleteComponentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/component-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["component-groups"] });
    },
  });
}

export function useAssignComponentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AssignComponentGroupInput) =>
      api<{ component: { componentGroupId: string | null } }>(
        `/components/${vars.componentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ componentGroupId: vars.componentGroupId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["components"] });
    },
  });
}
