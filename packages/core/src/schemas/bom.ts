import { z } from "zod";
import {
  listParamsBaseSchema,
  optionalBooleanParam,
  splitCsvParam,
} from "./list-params.js";
import {
  BOM_DEPENDENCY_SCOPES,
  BOM_EVIDENCE_SOURCES,
} from "../constants/bom-entry.js";

const stringOrStringArray = z.union([z.string(), z.array(z.string())]).optional();

/**
 * Spec 073 / ADR-131: query params for `GET /components/:id/bom` (and the
 * instance-scoped variant with `instanceId` bound). Standardized list
 * contract — page/pageSize/order/search plus the BOM sort whitelist and
 * filters (ADR-130, ADR-095 strict).
 */
export const listBomQuerySchema = listParamsBaseSchema
  .extend({
    scope: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.enum(BOM_DEPENDENCY_SCOPES)))
      .optional(),
    ecosystem: stringOrStringArray,
    found: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.enum(BOM_EVIDENCE_SOURCES)))
      .optional(),
    catalog: z.enum(["linked", "suggested", "none"]).optional(),
    direct: optionalBooleanParam,
    instanceId: z.string().uuid().optional(),
    view: z.enum(["flat", "tree"]).default("flat"),
    parentId: z.string().uuid().optional(),
    sort: z
      .enum(["name", "version", "scope", "ecosystem", "lastReportedAt"])
      .default("name"),
  })
  .strict();

export type ListBomQuery = z.infer<typeof listBomQuerySchema>;

/** Query params for `GET /components/:id/bom/summary`. */
export const bomSummaryQuerySchema = z
  .object({
    instanceId: z.string().uuid().optional(),
  })
  .strict();

export type BomSummaryQuery = z.infer<typeof bomSummaryQuerySchema>;

/** Query params for `GET /components/:id/bom/export`. */
export const bomExportQuerySchema = z
  .object({
    format: z.enum(["json", "cyclonedx", "spdx"]).default("json"),
    instanceId: z.string().uuid().optional(),
  })
  .strict();

export type BomExportQuery = z.infer<typeof bomExportQuerySchema>;
