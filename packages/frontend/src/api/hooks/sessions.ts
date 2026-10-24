import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Session } from "@/api/types";

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ sessions: Session[] }>("/sessions"),
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
