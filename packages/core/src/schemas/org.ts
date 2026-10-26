import { z } from "zod";

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

export type CreateOrgEntityInput = z.infer<typeof createOrgEntitySchema>;
export type UpdateOrgEntityInput = z.infer<typeof updateOrgEntitySchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
