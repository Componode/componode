import { webUrlConfigSchema } from "./config.js";

export const manifest = {
  name: "web-url",
  label: "Web URL",
  description: "Import a collection of web endpoints as component profiles with managed URL checks.",
  version: "2.0.0",
  implPath: "@componode/importer-web-url/importer",
  reportsSourceIdentity: true,
  configSchema: webUrlConfigSchema,
  secrets: [],
};
