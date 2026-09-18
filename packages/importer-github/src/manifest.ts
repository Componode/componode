import { githubConfigSchema } from "./config.js";

export const manifest = {
  name: "github",
  label: "GitHub",
  description:
    "Import GitHub organizations, repositories, environments, billing usage, workflows, runners, and packages as components and instances.",
  version: "1.0.0",
  implPath: "@componode/importer-github/importer",
  configSchema: githubConfigSchema,
  secrets: [
    { key: "token", label: "Personal access token", required: true },
  ],
};
