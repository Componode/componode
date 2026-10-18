import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { AppSettings, OidcConfig, OidcStatus } from "@/api/types";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: AppSettings }>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AppSettings) =>
      api<{ settings: AppSettings }>("/settings", {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useOidcConfig() {
  return useQuery({
    queryKey: ["settings", "oidc"],
    queryFn: () => api<{ oidc: OidcConfig }>("/settings/oidc"),
  });
}

export function useUpdateOidcConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: OidcConfig) =>
      api<{ oidc: OidcConfig }>("/settings/oidc", {
        method: "PUT",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "oidc"] });
    },
  });
}

export function useOidcStatus() {
  return useQuery({
    queryKey: ["settings", "oidc", "status"],
    queryFn: () => api<OidcStatus>("/auth/oidc/status"),
    retry: false,
  });
}
