import { z } from "zod";

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
