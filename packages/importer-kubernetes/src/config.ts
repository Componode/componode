import { z } from "zod";

export const kubernetesConfigSchema = z
  .object({
    namespace: z.string().default("default").describe("Namespace label recorded on the placeholder asset"),
    resourceTypes: z
    .array(z.string().min(1))
    .default(["apps/v1:Deployment"])
    .describe("`apiVersion:Kind` labels; one placeholder component each"),
    endpoint: z
    .string()
    .url()
    .optional()
    .describe("Recorded on the asset's details/url; reserved for the API server address"),
    // Admin-supplied stable source key (ADR-120) — fallback when
    // `endpoint` is absent; one of the two is required.
    sourceKey: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Fallback source identity when `endpoint` is absent — one of the two is required (ADR-120)"),
  })
  .refine(
    (c) => c.endpoint || c.sourceKey,
    { message: "endpoint or sourceKey is required (source identity)" },
  );

export type KubernetesConfig = z.infer<typeof kubernetesConfigSchema>;
