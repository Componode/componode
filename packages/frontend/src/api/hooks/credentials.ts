import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Credential, CredentialDetail, CredentialTestResult } from "@/api/types";

export function useCredentials() {
  return useQuery({
    queryKey: ["credentials"],
    queryFn: () => api<{ credentials: Credential[] }>("/credentials"),
  });
}

export function useCredential(id: string | null) {
  return useQuery({
    queryKey: ["credentials", id],
    queryFn: () => api<CredentialDetail>(`/credentials/${id}`),
    enabled: id !== null,
  });
}

export interface CreateCredentialInput {
  label: string;
  expiresAt?: string | null;
  secrets: Record<string, string>;
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateCredentialInput) =>
      api<{ credential: Credential }>("/credentials", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export interface TestCredentialInput {
  importerName: string;
  scope?: Record<string, unknown>;
}

export function useTestCredential(id: string) {
  return useMutation({
    mutationFn: (vars: TestCredentialInput) =>
      api<CredentialTestResult>(`/credentials/${id}/test`, {
        method: "POST",
        body: JSON.stringify(vars),
      }),
  });
}

export interface UpdateCredentialInput {
  label?: string;
  expiresAt?: string | null;
  secrets?: Record<string, string>;
  status?: "REVOKED";
}

export function useUpdateCredential(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateCredentialInput) =>
      api<{ credential: Credential }>(`/credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/credentials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}
