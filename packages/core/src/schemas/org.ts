import { z } from "zod";
import { listParamsBaseSchema } from "./list-params.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createOrgEntitySchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().regex(slugPattern).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const updateOrgEntitySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().regex(slugPattern).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

// Team ↔ LOB association (spec 034 / G12): teams only — the base schemas
// stay strict so lobId on a /lobs write is rejected as an unknown field.
export const createTeamSchema = createOrgEntitySchema.extend({
  lobId: z.string().uuid().nullable().optional(),
});

export const updateTeamSchema = updateOrgEntitySchema.extend({
  lobId: z.string().uuid().nullable().optional(),
});

/**
 * Spec 068 / ADR-130: standardized list contract for org entities.
 * `search` is the only filter; derived counts (teamCount/productCount/
 * memberCount/componentCount) are response fields, not params — but they
 * are SQL subqueries, so FR-005 makes them legal sort keys (the service
 * orders by the same SELECT alias the row displays).
 */
export const listLobsQuerySchema = listParamsBaseSchema
  .extend({
    sort: z.enum(["name", "createdAt", "teamCount", "productCount"]).default("name"),
  })
  .strict();

export const listTeamsQuerySchema = listParamsBaseSchema
  .extend({
    // `lob` sorts by the parent Line of Business name (joined column);
    // the count keys order by the same per-row subqueries the columns show.
    sort: z
      .enum(["name", "createdAt", "lob", "memberCount", "productCount", "componentCount"])
      .default("name"),
  })
  .strict();

export type CreateOrgEntityInput = z.infer<typeof createOrgEntitySchema>;
export type UpdateOrgEntityInput = z.infer<typeof updateOrgEntitySchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type ListLobsQuery = z.infer<typeof listLobsQuerySchema>;
export type ListTeamsQuery = z.infer<typeof listTeamsQuerySchema>;
