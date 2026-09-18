import { apiUrlConfigSchema } from "./config.js";

export const manifest = {
  name: "api-url",
  label: "API URL",
  description: "Import an API URL endpoint as a component instance.",
  version: "1.0.0",
  implPath: "@componode/importer-api-url/importer",
  configSchema: apiUrlConfigSchema,
  secrets: [],
};
