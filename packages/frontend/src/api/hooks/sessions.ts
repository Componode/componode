import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { allPagesQueryString, buildListQueryString, fetchAllPages, type ListQueryState } from "@/api/list-query";
import type { Session, SessionListResponse } from "@/api/types";

/** Spec 068 / ADR-130 sort whitelist (core listSessionsQuerySchema). */
export const SESSION_SORT_KEYS = ["createdAt", "lastSeenAt", "expiresAt", "location"] as const;
export type SessionSortKey = (typeof SESSION_SORT_KEYS)[number];

/**
 * Fetch-all sweep for exempt surfaces (settings "Your sessions" list) —
 * pages through GET /sessions at pageSize=100 and re-wraps `{sessions}`.
 */
export function useSessions() {
  return useQuery({
    queryKey: ["sessions", "all"],
    queryFn: () =>
      fetchAllPages<Session>((page) =>
        api<SessionListResponse>(`/sessions${allPagesQueryString(page)}`),
      ).then((rows) => ({ sessions: rows })),
  });
}

/**
 * Spec 068: one page of GET /sessions (the caller's own sessions) for the
 * /sessions list page. `state` is the resolved `useListState` value; pass a
 * debounced `search` override.
 */
export function useSessionsList(state: ListQueryState) {
  const qs = buildListQueryString(state);
  return useQuery({
    queryKey: ["sessions", "list", qs],
    queryFn: () => api<SessionListResponse>(`/sessions${qs}`),
    placeholderData: (prev) => prev,
  });
}

/** Admin-only: sessions for an arbitrary user (user:listSessions). */
export function useUserSessions(userId: string | null) {
  return useQuery({
    queryKey: ["users", userId, "sessions"],
    queryFn: () => api<{ sessions: Session[] }>(`/users/${userId}/sessions`),
    enabled: userId !== null,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/sessions/${id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
