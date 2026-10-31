import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { ComponentGroup } from "@/api/types";

export interface CreateComponentGroupInput {
  name: string;
  slug: string;
  description?: string;
  teamOwnerId?: string;
}

export interface UpdateComponentGroupInput {
  name?: string;
  slug?: string;
  description?: string;
  lifecycle?: string;
  teamOwnerId?: string;
}

export interface AssignComponentGroupInput {
  componentId: string;
  componentGroupId: string | null;
}

export function useComponentGroups(opts: { includeRetired?: boolean } | boolean = {}) {
  const includeRetired = typeof opts === "boolean" ? false : !!opts.includeRetired;
  const enabled = typeof opts === "boolean" ? opts : true;
  return useQuery({
    queryKey: ["component-groups", { includeRetired }],
    queryFn: () =>
      api<{ groups: ComponentGroup[] }>(`/component-groups${includeRetired ? "?includeRetired=true" : ""}`),
    enabled,
  });
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
