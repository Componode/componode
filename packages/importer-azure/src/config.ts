import { z } from "zod";

export const azureConfigSchema = z
  .object({
    subscriptionId: z.string().optional().describe("Subscription label recorded on the placeholder asset"),
    // Admin-supplied stable source key (ADR-120) — fallback when
    // `subscriptionId` is absent; one of the two is required.
    sourceKey: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Fallback source identity when `subscriptionId` is absent — one of the two is required (ADR-120)"),
    resourceTypes: z
    .array(z.string().min(1))
    .default(["Microsoft.Compute/virtualMachines"])
    .describe("ARM resource type labels; one placeholder component each"),
    endpoint: z
    .string()
    .url()
    .optional()
    .describe("Recorded on the asset's details/url; reserved for a future real connection"),
  })
  .refine(
    (c) => c.subscriptionId || c.sourceKey,
    { message: "subscriptionId or sourceKey is required (source identity)" },
  );

export type AzureConfig = z.infer<typeof azureConfigSchema>;
