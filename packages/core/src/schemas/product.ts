import { z } from "zod";
import { PRODUCT_TYPES } from "../constants/product-types.js";
import { COMPONENT_LIFECYCLE } from "../constants/lifecycle.js";
import { CRITICALITIES } from "../constants/criticality.js";
import { linksSchema, tagSchema, tagsSchema } from "./metadata.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const productTypeSchema = z.enum(PRODUCT_TYPES);
export const productLifecycleSchema = z.enum(COMPONENT_LIFECYCLE);
export const productCriticalitySchema = z.enum(CRITICALITIES);

/** Slug auto-derives from name when omitted (ADR-046 uniqueness enforced by service). */
export const createProductSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().regex(slugPattern).max(100).optional(),
    type: productTypeSchema,
    description: z.string().max(2000).nullable().optional(),
    lobOwnerId: z.string().uuid().nullable().optional(),
    teamOwnerId: z.string().uuid().nullable().optional(),
    links: linksSchema.optional(),
    tags: tagsSchema.optional(),
    criticality: productCriticalitySchema.nullable().optional(),
    sunsetAt: z.string().datetime({ offset: true }).nullable().optional(),
    // Spec 021 US2: create-from-components fast path — the product and its
    // DEPENDS_ON edges commit atomically; mirrors the bulk edge union.
    componentIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().regex(slugPattern).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
    type: productTypeSchema.optional(),
    lifecycle: productLifecycleSchema.optional(),
    lobOwnerId: z.string().uuid().nullable().optional(),
    teamOwnerId: z.string().uuid().nullable().optional(),
    links: linksSchema.optional(),
    tags: tagsSchema.optional(),
    criticality: productCriticalitySchema.nullable().optional(),
    sunsetAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const listProductsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    type: productTypeSchema.optional(),
    lifecycle: productLifecycleSchema.optional(),
    tag: tagSchema.optional(),
    criticality: productCriticalitySchema.optional(),
    includeRetired: z
      .union([z.literal("true"), z.literal("false")])
      .transform((v) => v === "true")
      .optional(),
  })
  .strict();

export const addComposesEdgeSchema = z.object({ childId: z.string().uuid() }).strict();
export const addConsumesFromEdgeSchema = z
  .object({ platformId: z.string().uuid() })
  .strict();
// ADR-110: exactly one target form — a concrete component, a group, or a
// bulk list of components (applied atomically, one audit row per edge).
export const addDependsOnEdgeSchema = z
  .object({
    componentId: z.string().uuid().optional(),
    componentGroupId: z.string().uuid().optional(),
    componentIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (v) =>
      [v.componentId, v.componentGroupId, v.componentIds].filter(
        (x) => x !== undefined,
      ).length === 1,
    {
      message:
        "Provide exactly one of componentId, componentGroupId, or componentIds",
    },
  );

// ADR-017: guided promotion of a shared component into a PLATFORM product.
// `type` is not accepted — always PLATFORM. `consumerIds` selects which
// consumer edges to rewrite; absent = all active direct consumers.
export const promoteToPlatformSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().regex(slugPattern).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
    lobOwnerId: z.string().uuid().nullable().optional(),
    teamOwnerId: z.string().uuid().nullable().optional(),
    links: linksSchema.optional(),
    tags: tagsSchema.optional(),
    criticality: productCriticalitySchema.nullable().optional(),
    sunsetAt: z.string().datetime({ offset: true }).nullable().optional(),
    consumerIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type PromoteToPlatformInput = z.infer<typeof promoteToPlatformSchema>;
