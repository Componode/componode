import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { DockerTarget } from "@/api/types";
import type { ProbeDockerTargetInput } from "@componode/core";

export type { ProbeDockerTargetInput };

export function useDockerTargets() {
  return useQuery({ queryKey: ["docker-targets"], queryFn: () => api<{ targets: DockerTarget[] }>("/docker-targets") });
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
