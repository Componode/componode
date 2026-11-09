import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  buildApiQueryString,
  fetchAllPages,
  type ListQueryState,
} from "@/api/list-query";
import type { DockerTarget, Paginated } from "@/api/types";
import type { ProbeDockerTargetInput } from "@componode/core";

export type { ProbeDockerTargetInput };

/** Spec 068 / ADR-130 sort whitelist for `GET /docker-targets`
 *  (listDockerTargetsQuerySchema); `name` sorts by the label column. */
export const DOCKER_TARGETS_SORT_KEYS = ["name", "targetId", "enabled", "createdAt"] as const;
export type DockerTargetsSortKey = (typeof DOCKER_TARGETS_SORT_KEYS)[number];

/** API params accepted by `GET /docker-targets`. */
export interface DockerTargetsListFilters {
  page?: number;
  pageSize?: number;
  sort?: DockerTargetsSortKey;
  order?: "asc" | "desc";
  search?: string;
}

/**
 * Adapts resolved `useListState` output to `/docker-targets` API params
 * (spec 068). The endpoint has no filters — only page/pageSize/sort/order/
 * search.
 */
export function dockerTargetsListParams(
  state: ListQueryState,
): DockerTargetsListFilters {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as DockerTargetsSortKey | null) ?? "name",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
  };
}

/**
 * Primary paginated docker-targets list (`{data, pagination}` envelope).
 * Keep the current page visible while the next page/sort/filter loads.
 */
export function useDockerTargets(filters: DockerTargetsListFilters = {}) {
  return useQuery({
    queryKey: ["docker-targets", "list", filters],
    queryFn: () =>
      api<Paginated<DockerTarget>>(
        `/docker-targets${buildApiQueryString(filters)}`,
      ),
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetch every docker target by paging through the list endpoint (pageSize
 * caps at 100) — for pickers that legitimately need the full set (spec
 * 068 exempt surfaces: importer-config agent/target pickers).
 */
export function useAllDockerTargets(
  filters: DockerTargetsListFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["docker-targets", "all", filters],
    enabled,
    queryFn: () =>
      fetchAllPages((page) =>
        api<Paginated<DockerTarget>>(
          `/docker-targets${buildApiQueryString({ ...filters, page, pageSize: 100 })}`,
        ),
      ),
  });
}

export function useDockerTarget(id: string | undefined) {
  return useQuery({ queryKey: ["docker-targets", id], queryFn: () => api<{ target: DockerTarget }>(`/docker-targets/${id}`), enabled: Boolean(id) });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["docker-targets"] });

export function useCreateDockerTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { targetId: string; label: string; description?: string; profile: Record<string, unknown> }) =>
      api<{ target: DockerTarget }>("/docker-targets", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateDockerTarget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { label?: string; description?: string | null }) =>
      api<{ target: DockerTarget }>(`/docker-targets/${id}`, { method: "PATCH", body: JSON.stringify(v) }),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetDockerTargetEnabled(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api<{ target: DockerTarget }>(`/docker-targets/${id}/${enabled ? "enable" : "disable"}`, { method: "POST" }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteDockerTarget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>(`/docker-targets/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(qc),
  });
}

export function useTestDockerTarget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (configId?: string) => api<{ ok: boolean; error?: string }>(`/docker-targets/${id}/test`, { method: "POST", body: JSON.stringify(configId ? { configId } : {}) }),
    onSuccess: () => invalidate(qc),
  });
}

export function useProbeDockerTarget() {
  return useMutation({
    mutationFn: (v: ProbeDockerTargetInput) =>
      api<{ ok: boolean; error?: string }>("/docker-targets/probe", { method: "POST", body: JSON.stringify(v) }),
  });
}
