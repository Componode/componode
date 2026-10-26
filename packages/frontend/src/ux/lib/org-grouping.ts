import type { TeamEntity } from "@/api/types";

export interface TeamGroups {
  /** Selected LOB's teams — or the whole list when ungrouped. */
  primary: TeamEntity[];
  /** All remaining teams when a LOB is selected; null = ungrouped. */
  others: TeamEntity[] | null;
}

/**
 * Product-form team picker grouping (spec 034 — clarified group, don't
 * filter): teams associated with `lobId` lead the list; every remaining
 * team — other LOBs' and unassociated alike — stays reachable in the
 * second group. No team is hidden. No LOB selected → ungrouped list.
 */
export function groupTeams(teams: TeamEntity[], lobId: string | null | undefined): TeamGroups {
  if (!lobId) return { primary: teams, others: null };
  return {
    primary: teams.filter((t) => t.lobId === lobId),
    others: teams.filter((t) => t.lobId !== lobId),
  };
}
