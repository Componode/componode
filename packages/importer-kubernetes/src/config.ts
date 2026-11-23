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
    includePodImageSbom: z
    .boolean()
    .default(false)
    .describe("Read the SBOM of each container image running in pods and attach it to the workload's bill of materials. Requires `endpoint` plus anonymous pull access to the images' registries"),
    // Spec 079 / ADR-133 — opt-in declared-edge carrier 4. The pod-image
    // SBOM fetch is the only edge source, so the switch requires
    // includePodImageSbom (dependent-toggle, carriers 1/3 shape).
    importDeclaredEdges: z
    .boolean()
    .default(false)
    .describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later."),
  })
  .refine(
    (c) => c.endpoint || c.sourceKey,
    { message: "endpoint or sourceKey is required (source identity)" },
  )
  .refine(
    (c) => !c.importDeclaredEdges || c.includePodImageSbom,
    {
      message: "Declared-edge import requires the pod-image SBOM inventory",
      path: ["importDeclaredEdges"],
    },
  );

export type KubernetesConfig = z.infer<typeof kubernetesConfigSchema>;
