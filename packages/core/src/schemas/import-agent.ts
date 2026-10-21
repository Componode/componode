import { z } from "zod";

// k8s-label style: env/shell/audit safe (spec 025 clarification).
export const AGENT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const agentName = z
  .string()
  .min(1, "Name is required")
  .max(63, "Name must be 63 characters or less")
  .regex(
    AGENT_NAME_PATTERN,
    "Name must be lowercase alphanumeric with hyphens, starting and ending alphanumeric",
  );

const allowedImporters = z.array(z.string().min(1));

export const createImportAgentSchema = z
  .object({
    name: agentName,
    allowedImporters: allowedImporters.optional(),
  })
  .strict();

export const updateImportAgentSchema = z
  .object({
    name: agentName.optional(),
    allowedImporters: allowedImporters.optional(),
  })
  .strict()
  // An empty PATCH would write a meaningless `updated` audit row.
  .refine((o) => o.name !== undefined || o.allowedImporters !== undefined, {
    message: "At least one field must be provided",
  });

export const enrollAgentRequestSchema = z
  .object({
    token: z.string().min(1, "Token is required"),
  })
  .strict();

export const listAgentSessionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type CreateImportAgentInput = z.infer<typeof createImportAgentSchema>;
export type UpdateImportAgentInput = z.infer<typeof updateImportAgentSchema>;
export type EnrollAgentRequest = z.infer<typeof enrollAgentRequestSchema>;
export type ListAgentSessionsQuery = z.infer<
  typeof listAgentSessionsQuerySchema
>;
