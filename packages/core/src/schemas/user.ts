import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "../constants/passwords.js";

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, "Username must be lowercase alphanumeric with _ or -"),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`).max(128),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
  displayName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  teamId: z.string().uuid().optional(),
});

export const updateUserSchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
  displayName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  teamId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Self-service profile update (PATCH /users/me): only the two self-editable
// fields. .strict() rejects privileged/unknown keys rather than silently
// stripping them — a caller who sends `role` must get an error, not a no-op.
export const updateSelfSchema = z
  .object({
    displayName: z.string().max(100).optional(),
    email: z.string().email().optional(),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateSelfInput = z.infer<typeof updateSelfSchema>;
