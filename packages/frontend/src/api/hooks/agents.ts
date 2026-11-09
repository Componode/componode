import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  allPagesQueryString,
  buildApiQueryString,
  fetchAllPages,
  type ListQueryState,
} from "@/api/list-query";
import type { Paginated } from "@/api/types";
import type {
  CreateImportAgentInput,
  UpdateImportAgentInput,
} from "@componode/core";
import type {
  AgentBoundConfig,
  AgentDetail,
  AgentEnrollment,
  AgentRun,
  AgentSession,
  CreateAgentResult,
  ImportAgent,
} from "@/api/types";

// Presence freshness (SC-002): list, detail, and session views poll on the
// same cadence so a status change surfaces within ~15 s.
const AGENT_POLL_INTERVAL_MS = 15_000;

/** Spec 068 / ADR-130 sort whitelist for `GET /agents` (listAgentsQuerySchema). */
export const AGENTS_SORT_KEYS = [
  "name",
  "status",
  "agentVersion",
  "boundConfigCount",
  "lastSeenAt",
  "createdAt",
] as const;
export type AgentsSortKey = (typeof AGENTS_SORT_KEYS)[number];

/** URL filter keys managed by the /agents list page (useListState). */
export const AGENTS_FILTER_KEYS = ["status"] as const;
export type AgentsFilterKey = (typeof AGENTS_FILTER_KEYS)[number];

/** API params accepted by `GET /agents` (page/pageSize/order/search + filters). */
export interface AgentsListFilters {
  page?: number;
  pageSize?: number;
  sort?: AgentsSortKey;
  order?: "asc" | "desc";
  search?: string;
  status?: string;
}

const agentsFacet = (state: ListQueryState, key: string): string | undefined => {
  const v = state.filters[key];
  return v !== undefined && v !== "" && v !== "all" ? v : undefined;
};

/**
 * Adapts resolved `useListState` output to `/agents` API params (spec 068).
 * The `status` URL sentinel `"all"` maps to "filter not applied"; every
 * other filter value is already the API enum.
 */
export function agentsListParams(state: ListQueryState): AgentsListFilters {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as AgentsSortKey | null) ?? "name",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
    status: agentsFacet(state, "status"),
  };
}

/**
 * Primary paginated agents list (`{data, pagination}` envelope). Keep the
 * current page visible while the next page/sort/filter loads
 * (docs/ux.md §6; spec 068 gradual consumption).
 */
export function useAgents(
  filters: AgentsListFilters = {},
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ["agents", "list", filters],
    queryFn: () =>
      api<Paginated<ImportAgent>>(`/agents${buildApiQueryString(filters)}`),
    refetchInterval: options?.refetchInterval ?? AGENT_POLL_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetch every agent by paging through the list endpoint (pageSize caps at
 * 100) — for pickers/badges that legitimately need the full set (spec 068
 * exempt surfaces: sidebar attention count, agent pickers in forms).
 */
export function useAllAgents(options?: {
  refetchInterval?: number | false;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["agents", "all"],
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? AGENT_POLL_INTERVAL_MS,
    queryFn: () =>
      fetchAllPages((page) =>
        api<Paginated<ImportAgent>>(`/agents${allPagesQueryString(page)}`),
      ),
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: () => api<{ agent: AgentDetail }>(`/agents/${id}`),
    enabled: id !== null,
    refetchInterval: AGENT_POLL_INTERVAL_MS,
  });
}

export function useAgentConfigs(id: string | null) {
  return useQuery({
    queryKey: ["agents", id, "configs"],
    queryFn: () => api<{ configs: AgentBoundConfig[] }>(`/agents/${id}/configs`),
    enabled: id !== null,
    refetchInterval: AGENT_POLL_INTERVAL_MS,
  });
}

export function useAgentRuns(id: string | null) {
  return useQuery({
    queryKey: ["agents", id, "runs"],
    queryFn: () => api<{ runs: AgentRun[] }>(`/agents/${id}/runs`),
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
