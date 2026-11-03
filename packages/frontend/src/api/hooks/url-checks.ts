import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateComponentInput,
  CreateInstanceBlock,
  MonitoringSetup,
  UpdateMonitoringSetupInput,
  UrlCheck,
  UrlCheckListItem,
  UrlCheckMetrics,
  UrlCheckObservation,
  UrlCheckWindowParam,
} from "@componode/core";
import { api, type ApiError } from "@/api/client";
import type { Component, ComponentInstance } from "@/api/types";

export interface UrlCheckListResult {
  setup: MonitoringSetup | null;
  checks: UrlCheckListItem[];
}

export interface UrlCheckObservationsPage {
  observations: UrlCheckObservation[];
  nextBefore: string | null;
}

export interface CreateComponentWithMonitoringResult {
  component: Component;
  instance?: ComponentInstance;
  setup?: MonitoringSetup;
  checks?: UrlCheck[];
}

/** GET /components/:id/monitoring-setup — 404 maps to { setup: null }. */
export function useMonitoringSetup(componentId: string | null) {
  return useQuery({
    queryKey: ["monitoring-setup", componentId],
    enabled: componentId !== null,
    queryFn: async (): Promise<{ setup: MonitoringSetup | null }> => {
      try {
        return await api<{ setup: MonitoringSetup }>(
          `/components/${componentId}/monitoring-setup`,
        );
      } catch (err) {
        if ((err as ApiError).code === "MONITORING_SETUP_NOT_FOUND") {
          return { setup: null };
        }
        throw err;
      }
    },
  });
}

export function useUpdateMonitoringSetup(componentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateMonitoringSetupInput) =>
      api<{ setup: MonitoringSetup }>(
        `/components/${componentId}/monitoring-setup`,
        { method: "PUT", body: JSON.stringify(vars) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring-setup", componentId] });
      // The checks list embeds the setup.
      qc.invalidateQueries({ queryKey: ["url-checks"] });
    },
  });
}

/** GET /components/:id/url-checks — one round trip returns setup + checks with `latest`. */
export function useUrlChecks(componentId: string | null) {
  return useQuery({
    queryKey: ["url-checks", "component", componentId],
    enabled: componentId !== null,
    queryFn: () =>
      api<UrlCheckListResult>(`/components/${componentId}/url-checks`),
  });
}

export function useUrlCheck(id: string | null) {
  return useQuery({
    queryKey: ["url-checks", id],
    enabled: id !== null,
    queryFn: () => api<{ check: UrlCheck }>(`/url-checks/${id}`),
  });
}

export function useUrlCheckMetrics(
  id: string | null,
  window: UrlCheckWindowParam,
) {
  return useQuery({
    queryKey: ["url-checks", id, "metrics", window],
    enabled: id !== null,
    queryFn: () =>
      api<UrlCheckMetrics>(`/url-checks/${id}/metrics?window=${window}`),
  });
}

/**
 * Cursor-paginated observation history (desc by scheduledAt). Pages are
 * flattened by the consumer: `data.pages.flatMap(p => p.observations)`;
 * `fetchNextPage`/`hasNextPage` drive the "Load more" control.
 */
export function useUrlCheckObservations(id: string | null, limit = 25) {
  return useInfiniteQuery({
    queryKey: ["url-checks", id, "observations", limit],
    enabled: id !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (pageParam) qs.set("before", pageParam);
      return api<UrlCheckObservationsPage>(
        `/url-checks/${id}/observations?${qs.toString()}`,
      );
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

/**
 * Composite create (spec 051 US5): component + first instance in one
 * POST /components transaction — the monitoring block is retired (spec 058).
 */
export interface CreateComponentWithMonitoringInput
  extends CreateComponentInput {
  instance?: CreateInstanceBlock;
}

export function useCreateComponentWithMonitoring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateComponentWithMonitoringInput) =>
      api<CreateComponentWithMonitoringResult>("/components", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["url-checks"] });
    },
  });
}
