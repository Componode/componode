import { azureConfigSchema } from "./config.js";

export const manifest = {
  name: "azure",
  label: "Azure",
  description: "Import Azure cloud assets as components and instances.",
  version: "1.0.0",
  implPath: "@componode/importer-azure/importer",
  configSchema: azureConfigSchema,
  secrets: [],
};
