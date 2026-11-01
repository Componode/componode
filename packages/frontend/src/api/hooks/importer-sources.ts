import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type {
  ImportRun,
  ImporterSource,
  ImporterSourceListItem,
  ImporterSourceStatus,
  SourceMembershipsResponse,
} from "@/api/types";

export interface ImporterSourceFilters {
  status?: ImporterSourceStatus;
  importerName?: string;
}

function queryString(filters: ImporterSourceFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.importerName) params.set("importerName", filters.importerName);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useImporterSources(filters: ImporterSourceFilters = {}) {
  return useQuery({
    queryKey: ["importer-sources", filters],
    queryFn: () =>
      api<{ sources: ImporterSourceListItem[] }>(
        `/importer-sources${queryString(filters)}`,
      ),
  });
}

export function useImporterSource(id: string | null) {
  return useQuery({
    queryKey: ["importer-sources", id],
    queryFn: () => api<{ source: ImporterSourceListItem }>(`/importer-sources/${id}`),
    enabled: id !== null,
  });
}

export function useSourceRuns(id: string | null) {
  return useQuery({
    queryKey: ["importer-sources", id, "runs"],
    queryFn: () => api<{ runs: ImportRun[] }>(`/importer-sources/${id}/runs`),
    enabled: id !== null,
  });
}

export function useSourceMemberships(id: string | null) {
  return useQuery({
    queryKey: ["importer-sources", id, "memberships"],
    queryFn: () =>
      api<SourceMembershipsResponse>(`/importer-sources/${id}/memberships`),
    enabled: id !== null,
  });
}

// Retire/reactivate return the raw importer_sources row, not the enriched
// list shape — always invalidate and let the detail/list refetch.
export function useRetireSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ source: ImporterSource }>(`/importer-sources/${id}/retire`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importer-sources"] });
    },
  });
}

export function useReactivateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ source: ImporterSource }>(`/importer-sources/${id}/reactivate`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importer-sources"] });
    },
  });
}
