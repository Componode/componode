import { webUrlConfigSchema } from "./config.js";

export const manifest = {
  name: "web-url",
  label: "Web URL",
  description: "Import a web URL endpoint as a component instance.",
  version: "1.0.0",
  implPath: "@componode/importer-web-url/importer",
  configSchema: webUrlConfigSchema,
  secrets: [],
};
