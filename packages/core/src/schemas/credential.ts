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

// Agent-managed credentials (ADR-117, spec 026): references name sources,
// not values — an env var name or a file under the agent's secrets dir.
// Exactly one source key per ref; unknown source types are rejected.
export const secretRefSchema = z.union([
  z.object({ env: z.string().min(1, "Env var name is required") }).strict(),
  z.object({ file: z.string().min(1, "File name is required") }).strict(),
]);

export const secretRefMapSchema = z
  .record(
    z.string().regex(secretKeyPattern, "Secret keys must start with a letter and contain only letters, digits, and underscores"),
    secretRefSchema,
  )
  .refine((data) => Object.keys(data).length >= 1, {
    message: "At least one secret reference is required",
  })
  .refine((data) => new TextEncoder().encode(JSON.stringify(data)).length <= MAX_PAYLOAD_BYTES, {
    message: "Secret reference map exceeds 64 KB",
  });

export type SecretRefInput = z.infer<typeof secretRefSchema>;
export type SecretRefMap = z.infer<typeof secretRefMapSchema>;

// `kind` is absent on legacy callers — default to STORED via preprocess so
// existing STORED create bodies keep working. (discriminatedUnion cannot
// default a missing discriminator itself.)
export const createCredentialSchema = z.preprocess(
  (v) =>
    v && typeof v === "object" && !Array.isArray(v) && !("kind" in v)
      ? { ...v, kind: "STORED" }
      : v,
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("STORED"),
        label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
        secrets: secretsSchema,
        expiresAt: z.string().datetime({ offset: true }).nullish(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("AGENT_MANAGED"),
        label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
        secretRefMap: secretRefMapSchema,
        expiresAt: z.string().datetime({ offset: true }).nullish(),
      })
      .strict(),
  ]),
);

// Strict: `kind` (or any unknown field) in a PATCH body is rejected — kind
// is immutable after creation, and silently stripping it would let a caller
// believe the kind changed.
export const updateCredentialSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullish(),
    // Present = rotate: the entire payload is replaced in place.
    secrets: secretsSchema.optional(),
    // Present = replace the reference map in place (AGENT_MANAGED only —
    // kind enforcement happens service-side where the row's kind is known).
    secretRefMap: secretRefMapSchema.optional(),
    // REVOKED is one-way; re-activation requires a new credential.
    status: z.literal("REVOKED").optional(),
  })
  .strict();

export const testCredentialSchema = z.object({
  importerName: z.string().min(1, "Importer name is required"),
  scope: z.record(z.unknown()).optional(),
});

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
export type TestCredentialInput = z.infer<typeof testCredentialSchema>;
