import { z } from "zod";
import { COMPONENT_CATEGORIES } from "../constants/component-categories.js";
import { COMPONENT_PROVIDERS } from "../constants/component-providers.js";
import { ENVIRONMENTS } from "../constants/environments.js";
import { linksSchema, tagSchema, tagsSchema } from "./metadata.js";
import {
  createInstanceBlockSchema,
  createMonitoringBlockSchema,
} from "./url-check.js";
import {
  listParamsBaseSchema,
  splitCsvParam,
  toBooleanParam,
} from "./list-params.js";

const lifecycleEnum = ["ACTIVE", "RETIRED"] as [string, ...string[]];

const enumOf = <T extends readonly string[]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]);

const stringOrStringArray = z.union([z.string(), z.array(z.string())]).optional();

/**
 * Spec 068 / ADR-130: standardized list contract — shared page/pageSize/
 * order/search params plus the endpoint's sort whitelist and filters.
 * Sort keys map to displayed columns: `owner` → joined team name,
 * `health` → worst-instance-status CASE, `instances` → instance count,
 * `lastSeenAt` → max instance last-seen.
 */
export const listComponentsQuerySchema = listParamsBaseSchema
  .extend({
    category: stringOrStringArray,
    provider: stringOrStringArray,
    lifecycle: stringOrStringArray,
    status: stringOrStringArray,
    componentGroup: stringOrStringArray,
    group: stringOrStringArray,
    wired: z
      .union([z.string(), z.array(z.string())])
      .transform(splitCsvParam)
      .pipe(z.array(z.enum(["wired", "unwired"])))
      .optional(),
    tag: tagSchema.optional(),
    sort: z
      .enum([
        "name",
        "category",
        "resourceType",
        "owner",
        "health",
        "instances",
        "lastSeenAt",
      ])
      .default("name"),
    includeRetired: z.preprocess(toBooleanParam, z.boolean().default(false)),
    includeGone: z.preprocess(toBooleanParam, z.boolean().default(false)),
  })
  .strict();

/** Spec 060: query params for the read-only Component relationships read. */
export const componentRelationshipsQuerySchema = z.object({
  includeGone: z.preprocess(toBooleanParam, z.boolean().default(false)),
}).strict();

export const updateComponentGroupAssignmentSchema = z.object({
  // Spec 070: multi-membership — the desired set of HUMAN-managed group
  // memberships (auto-managed groups are system-owned and rejected
  // service-side). Absent = unchanged; [] = clear human memberships.
  componentGroupIds: z.array(z.string().uuid()).optional(),
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

/**
 * Manual component creation (spec 042, gap G29). Importer-managed columns
 * (externalId, lastSeen*, details) are never accepted.
 */
export const createComponentSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name must be 200 characters or less"),
  slug: z.string().min(1, "Slug is required").max(100, "Slug must be 100 characters or less"),
  category: z.enum(COMPONENT_CATEGORIES as unknown as [string, ...string[]]),
  provider: z.enum(COMPONENT_PROVIDERS as unknown as [string, ...string[]]),
  resourceType: z.string().min(1, "Resource type is required").max(100),
  teamOwnerId: z.string().uuid().optional(),
  componentGroupIds: z.array(z.string().uuid()).optional(),
  links: linksSchema.optional(),
  tags: tagsSchema.optional(),
  sunsetAt: z.string().datetime({ offset: true }).nullable().optional(),
  // Composite create-with-checks (spec 051 US5): `monitoring` requires
  // `instance` — enforced at the service layer.
  instance: createInstanceBlockSchema.optional(),
  monitoring: createMonitoringBlockSchema.optional(),
}).strict();

export const createComponentGroupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  slug: z.string().min(1, "Slug is required").max(100, "Slug must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
  teamOwnerId: z.string().uuid().optional(),
});

export const updateComponentGroupSchema = createComponentGroupSchema
  .partial()
  .extend({
    // Bugfix 066: explicit null clears description/teamOwnerId — the service
    // already persists `?? null`; create stays non-nullable.
    description: z
      .string()
      .max(500, "Description must be 500 characters or less")
      .nullable()
      .optional(),
    teamOwnerId: z.string().uuid().nullable().optional(),
    lifecycle: z.enum(lifecycleEnum).optional(),
  });

/**
 * Spec 071: environment override on a ComponentInstance. The key is
 * required — a catalog environment sets the override, explicit `null`
 * clears it (effective returns to the latest importer-reported value).
 */
export const updateComponentInstanceSchema = z
  .object({
    environment: enumOf(ENVIRONMENTS).nullable(),
  })
  .strict();

/**
 * Spec 068 / ADR-130: standardized list contract for component groups —
 * shared params plus `lifecycle`/`includeRetired` filters. An explicit
 * `lifecycle` value overrides the default RETIRED exclusion (service-side).
 */
export const listComponentGroupsQuerySchema = listParamsBaseSchema
  .extend({
    lifecycle: z.enum(lifecycleEnum).optional(),
    includeRetired: z.preprocess(toBooleanParam, z.boolean().default(false)),
    sort: z.enum(["name", "lifecycle", "createdAt"]).default("name"),
  })
  .strict();

export type ListComponentsQuery = z.infer<typeof listComponentsQuerySchema>;
export type ComponentRelationshipsQuery = z.infer<typeof componentRelationshipsQuerySchema>;
export type UpdateComponentGroupAssignmentInput = z.infer<typeof updateComponentGroupAssignmentSchema>;
export type UpdateComponentInput = z.infer<typeof updateComponentSchema>;
export type CreateComponentInput = z.infer<typeof createComponentSchema>;
export type CreateComponentGroupInput = z.infer<typeof createComponentGroupSchema>;
export type UpdateComponentGroupInput = z.infer<typeof updateComponentGroupSchema>;
export type ListComponentGroupsQuery = z.infer<typeof listComponentGroupsQuerySchema>;
export type UpdateComponentInstanceInput = z.infer<typeof updateComponentInstanceSchema>;
