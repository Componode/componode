import { z } from "zod";

/**
 * Agent-local target registry envelope (ADR-116 A5/A6). Profiles are
 * non-secret access-route descriptors keyed by immutable `targetId`; the
 * registry contents ARE the allowlist. Transport-specific fields are
 * validated by the importing importer — the envelope only guarantees
 * shape.
 */
export const targetProfileSchema = z
  .object({
    transport: z.string().min(1).max(50),
  })
  .loose();

export const targetRegistrySchema = z
  .object({
    version: z.literal(1),
    targets: z.record(
      z.string().min(1).max(200),
      targetProfileSchema,
    ),
  })
  .strict();

export type TargetProfile = z.infer<typeof targetProfileSchema>;
export type TargetRegistry = z.infer<typeof targetRegistrySchema>;

/** Non-secret parse failure — safe to surface on the wire. */
export class TargetRegistryError extends Error {}

/** Parse and validate registry JSON; throws TargetRegistryError with a
 *  non-secret message on any structural problem (fail closed). */
export function parseTargetRegistry(raw: unknown): TargetRegistry {
  const result = targetRegistrySchema.safeParse(raw);
  if (!result.success) {
    throw new TargetRegistryError("target registry is malformed");
  }
  return result.data;
}
