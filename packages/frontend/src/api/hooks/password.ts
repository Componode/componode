import { useMutation } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface ChangePasswordVariables {
  currentPassword: string;
  newPassword: string;
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (vars: ChangePasswordVariables) =>
      api<void>("/auth/password/change", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
  });
}

export interface ResetPasswordVariables {
  userId: string;
}

export interface ResetPasswordResponse {
  resetToken: string;
}

/** Admin-initiated password reset. Returns a reset token to deliver to the user. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (vars: ResetPasswordVariables) =>
      api<ResetPasswordResponse>("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
  });
}

export interface ConfirmResetVariables {
  resetToken: string;
  newPassword: string;
}

export function useConfirmReset() {
  return useMutation({
    mutationFn: (vars: ConfirmResetVariables) =>
      api<void>("/auth/password/reset/confirm", {
        method: "POST",
        // API field is `token`; the response names it `resetToken`.
        body: JSON.stringify({ token: vars.resetToken, newPassword: vars.newPassword }),
      }),
  });
}
