import { z } from "zod";
import { productTypeSchema, productCriticalitySchema } from "./product.js";
import { tagsSchema } from "./metadata.js";

/**
 * ADR-114 catalog bootstrap import — the declarative document uploaded to
 * POST /api/v1/products/bootstrap. Strict at every level: unknown fields
 * reject the whole document. Owner sub-keys are entity slugs (resolved at
 * apply time); `null` clears the corresponding owner column.
 */
export const bootstrapOwnerSchema = z
  .object({
    lob: z.string().min(1).max(100).nullable().optional(),
    team: z.string().min(1).max(100).nullable().optional(),
  })
  .strict();

export const bootstrapProductItemSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: productTypeSchema,
    description: z.string().max(2000).nullable().optional(),
    owner: bootstrapOwnerSchema.optional(),
    tags: tagsSchema.optional(),
    criticality: productCriticalitySchema.nullable().optional(),
    sunsetAt: z.string().datetime({ offset: true }).nullable().optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const bootstrapDocumentSchema = z
  .object({
    version: z.literal(1),
    products: z.array(bootstrapProductItemSchema),
  })
  .strict();

export type BootstrapOwner = z.infer<typeof bootstrapOwnerSchema>;
export type BootstrapProductItem = z.infer<typeof bootstrapProductItemSchema>;
export type BootstrapDocument = z.infer<typeof bootstrapDocumentSchema>;
