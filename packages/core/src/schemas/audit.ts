import { z } from "zod";
import { listParamsBaseSchema, listOrderSchema } from "./list-params.js";

/**
 * Spec 068 / ADR-130: standardized list contract for the audit reads.
 * `limit`/`offset` were replaced by the shared `page`/`pageSize` params;
 * `sort` covers `createdAt` plus the `action`/`actor` display columns and
 * the `kind`/`entityType` facets the feed renders (T059 / FR-005).
 * Both schemas are strict — unknown query keys are rejected (ADR-095) —
 * and both omit the shared `search` param: the feed has no server-side
 * search, so `search=` is rejected rather than silently ignored (T061).
 */
const auditListShape = {
  kind: z.enum(["entity", "edge"]).optional(),
  action: z.string().max(100).optional(),
  actor: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sort: z
    .enum(["createdAt", "action", "actor", "kind", "entityType"])
    .default("createdAt"),
  order: listOrderSchema.default("desc"),
};

export const activityFeedQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    ...auditListShape,
    entityType: z.string().max(100).optional(),
  })
  .strict();

export const entityHistoryQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend(auditListShape)
  .strict();

export const correctionInputSchema = z.object({
  entryId: z.string().uuid(),
  entryKind: z.enum(["entity", "edge"]),
  note: z.string().min(1).max(2000),
});

export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;
export type EntityHistoryQuery = z.infer<typeof entityHistoryQuerySchema>;
export type CorrectionInput = z.infer<typeof correctionInputSchema>;
