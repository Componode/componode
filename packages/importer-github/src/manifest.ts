import { githubConfigSchema } from "./config.js";

export const manifest = {
  name: "github",
  label: "GitHub",
  description:
    "Import GitHub organizations, repositories, environments, billing usage, workflows, runners, and packages as components and instances.",
  version: "1.2.0",
  implPath: "@componode/importer-github/importer",
  reportsSourceIdentity: true,
  // ADR-133: scope key opting a config into declared-edge import (spec 076).
  declaredEdgesConfigKey: "importDeclaredEdges",
  configSchema: githubConfigSchema,
  secrets: [
    { key: "token", label: "Personal access token", required: true },
  ],
};
