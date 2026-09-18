import { z } from "zod";

const secretKeyPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;

const secretsSchema = z
  .record(
    z.string().regex(secretKeyPattern, "Secret keys must start with a letter and contain only letters, digits, and underscores"),
    z.string().min(1, "Secret values must not be empty"),
  )
  .refine((data) => Object.keys(data).length >= 1, {
    message: "At least one secret value is required",
  })
  .refine((data) => new TextEncoder().encode(JSON.stringify(data)).length <= MAX_PAYLOAD_BYTES, {
    message: "Secret payload exceeds 64 KB",
  });

export const createCredentialSchema = z.object({
  label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
  secrets: secretsSchema,
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});

export const updateCredentialSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
  // Present = rotate: the entire payload is replaced in place.
  secrets: secretsSchema.optional(),
  // REVOKED is one-way; re-activation requires a new credential.
  status: z.literal("REVOKED").optional(),
});

export const testCredentialSchema = z.object({
  importerName: z.string().min(1, "Importer name is required"),
  scope: z.record(z.unknown()).optional(),
});

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
export type TestCredentialInput = z.infer<typeof testCredentialSchema>;
