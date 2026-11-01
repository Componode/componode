import { ENVIRONMENTS } from "@componode/core";
import { z } from "zod";

export const DEFAULT_COMPONENT_ID_LABEL = "componode.component-id";

export const dockerConfigSchema = z
  .object({
    // Names an allowlisted profile in the agent's docker-targets.json
    // (manifest.targetRefKey = "targetId", ADR-116 A5/A6).
    targetId: z
      .string()
      .min(1)
      .max(200)
      .describe("Hub: a managed Docker target; Agent: a profile in docker-targets.json"),
    // Label key read for environment mapping — container labels first,
    // then Compose service labels; unmapped/absent → OTHER (ADR-121).
    environmentLabel: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Docker label key read for environment mapping (container labels, then Compose service labels)"),
    environmentMap: z
      .record(z.string(), z.enum(ENVIRONMENTS))
      .optional()
      .describe("Map of label value to environment; unmapped values fall back to OTHER"),
    includeImages: z
      .boolean()
      .default(false)
      .describe("Import cached images as PACKAGE_REGISTRY components"),
    // Workload-identity override label (default componode.component-id).
    componentIdLabel: z
      .string()
      .trim()
      .min(1)
      .default(DEFAULT_COMPONENT_ID_LABEL)
      .describe("Workload-identity override label"),
    // Admin-supplied stable source identity — fallback when the engine
    // reports no /info.ID (ADR-120 precedent).
    sourceKey: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Fallback source identity when the engine reports no /info.ID"),
  })
  .strict();

export type DockerConfig = z.infer<typeof dockerConfigSchema>;
