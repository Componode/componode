import { z } from "zod";
import { listParamsBaseSchema } from "./list-params.js";

// Spec 075 / ADR-132 — curation query/body schemas. `.strict()` rejects
// unknown fields (ADR-095); purls stay query params (never path segments —
// they contain `:` `/` `@`).

/** GET /packages/add-to-catalog/preview query. */
export const addToCatalogPreviewQuerySchema = z
  .object({
    purl: z.string().min(1).max(500),
  })
  .strict();

export type AddToCatalogPreviewQuery = z.infer<
  typeof addToCatalogPreviewQuerySchema
>;

/** POST /packages/add-to-catalog body. */
export const addToCatalogBodySchema = z
  .object({
    purl: z.string().min(1).max(500),
    linkConsumers: z.boolean(),
  })
  .strict();

export type AddToCatalogBody = z.infer<typeof addToCatalogBodySchema>;

/** POST /packages/link body. */
export const linkPackageBodySchema = z
  .object({
    purl: z.string().min(1).max(500),
    componentId: z.string().uuid(),
    linkConsumers: z.boolean(),
  })
  .strict();

export type LinkPackageBody = z.infer<typeof linkPackageBodySchema>;

/** GET /packages/versions query — every version for one identity. */
export const listPackageVersionsQuerySchema = listParamsBaseSchema
  .omit({ search: true, order: true })
  .extend({
    purl: z.string().min(1).max(500),
  })
  .strict();

export type ListPackageVersionsQuery = z.infer<
  typeof listPackageVersionsQuerySchema
>;
