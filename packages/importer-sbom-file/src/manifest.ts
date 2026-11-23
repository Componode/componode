import { sbomFileConfigSchema } from "./config.js";

export const manifest = {
  name: "sbom-file",
  label: "SBOM File",
  description: "Ingest a CycloneDX JSON or SPDX JSON document from a URL onto an existing catalog component's bill of materials.",
  version: "1.1.0",
  implPath: "@componode/importer-sbom-file/importer",
  reportsSourceIdentity: true,
  // ADR-133: scope key opting a config into declared-edge import (spec 077).
  declaredEdgesConfigKey: "importDeclaredEdges",
  configSchema: sbomFileConfigSchema,
  secrets: [],
};
