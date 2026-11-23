import { ENVIRONMENTS } from "@componode/core";
import { z } from "zod";

export const DEFAULT_COMPONENT_ID_LABEL = "componode.component-id";

// Unrefined base — `testSecrets` parses `.partial()` configs, which Zod
// refuses on object schemas carrying refinements (github precedent).
export const dockerConfigBase = z
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
    includeSbom: z
      .boolean()
      .default(false)
      .describe("Read each image's SBOM attestations/referrers from its OCI registry (CycloneDX or SPDX) into the bill of materials. Images without an attestation report no inventory"),
    // Spec 078 / ADR-133 — opt-in declared-edge carrier 3. The SBOM fetch
    // is the only edge source, so the switch requires includeSbom
    // (dependent-toggle, carrier-1 shape — no new precondition field).
    importDeclaredEdges: z
      .boolean()
      .default(false)
      .describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later."),
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
    // Opt-out for source-scoped auto ComponentGroups (ADR-129, spec 067):
    // absent/true maintains one auto-group per source; false freezes it.
    autoGroup: z
      .boolean()
      .optional()
      .describe(
        "Automatically maintain a ComponentGroup for this source's exclusively reported components (default true)",
      ),
  })
  .strict();

export const dockerConfigSchema = dockerConfigBase.refine(
  (c) => !c.importDeclaredEdges || c.includeSbom,
  {
    message: "Declared-edge import requires the SBOM inventory",
    path: ["importDeclaredEdges"],
  },
);

export type DockerConfig = z.infer<typeof dockerConfigSchema>;
