import { z } from "zod";
import {
  listOrderSchema,
  listParamsBaseSchema,
  optionalBooleanParam,
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
 * overriding the base `asc` default. `catalog` filters at group level
 * (Phase 2, spec 075): `linked`/`suggested`/`none`, multi-value OR.
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
    // Multi-value OR at the group level (contract): catalog=linked,suggested.
    catalog: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.enum(["linked", "suggested", "none"])))
      .optional(),
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

/**
 * Spec 080: query params for `GET /products/:slug/packages` — the per-product
 * package roll-up. Same standardized list contract as `GET /packages`
 * (ADR-130) with the product-scoped filters: `skew` keeps only
 * multi-version identities; `declared` filters on the declared-dependency
 * signal (the matched Library component is — or is not — in the product's
 * reachable set).
 */
export const listProductPackagesQuerySchema = listParamsBaseSchema
  .extend({
    ecosystem: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.string()))
      .optional(),
    skew: optionalBooleanParam,
    declared: z.enum(["declared", "undeclared"]).optional(),
    sort: z
      .enum(["name", "components", "versions", "ecosystem"])
      .default("components"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListProductPackagesQuery = z.infer<
  typeof listProductPackagesQuerySchema
>;

/**
 * Query params for `GET /products/:slug/packages/consumers` — paginated
 * consumers of one package scoped to the product's reachable set. `purl`
 * stays a query parameter (never a path segment).
 */
export const listProductPackageConsumersQuerySchema = listParamsBaseSchema
  .omit({ search: true })
  .extend({
    purl: z.string().min(1).max(500),
    version: z.string().min(1).max(200).optional(),
    sort: z
      .enum(["name", "version", "scope", "lastReportedAt"])
      .default("name"),
  })
  .strict();

export type ListProductPackageConsumersQuery = z.infer<
  typeof listProductPackageConsumersQuerySchema
>;
