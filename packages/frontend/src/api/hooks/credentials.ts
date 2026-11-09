import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { allPagesQueryString, buildListQueryString, fetchAllPages, type ListQueryState } from "@/api/list-query";
import type { Credential, CredentialDetail, CredentialKind, CredentialListItem, CredentialListResponse, CredentialTestResult, SecretRefMap } from "@/api/types";

/** Spec 068 / ADR-130 sort + filter whitelists (core listCredentialsQuerySchema). */
export const CREDENTIAL_SORT_KEYS = ["name", "status", "expiresAt", "lastUsedAt", "usedByCount", "createdAt"] as const;
export type CredentialSortKey = (typeof CREDENTIAL_SORT_KEYS)[number];

/** URL filter keys managed by the /credentials list page (useListState). */
export const CREDENTIAL_FILTER_KEYS = ["status"] as const;
export type CredentialFilterKey = (typeof CREDENTIAL_FILTER_KEYS)[number];

/**
 * Fetch-all sweep for pickers/lookups (importer forms, URL-check auth,
 * settings) — spec 068 exempt surfaces. Pages through GET /credentials at
 * pageSize=100 and re-wraps rows in `{credentials}`.
 */
export function useCredentials() {
  return useQuery({
    queryKey: ["credentials", "all"],
    queryFn: () =>
      fetchAllPages<CredentialListItem>((page) =>
        api<CredentialListResponse>(`/credentials${allPagesQueryString(page)}`),
      ).then((rows) => ({ credentials: rows })),
  });
}

/**
 * Spec 068: one page of GET /credentials (admin) for the /credentials list
 * page. `state` is the resolved `useListState` value; pass a debounced
 * `search` override. Rows carry masked `keyHints` only — never secret
 * values (ADR-107/ADR-117).
 */
export function useCredentialsList(state: ListQueryState) {
  const qs = buildListQueryString(state);
  return useQuery({
    queryKey: ["credentials", "list", qs],
    queryFn: () => api<CredentialListResponse>(`/credentials${qs}`),
    placeholderData: (prev) => prev,
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
  kind?: CredentialKind;
  secrets?: Record<string, string>;
  secretRefMap?: SecretRefMap;
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
  secretRefMap?: SecretRefMap;
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

/** Revoke = PATCH {status:"REVOKED"}; id is a mutate variable (safe in row callbacks). */
export function useRevokeCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ credential: Credential }>(`/credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "REVOKED" }),
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
