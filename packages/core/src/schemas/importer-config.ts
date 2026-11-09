import { z } from "zod";
import { ENVIRONMENTS } from "../constants/environments.js";
import {
  URL_CHECK_AUTH_MODES,
  URL_CHECK_AUTO_DISABLE_AFTER_MAX,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_METHODS,
  URL_CHECK_MIN_CADENCE_SECONDS,
  URL_CHECK_WINDOWS,
} from "../constants/url-check.js";
import { authConfigSchema, successPolicySchema } from "./url-check.js";
import { urlSafetyError } from "../validation/url-safety.js";
import {
  listParamsBaseSchema,
  listOrderSchema,
  optionalBooleanParam,
} from "./list-params.js";

const secretRefSchema = z.object({
  key: z.string().min(1, "Secret key is required"),
  env: z.string().optional(),
  file: z.string().optional(),
}).refine(
  (data) => !!(data.env ?? data.file),
  { message: "Either env or file must be provided", path: ["env"] },
);

const importerConfigBaseSchema = z.object({
  importerName: z.string().min(1, "Importer name is required"),
  label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
  scope: z.record(z.string(), z.unknown()),
  secretRefs: z.array(secretRefSchema),
  // Stored-credential references (junction-linked). Legacy `secretRefs`
  // (env/file) still resolve during the deprecation window (spec 013).
  credentialIds: z.array(z.string().uuid()),
  // Agent binding (spec 027, ADR-116): the Import Agent that executes this
  // config's runs. null/absent = in-process execution on the hub.
  agentId: z.string().uuid().nullable(),
  schedule: z.string().nullish(),
  enabled: z.boolean(),
});

export const createImporterConfigSchema = importerConfigBaseSchema.extend({
  scope: importerConfigBaseSchema.shape.scope.default({}),
  secretRefs: importerConfigBaseSchema.shape.secretRefs.default([]),
  credentialIds: importerConfigBaseSchema.shape.credentialIds.default([]),
  agentId: importerConfigBaseSchema.shape.agentId.default(null),
  enabled: importerConfigBaseSchema.shape.enabled.default(true),
});

// Derived from the defaults-free base: under Zod 4, `.partial()` lets a
// field's `.default()` fire when the key is absent, which would inject
// defaults into PATCH payloads and silently reset fields the caller
// never sent.
export const updateImporterConfigSchema = importerConfigBaseSchema.partial();

export type CreateImporterConfigInput = z.infer<typeof createImporterConfigSchema>;
export type UpdateImporterConfigInput = z.infer<typeof updateImporterConfigSchema>;

/**
 * Spec 068 / ADR-130: standardized list contract for GET /importer-configs.
 * The config row exposes `enabled` (paused/running) rather than a status
 * enum and no persisted last-run column — `status`/`lastRunAt` contract
 * keys map to `enabled` here; `name` sorts by the `label` column.
 */
export const listImporterConfigsQuerySchema = listParamsBaseSchema
  .extend({
    importerName: z.string().max(100).optional(),
    enabled: optionalBooleanParam,
    sort: z
      .enum(["name", "importerName", "enabled", "createdAt", "updatedAt"])
      .default("createdAt"),
    order: listOrderSchema.default("desc"),
  })
  .strict();

export type ListImporterConfigsQuery = z.infer<
  typeof listImporterConfigsQuerySchema
>;

// ---------------------------------------------------------------------------
// Web/API collection scope v2 (spec 058, ADR-126): ImporterConfig.scope is the
// canonical declaration of Component profiles, their ComponentInstances, and
// one managed URL Check definition per instance. Stable generated keys — not
// names or URLs — drive identity.
// ---------------------------------------------------------------------------

const enumOf = <T extends readonly string[]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]);

const checkUrl = z.string().min(1).max(2048);

// One managed URL Check definition for a configured ComponentInstance.
// Vantage and default cadence come from the Component monitoring setup;
// `url` defaults to the instance URL when omitted.
export const managedCheckDefinitionSchema = z
  .object({
    checkKey: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    url: checkUrl.optional(),
    method: enumOf(URL_CHECK_METHODS).default("GET"),
    enabled: z.boolean().default(true),
    successPolicy: successPolicySchema.default({
      codes: [],
      ranges: [{ min: 200, max: 299 }],
    }),
    cadenceSeconds: z
      .number()
      .int()
      .min(URL_CHECK_MIN_CADENCE_SECONDS)
      .max(URL_CHECK_MAX_CADENCE_SECONDS)
      .nullable()
      .optional(),
    authMode: enumOf(URL_CHECK_AUTH_MODES).default("NONE"),
    credentialId: z.string().uuid().nullable().optional(),
    authConfig: authConfigSchema.nullable().optional(),
    availabilityTarget: z.number().min(0).max(100).nullable().optional(),
    targetWindow: enumOf(URL_CHECK_WINDOWS).nullable().optional(),
    autoDisableAfter: z
      .number()
      .int()
      .min(0)
      .max(URL_CHECK_AUTO_DISABLE_AFTER_MAX)
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.availabilityTarget == null && v.targetWindow == null) ||
      (v.availabilityTarget != null && v.targetWindow != null),
    {
      message:
        "availabilityTarget and targetWindow must be set together or both omitted",
    },
  )
  .refine((v) => v.authMode === "NONE" || v.credentialId != null, {
    message: "credentialId is required when authMode is not NONE",
  })
  .refine((v) => v.authMode !== "NONE" || v.authConfig == null, {
    message: "authConfig is only allowed with an auth mode",
  });

export const managedInstanceDefinitionSchema = z
  .object({
    instanceKey: z.string().uuid(),
    environment: z.enum(ENVIRONMENTS),
    url: checkUrl,
    region: z.string().max(100).optional(),
    version: z.string().max(100).optional(),
    check: managedCheckDefinitionSchema,
  })
  .strict();

export const componentProfileSchema = z
  .object({
    componentKey: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    instances: z.array(managedInstanceDefinitionSchema).min(1),
  })
  .strict();

export const collectionScopeSchema = z
  .object({
    sourceKey: z.string().uuid(),
    components: z.array(componentProfileSchema).min(1),
  })
  .strict()
  .superRefine((scope, ctx) => {
    const componentKeys = new Set<string>();
    const checkKeys = new Set<string>();
    scope.components.forEach((comp, ci) => {
      if (!componentKeys.add(comp.componentKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["components", ci, "componentKey"],
          message: "Duplicate componentKey — stable keys must be unique within the collection",
        });
      }
      const instanceKeys = new Set<string>();
      comp.instances.forEach((inst, ii) => {
        if (!instanceKeys.add(inst.instanceKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["components", ci, "instances", ii, "instanceKey"],
            message: "Duplicate instanceKey — stable keys must be unique within the profile",
          });
        }
        if (!checkKeys.add(inst.check.checkKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["components", ci, "instances", ii, "check", "checkKey"],
            message: "Duplicate checkKey — a check key may only be declared once per collection",
          });
        }
      });
    });
  });

export type ManagedCheckDefinition = z.infer<typeof managedCheckDefinitionSchema>;
export type ManagedInstanceDefinition = z.infer<typeof managedInstanceDefinitionSchema>;
export type ComponentProfile = z.infer<typeof componentProfileSchema>;
export type CollectionScope = z.infer<typeof collectionScopeSchema>;

// Shared URL-safety refinement for collection-scope importer packages
// (spec 058): validates every instance URL and optional check URL override
// against the SSRF rules in validation/url-safety.ts. `addIssue` receives
// (path, message) — importer packages wire it to their zod refinement ctx.
export function assertCollectionUrlSafety(
  scope: CollectionScope,
  addIssue: (path: (string | number)[], message: string) => void,
): void {
  for (const [ci, component] of scope.components.entries()) {
    for (const [ii, instance] of component.instances.entries()) {
      const base: (string | number)[] = ["components", ci, "instances", ii];
      const reason = urlSafetyError(instance.url);
      if (reason) addIssue([...base, "url"], `URL is not allowed: ${reason}`);
      const checkUrl = instance.check.url;
      if (checkUrl) {
        const checkReason = urlSafetyError(checkUrl);
        if (checkReason) {
          addIssue([...base, "check", "url"], `URL is not allowed: ${checkReason}`);
        }
      }
    }
  }
}
