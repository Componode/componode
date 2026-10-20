import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type {
  ComponentWithInstances,
  ComponentGroup,
  ComponentListResponse,
  ComponentDependent,
  PlatformCandidate,
  PromoteToPlatformInput,
  PromoteToPlatformResult,
} from "@/api/types";

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
  sort?: "name" | "lastSeenAt" | "createdAt";
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

export function useComponents(filters: ComponentListFilters = {}) {
  return useQuery({
    queryKey: ["components", filters],
    queryFn: () =>
      api<ComponentListResponse>(`/components${buildQueryString(filters)}`),
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
    queryFn: async () => {
      const all: ComponentListResponse["data"] = [];
      for (let page = 1; ; page++) {
        const res = await api<ComponentListResponse>(
          `/components${buildQueryString({ ...filters, page, pageSize: 100 })}`,
        );
        all.push(...res.data);
        if (!res.pagination?.hasNext) return all;
      }
    },
  });
}

export function useComponentGroups() {
  return useQuery({
    queryKey: ["component-groups"],
    queryFn: () => api<{ groups: ComponentGroup[] }>("/component-groups"),
  });
}

export function useComponentDetail(id: string | null) {
  return useQuery({
    queryKey: ["components", id],
    queryFn: () => api<{ component: ComponentWithInstances }>(`/components/${id}`),
    enabled: id !== null,
  });
}

export function useUpdateComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & Record<string, unknown>) =>
      api<{ component: unknown }>(`/components/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["components"] });
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
      api<PromoteToPlatformResult>(`/components/${vars.id}/promote-to-platform`, {
        method: "POST",
        body: JSON.stringify(vars.input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-candidates"] });
      qc.invalidateQueries({ queryKey: ["component-dependents"] });
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    },
  });
}
