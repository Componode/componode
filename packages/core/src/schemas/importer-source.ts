import { z } from "zod";
import { IMPORTER_SOURCE_STATUSES } from "../constants/importer-source.js";
import { listParamsBaseSchema } from "./list-params.js";

/**
 * ImporterSource list filters (spec 044, contracts/source-api.md) extended
 * onto the spec 068 / ADR-130 standardized list contract. `name` sorts by
 * the source identity (`externalIdentity`); `lastCompletedRunAt` is the
 * derived most-recent completed run timestamp the row already exposes.
 * `components`/`instances` order by the same active-membership count
 * subqueries the row exposes; `boundConfig` orders by the joined config
 * label (FR-005).
 */
export const importerSourceListQuerySchema = listParamsBaseSchema
  .extend({
    status: z.enum(IMPORTER_SOURCE_STATUSES).optional(),
    importerName: z.string().optional(),
    sort: z
      .enum([
        "name",
        "importerName",
        "status",
        "boundConfig",
        "components",
        "instances",
        "lastCompletedRunAt",
        "createdAt",
      ])
      .default("createdAt"),
  })
  .strict();

export type ImporterSourceListQuery = z.infer<
  typeof importerSourceListQuerySchema
>;
