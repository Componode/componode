import { z } from "zod";
import { listParamsBaseSchema, listOrderSchema } from "./list-params.js";

/**
 * Query schema for GET /suggestions (spec 022). Strict — unknown keys are
 * rejected (ADR-095). Spec 042 (gap G32) adds DECIDED — a filter matching
 * every terminal status (ACCEPTED/DISMISSED/SUPERSEDED) for the decided-
 * history view; per-status queries stay limited to PENDING/DISMISSED.
 *
 * Spec 068 / ADR-130: `limit`/`offset` were replaced by the shared
 * `page`/`pageSize` params; `sort` covers the score-ranked queue
 * (`score`), chronological views (`createdAt`), the decided-history
 * ordering (`decidedAt`), and the displayed status badge (`status`,
 * T059 / FR-005). The service resolves the effective key per `status`
 * view — decided rows have no meaningful score (SUPERSEDED tombstones
 * carry NULL), so `score`/`decidedAt` both map to `decidedAt` there,
 * while `decidedAt` maps to `createdAt` on the pending queue. The shared
 * `search` param is omitted (T061): the queue has no server-side search,
 * so `search=` is rejected rather than silently ignored.
 */
export const listSuggestionsQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    status: z.enum(["PENDING", "DISMISSED", "DECIDED"]).default("PENDING"),
    sort: z
      .enum(["createdAt", "score", "decidedAt", "status"])
      .default("score"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListSuggestionsQuery = z.infer<typeof listSuggestionsQuerySchema>;
