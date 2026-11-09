import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { allPagesQueryString, buildListQueryString, fetchAllPages, type ListQueryState } from "@/api/list-query";
import type {
  LobListResponse,
  OrgEntity,
  Paginated,
  TeamEntity,
  TeamListResponse,
  TeamMember,
} from "@/api/types";

export interface OrgEntityInput {
  name: string;
  slug?: string;
  description?: string | null;
}

/** Team writes additionally accept the LOB association (spec 034). */
export interface TeamEntityInput extends OrgEntityInput {
  lobId?: string | null;
}

/**
 * Spec 068 / ADR-130 sort whitelists (core listLobsQuerySchema/
 * listTeamsQuerySchema). FR-005: the derived-count keys are contract-legal —
 * the backend orders by the same subquery aliases the rows display.
 */
export const LOB_SORT_KEYS = ["name", "createdAt", "teamCount", "productCount"] as const;
export type LobSortKey = (typeof LOB_SORT_KEYS)[number];

export const TEAM_SORT_KEYS = [
  "name",
  "createdAt",
  "lob",
  "memberCount",
  "productCount",
  "componentCount",
] as const;
export type TeamSortKey = (typeof TEAM_SORT_KEYS)[number];

function orgHooks<T extends OrgEntity = OrgEntity, TIn extends OrgEntityInput = OrgEntityInput>(base: "lobs" | "teams") {
  const key = base === "lobs" ? "lobs" : "teams";
  // Fetch-all sweep for pickers/detail sub-tables (spec 068 exempt surfaces):
  // the list endpoint is paginated, so page through it at pageSize=100 and
  // re-wrap rows in the legacy `{lobs|teams}` envelope consumers expect.
  const list = () =>
    useQuery({
      queryKey: [base, "all"],
      queryFn: async () => {
        const rows = await fetchAllPages<T>((page) =>
          api<Paginated<T>>(`/${base}${allPagesQueryString(page)}`),
        );
        return { [key]: rows } as Record<string, T[]>;
      },
    });
  // Detail read accepts id-or-slug — the route slug resolves directly (spec 033).
  const detail = (idOrSlug: string | undefined) =>
    useQuery({
      queryKey: [base, "detail", idOrSlug],
      queryFn: () => api<Record<string, T>>(`/${base}/${idOrSlug}`),
      enabled: !!idOrSlug,
    });
  const create = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (vars: TIn) =>
        api<Record<string, T>>(`/${base}`, {
          method: "POST",
          body: JSON.stringify(vars),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: [base] }),
    });
  };
  const update = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (vars: { id: string } & Partial<TIn>) => {
        const { id, ...body } = vars;
        return api<Record<string, T>>(`/${base}/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: [base] });
        // LOB rename/delete changes the lob summary embedded on team reads.
        if (base === "lobs") qc.invalidateQueries({ queryKey: ["teams"] });
      },
    });
  };
  const del = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) =>
        api<undefined>(`/${base}/${id}`, { method: "DELETE" }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: [base] });
        if (base === "lobs") qc.invalidateQueries({ queryKey: ["teams"] });
      },
    });
  };
  return { list, detail, create, update, del };
}

const lobs = orgHooks("lobs");
const teams = orgHooks<TeamEntity, TeamEntityInput>("teams");

export const useLobs = lobs.list;
export const useLob = lobs.detail;
export const useCreateLob = lobs.create;
export const useUpdateLob = lobs.update;
export const useDeleteLob = lobs.del;

export const useTeams = teams.list;
export const useTeam = teams.detail;
export const useCreateTeam = teams.create;
export const useUpdateTeam = teams.update;
export const useDeleteTeam = teams.del;

/**
 * Spec 068: one page of GET /lobs for the /lobs list page. `state` is the
 * resolved `useListState` value (its `defaults` member drives param elision);
 * pass a debounced `search` override for the query input.
 */
export function useLobsList(state: ListQueryState) {
  const qs = buildListQueryString(state);
  return useQuery({
    queryKey: ["lobs", "list", qs],
    queryFn: () => api<LobListResponse>(`/lobs${qs}`),
    placeholderData: (prev) => prev,
  });
}

/** Spec 068: one page of GET /teams for the /teams list page. */
export function useTeamsList(state: ListQueryState) {
  const qs = buildListQueryString(state);
  return useQuery({
    queryKey: ["teams", "list", qs],
    queryFn: () => api<TeamListResponse>(`/teams${qs}`),
    placeholderData: (prev) => prev,
  });
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: ["teams", "members", teamId],
    queryFn: () => api<{ members: TeamMember[] }>(`/teams/${teamId}/members`),
    enabled: !!teamId,
  });
}
