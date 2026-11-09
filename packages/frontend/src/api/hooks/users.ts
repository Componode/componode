import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { allPagesQueryString, buildListQueryString, fetchAllPages, type ListQueryState } from "@/api/list-query";
import type { User, UserListResponse, UserRole } from "@/api/types";

/** Spec 068 / ADR-130 sort + filter whitelists (core listUsersQuerySchema). */
export const USER_SORT_KEYS = ["name", "role", "isActive", "lastActiveAt", "createdAt"] as const;
export type UserSortKey = (typeof USER_SORT_KEYS)[number];

/** URL filter keys managed by the /users list page (useListState). */
export const USER_FILTER_KEYS = ["role", "isActive"] as const;
export type UserFilterKey = (typeof USER_FILTER_KEYS)[number];

/**
 * Fetch-all sweep for pickers/lookups (spec 068 exempt surfaces) — pages
 * through GET /users at pageSize=100 and re-wraps rows in `{users}`.
 */
export function useUsers() {
  return useQuery({
    queryKey: ["users", "all"],
    queryFn: () =>
      fetchAllPages<User>((page) =>
        api<UserListResponse>(`/users${allPagesQueryString(page)}`),
      ).then((rows) => ({ users: rows })),
  });
}

/**
 * Spec 068: one page of GET /users (admin) for the /users list page. `state`
 * is the resolved `useListState` value; pass a debounced `search` override.
 */
export function useUsersList(state: ListQueryState) {
  const qs = buildListQueryString(state);
  return useQuery({
    queryKey: ["users", "list", qs],
    queryFn: () => api<UserListResponse>(`/users${qs}`),
    placeholderData: (prev) => prev,
  });
}

export interface CreateUserVariables {
  username: string;
  password: string;
  role?: UserRole;
  displayName?: string;
  email?: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateUserVariables) =>
      api<{ user: User }>("/users", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export interface UpdateUserVariables {
  id: string;
  role?: UserRole;
  displayName?: string;
  email?: string;
  isActive?: boolean;
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateUserVariables) => {
      const { id, ...body } = vars;
      return api<{ user: User }>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export interface UpdateSelfVariables {
  displayName?: string;
  email?: string;
}

export function useUpdateSelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateSelfVariables) =>
      api<{ user: User }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth", "session"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
