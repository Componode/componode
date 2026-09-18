import { awsConfigSchema } from "./config.js";

export const manifest = {
  name: "aws",
  label: "AWS",
  description: "Import AWS cloud assets as components and instances.",
  version: "1.0.0",
  implPath: "@componode/importer-aws/importer",
  configSchema: awsConfigSchema,
  secrets: [],
};
