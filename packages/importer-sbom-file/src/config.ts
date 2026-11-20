import { z } from "zod";
import { urlSafetyError, COMPONENT_CATEGORIES, COMPONENT_PROVIDERS } from "@componode/core";

// Resolved at run dispatch from `componentSlug` → the component's dedup triple
// (category, provider, externalId). Injected into the scope by the backend;
// the importer fails when it is absent — it never invents an identity.
export const resolvedComponentSchema = z.object({
  category: z.enum(COMPONENT_CATEGORIES),
  provider: z.enum(COMPONENT_PROVIDERS),
  externalId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
});
export type ResolvedComponent = z.infer<typeof resolvedComponentSchema>;

export const sbomFileConfigSchema = z.object({
  sbomUrl: z
    .string()
    .url()
    .superRefine((val, ctx) => {
      const reason = urlSafetyError(val);
      if (reason) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `URL is not allowed: ${reason}` });
        return;
      }
      if (new URL(val).protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL is not allowed: HTTPS is required" });
      }
    })
    .describe("HTTPS URL of a CycloneDX JSON or SPDX JSON document to ingest"),
  componentSlug: z
    .string()
    .min(1)
    .describe("Slug of the catalog component this SBOM describes. The document is attached to that component — if it no longer exists at run time the import fails; it never creates a component."),
  // Backend-populated at dispatch; absent in stored configs.
  resolvedComponent: resolvedComponentSchema.optional(),
});

export type SbomFileConfig = z.infer<typeof sbomFileConfigSchema>;
