import { z } from "zod";
import { IMPORT_RUN_STATUS } from "../constants/import-run-status.js";
import { listParamsBaseSchema, listOrderSchema } from "./list-params.js";

/**
 * Spec 068 / ADR-130: standardized list contracts for the run-scoped
 * importer endpoints. Sort keys map to real `import_runs` /
 * `import_run_errors` / `entity_changes` columns — `completedAt` is the
 * run's finished timestamp; `assetsProcessed` is the stored counter the
 * run history's "Processed" column renders.
 *
 * The runs/errors/changes services apply no `search` filter, so the
 * shared `search` param is omitted from their contracts — a `?search=`
 * query is rejected as an unknown param (strict schema, ADR-095).
 */

/** GET /importer-configs/:id/runs */
export const listImporterRunsQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    status: z.enum(IMPORT_RUN_STATUS).optional(),
    sort: z
      .enum(["startedAt", "createdAt", "status", "completedAt", "assetsProcessed"])
      .default("createdAt"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

/**
 * GET /importer-configs/:configId/runs/:runId/errors — `errorType` is the
 * run-error "code" column the contract's code/severity filter maps to;
 * `assetExternalId`/`errorMessage` are the stored columns the errors table
 * renders (FR-005).
 */
export const listRunErrorsQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    errorType: z.string().max(100).optional(),
    sort: z
      .enum(["createdAt", "errorType", "assetExternalId", "errorMessage"])
      .default("createdAt"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

/**
 * GET /importer-configs/:configId/runs/:runId/changes — `entity_changes`
 * rows for the run; `action` is the change-type column the contract's
 * action filter maps to. `entityType`/`actor` order by the stored
 * `entityType`/`createdByName` columns behind the Type/Actor cells
 * (actor coalesces the "importer" fallback the row renders).
 */
export const listRunChangesQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    action: z.string().max(100).optional(),
    sort: z.enum(["createdAt", "action", "entityType", "actor"]).default("createdAt"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListImporterRunsQuery = z.infer<typeof listImporterRunsQuerySchema>;
export type ListRunErrorsQuery = z.infer<typeof listRunErrorsQuerySchema>;
export type ListRunChangesQuery = z.infer<typeof listRunChangesQuerySchema>;
