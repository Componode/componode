import { sbomFileConfigSchema } from "./config.js";

export const manifest = {
  name: "sbom-file",
  label: "SBOM File",
  description: "Ingest a CycloneDX JSON or SPDX JSON document from a URL onto an existing catalog component's bill of materials.",
  version: "1.0.0",
  implPath: "@componode/importer-sbom-file/importer",
  reportsSourceIdentity: true,
  configSchema: sbomFileConfigSchema,
  secrets: [],
};
