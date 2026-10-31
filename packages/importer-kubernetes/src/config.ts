import { z } from "zod";

export const kubernetesConfigSchema = z.object({
  namespace: z.string().default("default"),
  resourceTypes: z.array(z.string().min(1)).default(["apps/v1:Deployment"]),
  endpoint: z.string().url().optional(),
  // Admin-supplied stable source key (ADR-120) — fallback when `endpoint`
  // is absent; one of the two is required at run time.
  sourceKey: z.string().trim().min(1).optional(),
});

export type KubernetesConfig = z.infer<typeof kubernetesConfigSchema>;
