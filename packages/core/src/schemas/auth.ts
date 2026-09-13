import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "../constants/passwords.js";

const passwordPolicyMessage = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;

export const loginSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be at most 50 characters")
    .regex(/^[a-z0-9_-]+$/, "Username must be lowercase alphanumeric with _ or -"),
  // Login keeps the legacy lower bound so existing accounts with shorter
  // passwords are not locked out (ADR-099 — policy applies to set paths).
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be at most 50 characters")
    .regex(/^[a-z0-9_-]+$/, "Username must be lowercase alphanumeric with _ or -"),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, passwordPolicyMessage)
    .max(128, "Password must be at most 128 characters"),
  displayName: z.string().max(100).optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, passwordPolicyMessage).max(128),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1, "Token is required"),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, passwordPolicyMessage).max(128),
});

export const passwordResetRequestSchema = z.object({
  userId: z.string().uuid(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
