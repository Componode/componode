import { z } from "zod";
import { listParamsBaseSchema } from "./list-params.js";

export const dockerTargetIdSchema = z.string().trim().min(1).max(200);

export const createDockerTargetSchema = z.object({
  targetId: dockerTargetIdSchema,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  profile: z.record(z.string(), z.unknown()),
}).strict();

export const updateDockerTargetSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const testDockerTargetSchema = z.object({
  configId: z.string().uuid().optional(),
}).strict();

export type CreateDockerTargetInput = z.infer<typeof createDockerTargetSchema>;
export type UpdateDockerTargetInput = z.infer<typeof updateDockerTargetSchema>;
export type TestDockerTargetInput = z.infer<typeof testDockerTargetSchema>;

const probeSecretsSchema = z
  .record(z.string().min(1).max(100), z.string().min(1))
  .refine(
    (d) => new TextEncoder().encode(JSON.stringify(d)).length <= 64 * 1024,
    { message: "Secret payload exceeds 64 KB" },
  );

/**
 * Stateless pre-persistence probe input (spec 063): a prospective non-secret
 * profile plus either inline secret values or a STORED credential id — never
 * both. Persisted target tests keep using {@link testDockerTargetSchema}.
 */
export const probeDockerTargetSchema = z
  .object({
    profile: z.record(z.string(), z.unknown()),
    secrets: probeSecretsSchema.optional(),
    credentialId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => !(v.secrets !== undefined && v.credentialId !== undefined), {
    message: "Provide either secrets or credentialId, not both",
  });

export type ProbeDockerTargetInput = z.infer<typeof probeDockerTargetSchema>;

/**
 * Spec 068 / ADR-130: standardized list contract for GET /docker-targets.
 * `name` sorts by the target's display `label` column; `targetId`/`enabled`
 * are the stored columns the Target ID/Status cells render (the transport
 * cell is a JSONB profile field, so it has no sort key).
 */
export const listDockerTargetsQuerySchema = listParamsBaseSchema
  .extend({
    sort: z.enum(["name", "targetId", "enabled", "createdAt"]).default("name"),
  })
  .strict();

export type ListDockerTargetsQuery = z.infer<typeof listDockerTargetsQuerySchema>;

export interface DockerTarget {
  id: string;
  targetId: string;
  label: string;
  description: string | null;
  profile: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
