import { apiUrlConfigSchema } from "./config.js";

export const manifest = {
  name: "api-url",
  label: "API URL",
  description: "Import a collection of API endpoints as component profiles with managed URL checks.",
  version: "2.0.0",
  implPath: "@componode/importer-api-url/importer",
  reportsSourceIdentity: true,
  configSchema: apiUrlConfigSchema,
  secrets: [],
};
