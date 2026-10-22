import { z } from "zod";

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
  schedule: z.string().optional(),
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
