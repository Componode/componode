import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
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

export function useImporterConfigs() {
  return useQuery({
    queryKey: ["importer-configs"],
    queryFn: () => api<{ configs: ImporterConfig[] }>("/importer-configs"),
  });
}

export interface CreateImporterConfigInput {
  importerName: string;
  label: string;
  scope: Record<string, unknown>;
  secretRefs: Array<{ key: string; env?: string; file?: string }>;
  credentialIds?: string[];
  schedule?: string | null;
  enabled: boolean;
}

export interface UpdateImporterConfigInput {
  importerName?: string;
  label?: string;
  scope?: Record<string, unknown>;
  secretRefs?: Array<{ key: string; env?: string; file?: string }>;
  credentialIds?: string[];
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

export function importerRunsQueryOptions(configId: string) {
  return {
    queryKey: ["importer-configs", configId, "runs"] as const,
    queryFn: () =>
      api<{ runs: ImportRun[] }>(`/importer-configs/${configId}/runs`),
  };
}

export function useImporterRuns(configId: string | null) {
  return useQuery({
    queryKey: ["importer-configs", configId, "runs"],
    queryFn: () =>
      api<{ runs: ImportRun[] }>(`/importer-configs/${configId}/runs`),
    enabled: configId !== null,
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      const hasActive = runs.some(
        (r) => r.status === "PENDING" || r.status === "RUNNING",
      );
      return hasActive ? 3000 : false;
    },
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

export function useImportRunErrors(
  configId: string | null,
  runId: string | null,
) {
  return useQuery({
    queryKey: ["importer-configs", configId, "runs", runId, "errors"],
    queryFn: () =>
      api<{ errors: ImportRunError[] }>(
        `/importer-configs/${configId}/runs/${runId}/errors`,
      ),
    enabled: configId !== null && runId !== null,
  });
}
