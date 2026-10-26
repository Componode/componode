import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { User, UserRole } from "@/api/types";

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: User[] }>("/users"),
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
