import { z } from "zod";

/**
 * Query schema for GET /suggestions (spec 022). Strict — unknown keys are
 * rejected (ADR-095). Only PENDING and DISMISSED are queryable states;
 * ACCEPTED/SUPERSEDED are machinery, not a view.
 */
export const listSuggestionsQuerySchema = z
  .object({
    status: z.enum(["PENDING", "DISMISSED"]).default("PENDING"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ListSuggestionsQuery = z.infer<typeof listSuggestionsQuerySchema>;
