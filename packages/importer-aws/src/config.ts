import { z } from "zod";

export const awsConfigSchema = z.object({
  region: z.string().default("us-east-1"),
  resourceTypes: z.array(z.string().min(1)).default(["ec2:instance"]),
  endpoint: z.string().url().optional(),
  // Admin-supplied stable source key (ADR-120) — required: the importer
  // has no provider identity source without it.
  sourceKey: z.string().trim().min(1),
});

export type AwsConfig = z.infer<typeof awsConfigSchema>;
