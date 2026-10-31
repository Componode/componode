import { z } from "zod";

export const azureConfigSchema = z
  .object({
    subscriptionId: z.string().optional(),
    // Admin-supplied stable source key (ADR-120) — fallback when
    // `subscriptionId` is absent; one of the two is required.
    sourceKey: z.string().trim().min(1).optional(),
    resourceTypes: z.array(z.string().min(1)).default(["Microsoft.Compute/virtualMachines"]),
    endpoint: z.string().url().optional(),
  })
  .refine(
    (c) => c.subscriptionId || c.sourceKey,
    { message: "subscriptionId or sourceKey is required (source identity)" },
  );

export type AzureConfig = z.infer<typeof azureConfigSchema>;
