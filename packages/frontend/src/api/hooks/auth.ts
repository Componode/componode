import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/api/client";
import type { User } from "@/api/types";

interface SessionResponse {
  user: User | null;
}

/**
 * Fetch the current session user. Returns `null` when there is no active
 * session (AUTH_NO_SESSION) instead of throwing, so callers can treat the
 * result as "user or null".
 */
export function useSession() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: async (): Promise<User | null> => {
      try {
        const data = await api<SessionResponse>("/auth/session");
        return data.user;
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.code === "AUTH_NO_SESSION") return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export interface LoginVariables {
  username: string;
  password: string;
}

interface LoginResponse {
  user: User;
  csrfToken: string;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: LoginVariables) =>
      api<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: (data) => {
      // Seed the session cache directly: invalidation alone leaves the stale
      // unauthenticated `null` in place long enough for AuthGuard to bounce
      // the fresh login back to /login.
      qc.setQueryData(["auth", "session"], data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(["auth", "session"], null);
      qc.clear();
    },
  });
}
