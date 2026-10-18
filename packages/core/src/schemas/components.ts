import { z } from "zod";
import { linksSchema, tagSchema, tagsSchema } from "./metadata.js";

const lifecycleEnum = ["ACTIVE", "RETIRED"] as [string, ...string[]];

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

const stringOrStringArray = z.union([z.string(), z.array(z.string())]).optional();

export const listComponentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  category: stringOrStringArray,
  provider: stringOrStringArray,
  lifecycle: stringOrStringArray,
  status: stringOrStringArray,
  componentGroup: stringOrStringArray,
  group: stringOrStringArray,
  tag: tagSchema.optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(["name", "lastSeenAt", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  includeRetired: z.preprocess(toBoolean, z.boolean().default(false)),
  includeGone: z.preprocess(toBoolean, z.boolean().default(false)),
});

export const updateComponentGroupAssignmentSchema = z.object({
  componentGroupId: z.string().uuid().nullable().optional(),
  teamOwnerId: z.string().uuid().nullable().optional(),
});

/** General component update (spec 017): group/owner assignment plus curated metadata. */
export const updateComponentSchema = updateComponentGroupAssignmentSchema
  .extend({
    links: linksSchema.optional(),
    tags: tagsSchema.optional(),
    sunsetAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const createComponentGroupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  slug: z.string().min(1, "Slug is required").max(100, "Slug must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
  teamOwnerId: z.string().uuid().optional(),
});

export const updateComponentGroupSchema = createComponentGroupSchema
  .partial()
  .extend({
    lifecycle: z.enum(lifecycleEnum).optional(),
  });

export const listComponentGroupsQuerySchema = z.object({
  lifecycle: z.string().optional(),
});

export type ListComponentsQuery = z.infer<typeof listComponentsQuerySchema>;
export type UpdateComponentGroupAssignmentInput = z.infer<typeof updateComponentGroupAssignmentSchema>;
export type UpdateComponentInput = z.infer<typeof updateComponentSchema>;
export type CreateComponentGroupInput = z.infer<typeof createComponentGroupSchema>;
export type UpdateComponentGroupInput = z.infer<typeof updateComponentGroupSchema>;
export type ListComponentGroupsQuery = z.infer<typeof listComponentGroupsQuerySchema>;
