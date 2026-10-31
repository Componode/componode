import { z } from "zod";

/**
 * Query schema for GET /suggestions (spec 022). Strict — unknown keys are
 * rejected (ADR-095). Spec 042 (gap G32) adds DECIDED — a filter matching
 * every terminal status (ACCEPTED/DISMISSED/SUPERSEDED) for the decided-
 * history view; per-status queries stay limited to PENDING/DISMISSED.
 */
export const listSuggestionsQuerySchema = z
  .object({
    status: z.enum(["PENDING", "DISMISSED", "DECIDED"]).default("PENDING"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ListSuggestionsQuery = z.infer<typeof listSuggestionsQuerySchema>;
