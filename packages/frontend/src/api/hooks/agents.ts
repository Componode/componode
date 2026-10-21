import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type {
  CreateImportAgentInput,
  UpdateImportAgentInput,
} from "@componode/core";
import type {
  AgentEnrollment,
  AgentSession,
  CreateAgentResult,
  ImportAgent,
} from "@/api/types";

// Presence freshness (SC-002): list, detail, and session views poll on the
// same cadence so a status change surfaces within ~15 s.
const AGENT_POLL_INTERVAL_MS = 15_000;

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api<{ agents: ImportAgent[] }>("/agents"),
    refetchInterval: AGENT_POLL_INTERVAL_MS,
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: () => api<{ agent: ImportAgent }>(`/agents/${id}`),
    enabled: id !== null,
    refetchInterval: AGENT_POLL_INTERVAL_MS,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateImportAgentInput) =>
      api<CreateAgentResult>("/agents", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateImportAgentInput) =>
      api<{ agent: ImportAgent }>(`/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useRotateAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ agent: ImportAgent; enrollment: AgentEnrollment }>(
        `/agents/${id}/enroll`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useRevokeAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ agent: ImportAgent }>(`/agents/${id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useDeleteAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/agents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useAgentSessions(id: string | null) {
  return useQuery({
    queryKey: ["agents", id, "sessions"],
    queryFn: () => api<{ sessions: AgentSession[] }>(`/agents/${id}/sessions`),
    enabled: id !== null,
    refetchInterval: AGENT_POLL_INTERVAL_MS,
  });
}
