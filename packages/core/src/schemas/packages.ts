import { z } from "zod";
import {
  listOrderSchema,
  listParamsBaseSchema,
  splitCsvParam,
} from "./list-params.js";
import { BOM_DEPENDENCY_SCOPES } from "../constants/bom-entry.js";

/**
 * Spec 074: query params for `GET /packages` — the workspace where-used
 * rollup (one row per version-free purl). Standardized list contract
 * (ADR-130): page/pageSize/order/search + endpoint sort whitelist and
 * filters; `.strict()` rejects unknown params (ADR-095).
 *
 * Default sort is `components` desc — "most consumed first" — with `order`
 * overriding the base `asc` default. `catalog` is accepted-and-ignored
 * until Phase 2 (`bomCuration`), mirroring listBomQuerySchema (D6).
 */
export const listPackagesQuerySchema = listParamsBaseSchema
  .extend({
    ecosystem: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.string()))
      .optional(),
    scope: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.enum(BOM_DEPENDENCY_SCOPES)))
      .optional(),
    catalog: z.enum(["linked", "suggested", "none"]).optional(),
    sort: z
      .enum(["name", "components", "versions", "ecosystem"])
      .default("components"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListPackagesQuery = z.infer<typeof listPackagesQuerySchema>;

/**
 * Query params for `GET /packages/consumers` — paginated consumers of one
 * package. `purl` is a query parameter (never a path segment — purls
 * contain `:` `/` `@`); the server normalizes it before matching
 * `purlIdentity` (research read contract).
 */
export const listPackageConsumersQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    purl: z.string().min(1).max(500),
    version: z.string().min(1).max(200).optional(),
    sort: z
      .enum(["name", "version", "scope", "lastReportedAt"])
      .default("name"),
  })
  .strict();

export type ListPackageConsumersQuery = z.infer<
  typeof listPackageConsumersQuerySchema
>;
