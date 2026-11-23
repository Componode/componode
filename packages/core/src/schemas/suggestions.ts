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
    // Spec 075: `kind` selects the queue — `edge` (product edges, the
    // historical default and nav-badge source) or `dependency` (BOM
    // component-dependency suggestions, ADR-132).
    kind: z.enum(["edge", "dependency"]).default("edge"),
    // `childComponentId` scopes `kind=dependency` rows to one library —
    // per-group expansion fetches stay bounded at any queue depth.
    childComponentId: z.string().uuid().optional(),
    status: z.enum(["PENDING", "DISMISSED", "DECIDED"]).default("PENDING"),
    sort: z
      .enum(["createdAt", "score", "decidedAt", "status"])
      .default("score"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListSuggestionsQuery = z.infer<typeof listSuggestionsQuerySchema>;

/**
 * Spec 075 / UX-SUG-03 — query params for
 * `GET /suggestions/dependencies/groups`: pending dependency suggestions
 * grouped per library (childComponentId).
 */
export const dependencyGroupsQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    sort: z
      .enum(["score", "components", "name"])
      .default("score"),
    order: listOrderSchema.default("desc"),
    /** Filter the queue to one candidate component (BOM row "Suggested" link). */
    childComponentId: z.string().uuid().optional(),
  })
  .strict();

export type DependencyGroupsQuery = z.infer<
  typeof dependencyGroupsQuerySchema
>;

/** Spec 075 — POST /suggestions/dependencies/bulk body. */
export const dependencyBulkBodySchema = z
  .object({
    childComponentId: z.string().uuid(),
    action: z.enum(["accept", "dismiss"]),
  })
  .strict();

export type DependencyBulkBody = z.infer<typeof dependencyBulkBodySchema>;
