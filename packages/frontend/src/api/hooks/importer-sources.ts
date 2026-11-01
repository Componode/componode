import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type {
  ImportRun,
  ImporterSource,
  ImporterSourceListItem,
  SourceMembershipsResponse,
} from "@/api/types";

export function useImporterSources() {
  return useQuery({
    queryKey: ["importer-sources"],
    queryFn: () =>
      api<{ sources: ImporterSourceListItem[] }>(`/importer-sources`),
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
// list shape — invalidate on settle so a 409 SOURCE_STATE_CONFLICT also
// refreshes the control state to the server's truth.
export function useRetireSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ source: ImporterSource }>(`/importer-sources/${id}/retire`, {
        method: "POST",
      }),
    onSettled: () => {
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["importer-sources"] });
    },
  });
}
