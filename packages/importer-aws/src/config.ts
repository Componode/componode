import { z } from "zod";

export const awsConfigSchema = z.object({
  region: z.string().default("us-east-1").describe("Region label recorded on the placeholder asset"),
  resourceTypes: z
    .array(z.string().min(1))
    .default(["ec2:instance"])
    .describe("Resource type labels; one placeholder component each"),
  endpoint: z
    .string()
    .url()
    .optional()
    .describe("Recorded on the asset's details/url; reserved for a future real connection"),
  // Admin-supplied stable source key (ADR-120) — required: the importer
  // has no provider identity source without it.
  sourceKey: z
    .string()
    .trim()
    .min(1)
    .describe("Stable non-secret key identifying the AWS account — the source identity (ADR-120)"),
});

export type AwsConfig = z.infer<typeof awsConfigSchema>;
