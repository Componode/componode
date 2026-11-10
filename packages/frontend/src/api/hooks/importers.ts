import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  buildApiQueryString,
  facetParam,
  fetchAllPages,
  type ListQueryState,
} from "@/api/list-query";
import type { Paginated } from "@/api/types";
import type {
  ImporterManifest,
  ImporterConfig,
  ImportRun,
  ImportRunError,
} from "@/api/types";

export function useImporters() {
  return useQuery({
    queryKey: ["importers"],
    queryFn: () => api<{ importers: ImporterManifest[] }>("/importers"),
  });
}

/** Spec 068 / ADR-130 sort whitelist for `GET /importer-configs`
 *  (listImporterConfigsQuerySchema); `name` sorts by the `label` column. */
export const IMPORTER_CONFIGS_SORT_KEYS = [
  "name",
  "importerName",
  "enabled",
  "createdAt",
  "updatedAt",
] as const;
export type ImporterConfigsSortKey = (typeof IMPORTER_CONFIGS_SORT_KEYS)[number];

/** URL filter keys managed by the /importers list page (useListState). */
export const IMPORTER_CONFIGS_FILTER_KEYS = ["enabled", "importerName"] as const;
export type ImporterConfigsFilterKey = (typeof IMPORTER_CONFIGS_FILTER_KEYS)[number];

/** API params accepted by `GET /importer-configs`. `enabled` is the
 *  "true"/"false" string the `optionalBooleanParam` schema coerces. */
export interface ImporterConfigsListFilters {
  page?: number;
  pageSize?: number;
  sort?: ImporterConfigsSortKey;
  order?: "asc" | "desc";
  search?: string;
  importerName?: string;
  enabled?: string;
}

/**
 * Adapts resolved `useListState` output to `/importer-configs` API params
 * (spec 068). The `enabled` URL sentinel `"all"` maps to "filter not
 * applied"; `"true"`/`"false"` pass through for the boolean param.
 */
export function importerConfigsListParams(
  state: ListQueryState,
): ImporterConfigsListFilters {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ImporterConfigsSortKey | null) ?? "createdAt",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
    importerName: facetParam(state, "importerName"),
    enabled: facetParam(state, "enabled"),
  };
}

/**
 * Primary paginated importer-configs list (`{data, pagination}` envelope).
 * Keep the current page visible while the next page/sort/filter loads.
 */
export function useImporterConfigs(filters: ImporterConfigsListFilters = {}) {
  return useQuery({
    queryKey: ["importer-configs", "list", filters],
    queryFn: () =>
      api<Paginated<ImporterConfig>>(
        `/importer-configs${buildApiQueryString(filters)}`,
      ),
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetch every matching importer config by paging through the list endpoint
 * (pageSize caps at 100) — for pickers/detail enrichments that legitimately
 * need the full set (spec 068 exempt surfaces).
 */
export function useAllImporterConfigs(
  filters: ImporterConfigsListFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["importer-configs", "all", filters],
    enabled,
    queryFn: () =>
      fetchAllPages((page) =>
        api<Paginated<ImporterConfig>>(
          `/importer-configs${buildApiQueryString({ ...filters, page, pageSize: 100 })}`,
        ),
      ),
  });
}

export function useImporterConfig(id: string | null) {
  return useQuery({
    queryKey: ["importer-configs", id],
    queryFn: () => api<{ config: ImporterConfig }>(`/importer-configs/${id}`),
    enabled: id !== null,
  });
}

export interface CreateImporterConfigInput {
  importerName: string;
  label: string;
  scope: Record<string, unknown>;
  secretRefs: Array<{ key: string; env?: string; file?: string }>;
  credentialIds?: string[];
  agentId?: string | null;
  schedule?: string | null;
  enabled: boolean;
}

export interface UpdateImporterConfigInput {
  importerName?: string;
  label?: string;
  scope?: Record<string, unknown>;
  secretRefs?: Array<{ key: string; env?: string; file?: string }>;
  credentialIds?: string[];
  agentId?: string | null;
  schedule?: string | null;
  enabled?: boolean;
}

export function useCreateImporterConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateImporterConfigInput) =>
      api<{ config: ImporterConfig }>("/importer-configs", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importer-configs"] });
    },
  });
}

export function useUpdateImporterConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & UpdateImporterConfigInput) =>
      api<{ config: ImporterConfig }>(`/importer-configs/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importer-configs"] });
    },
  });
}

export function useDeleteImporterConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/importer-configs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importer-configs"] });
    },
  });
}

// One-click migration (spec 013 US5): converts a config's legacy env/file
// secretRefs into a stored credential and links it.
export function useConvertSecrets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) =>
      api<{ credential: { id: string; label: string }; config: ImporterConfig }>(
        `/importer-configs/${configId}/convert-secrets`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importer-configs"] });
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useTriggerImportRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) =>
      api<{ runId: string }>(`/importer-configs/${configId}/trigger`, {
        method: "POST",
      }),
    onSuccess: (_, configId) => {
      qc.invalidateQueries({ queryKey: ["importer-configs", configId, "runs"] });
    },
  });
}

/** Spec 068 / ADR-130 sort whitelist for `GET /importer-configs/:id/runs`
 *  (listImporterRunsQuerySchema). */
export const IMPORTER_RUNS_SORT_KEYS = [
  "createdAt",
  "startedAt",
  "status",
  "completedAt",
  "assetsProcessed",
] as const;
export type ImporterRunsSortKey = (typeof IMPORTER_RUNS_SORT_KEYS)[number];

/** URL filter keys managed by the importer-detail run history (useListState). */
export const IMPORTER_RUNS_FILTER_KEYS = ["status"] as const;
export type ImporterRunsFilterKey = (typeof IMPORTER_RUNS_FILTER_KEYS)[number];

/**
 * API params accepted by `GET /importer-configs/:id/runs`. The endpoint
 * has no `search` param (T061) — only page/pageSize/sort/order + `status`.
 */
export interface ImporterRunsListFilters {
  page?: number;
  pageSize?: number;
  sort?: ImporterRunsSortKey;
  order?: "asc" | "desc";
  status?: string;
}

/**
 * Adapts resolved `useListState` output to the run-history API params
 * (spec 068). The `status` URL sentinel `"all"` maps to "filter not
 * applied"; other values pass through as the run-status enum.
 */
export function importerRunsListParams(
  state: ListQueryState,
): ImporterRunsListFilters {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ImporterRunsSortKey | null) ?? "createdAt",
    order: state.order,
    status: facetParam(state, "status"),
  };
}

export function importerRunsQueryOptions(
  configId: string,
  filters: ImporterRunsListFilters = {},
) {
  return {
    queryKey: ["importer-configs", configId, "runs", "list", filters] as const,
    queryFn: () =>
      api<Paginated<ImportRun>>(
        `/importer-configs/${configId}/runs${buildApiQueryString(filters)}`,
      ),
  };
}

export function useImporterRuns(
  configId: string | null,
  filters: ImporterRunsListFilters = {},
) {
  return useQuery({
    queryKey: ["importer-configs", configId, "runs", "list", filters],
    queryFn: () =>
      api<Paginated<ImportRun>>(
        `/importer-configs/${configId}/runs${buildApiQueryString(filters)}`,
      ),
    enabled: configId !== null,
    refetchInterval: (query) => {
      const runs = query.state.data?.data ?? [];
      const hasActive = runs.some(
        (r) => r.status === "PENDING" || r.status === "RUNNING",
      );
      return hasActive ? 3000 : false;
    },
    placeholderData: (prev) => prev,
  });
}

export function useImporterRun(configId: string | null, runId: string | null) {
  return useQuery({
    queryKey: ["importer-configs", configId, "runs", runId],
    queryFn: () =>
      api<{ run: ImportRun }>(
        `/importer-configs/${configId}/runs/${runId}`,
      ),
    enabled: configId !== null && runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      return status === "PENDING" || status === "RUNNING" ? 2000 : false;
    },
  });
}

export function useCancelImportRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { configId: string; runId: string }) =>
      api<undefined>(
        `/importer-configs/${vars.configId}/runs/${vars.runId}/cancel`,
        { method: "POST" },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({
        queryKey: ["importer-configs", vars.configId, "runs", vars.runId],
      });
      qc.invalidateQueries({
        queryKey: ["importer-configs", vars.configId, "runs"],
      });
    },
  });
}

/** Spec 068 / ADR-130 sort whitelist for
 *  `GET /importer-configs/:configId/runs/:runId/errors`
 *  (listRunErrorsQuerySchema) — the stored columns behind the errors
 *  table's Asset/Type/Message/Time cells (FR-005). */
export const RUN_ERRORS_SORT_KEYS = [
  "createdAt",
  "errorType",
  "assetExternalId",
  "errorMessage",
] as const;
export type RunErrorsSortKey = (typeof RUN_ERRORS_SORT_KEYS)[number];

/**
 * API params accepted by `GET /importer-configs/:configId/runs/:runId/errors`
 * (spec 068): `errorType` is the run-error "code" filter; `sort`/`order`
 * drive the stored-column sorts. No `search` param (T061).
 */
export interface RunErrorsListParams {
  page?: number;
  pageSize?: number;
  sort?: RunErrorsSortKey;
  order?: "asc" | "desc";
  errorType?: string;
}

export function useImportRunErrors(
  configId: string | null,
  runId: string | null,
  params: RunErrorsListParams = {},
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ["importer-configs", configId, "runs", runId, "errors", params],
    queryFn: () =>
      api<Paginated<ImportRunError>>(
        `/importer-configs/${configId}/runs/${runId}/errors${buildApiQueryString(params)}`,
      ),
    enabled: configId !== null && runId !== null,
    refetchInterval: options?.refetchInterval ?? false,
    placeholderData: (prev) => prev,
  });
}

export interface RunDayAggregate {
  day: string;
  runs: number;
  created: number;
  updated: number;
  failed: number;
}

export function useRunAggregates(configId: string | null, days = 14) {
  return useQuery({
    queryKey: ["importerConfigs", configId, "runAggregates", days],
    queryFn: async () => {
      const res = await api<{ days: RunDayAggregate[] }>(
        `/importer-configs/${configId}/run-aggregates?days=${days}`,
      );
      return res.days.map(({ day, created, updated, failed }) => ({
        day,
        created,
        updated,
        failed,
      }));
    },
    enabled: configId != null,
  });
}
