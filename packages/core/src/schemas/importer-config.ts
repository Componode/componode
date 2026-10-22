import { z } from "zod";

const secretRefSchema = z.object({
  key: z.string().min(1, "Secret key is required"),
  env: z.string().optional(),
  file: z.string().optional(),
}).refine(
  (data) => !!(data.env ?? data.file),
  { message: "Either env or file must be provided", path: ["env"] },
);

export const createImporterConfigSchema = z.object({
  importerName: z.string().min(1, "Importer name is required"),
  label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
  scope: z.record(z.unknown()).default({}),
  secretRefs: z.array(secretRefSchema).default([]),
  // Stored-credential references (junction-linked). Legacy `secretRefs`
  // (env/file) still resolve during the deprecation window (spec 013).
  credentialIds: z.array(z.string().uuid()).default([]),
  // Agent binding (spec 027, ADR-116): the Import Agent that executes this
  // config's runs. null/absent = in-process execution on the hub.
  agentId: z.string().uuid().nullable().default(null),
  schedule: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const updateImporterConfigSchema = createImporterConfigSchema.partial();

export type CreateImporterConfigInput = z.infer<typeof createImporterConfigSchema>;
export type UpdateImporterConfigInput = z.infer<typeof updateImporterConfigSchema>;
