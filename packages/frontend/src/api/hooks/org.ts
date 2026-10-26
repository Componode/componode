import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { OrgEntity, TeamMember } from "@/api/types";

export interface OrgEntityInput {
  name: string;
  slug?: string;
  description?: string | null;
}

function orgHooks(base: "lobs" | "teams") {
  const list = () =>
    useQuery({
      queryKey: [base],
      queryFn: () => api<Record<string, OrgEntity[]>>(`/${base}`),
    });
  // Detail read accepts id-or-slug — the route slug resolves directly (spec 033).
  const detail = (idOrSlug: string | undefined) =>
    useQuery({
      queryKey: [base, "detail", idOrSlug],
      queryFn: () => api<Record<string, OrgEntity>>(`/${base}/${idOrSlug}`),
      enabled: !!idOrSlug,
    });
  const create = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (vars: OrgEntityInput) =>
        api<Record<string, OrgEntity>>(`/${base}`, {
          method: "POST",
          body: JSON.stringify(vars),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: [base] }),
    });
  };
  const update = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (vars: { id: string } & Partial<OrgEntityInput>) =>
        api<Record<string, OrgEntity>>(`/${base}/${vars.id}`, {
          method: "PATCH",
          body: JSON.stringify(vars),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: [base] }),
    });
  };
  const del = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) =>
        api<undefined>(`/${base}/${id}`, { method: "DELETE" }),
      onSuccess: () => qc.invalidateQueries({ queryKey: [base] }),
    });
  };
  return { list, detail, create, update, del };
}

const lobs = orgHooks("lobs");
const teams = orgHooks("teams");

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

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: ["teams", "members", teamId],
    queryFn: () => api<{ members: TeamMember[] }>(`/teams/${teamId}/members`),
    enabled: !!teamId,
  });
}
