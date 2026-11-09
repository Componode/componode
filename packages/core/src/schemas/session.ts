import { z } from "zod";
import { listParamsBaseSchema, listOrderSchema } from "./list-params.js";

/**
 * Spec 068 / ADR-130: standardized list contract for GET /sessions (the
 * caller's own active sessions). `search` matches the device/user-agent
 * fragment. Sort keys are real `sessions` columns — `location` orders by
 * the stored `ip` column the Location cell renders verbatim (the device
 * label is app-computed from `userAgent`, so it has no sort key).
 */
export const listSessionsQuerySchema = listParamsBaseSchema
  .extend({
    sort: z
      .enum(["createdAt", "lastSeenAt", "expiresAt", "location"])
      .default("createdAt"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
