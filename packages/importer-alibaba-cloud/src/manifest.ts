import { alibabaCloudConfigSchema } from "./config.js";

export const manifest = {
  name: "alibaba-cloud",
  label: "Alibaba Cloud",
  description: "Import Alibaba Cloud account resources via Resource Center.",
  version: "1.0.0",
  implPath: "@componode/importer-alibaba-cloud/importer",
  configSchema: alibabaCloudConfigSchema,
  secrets: [
    { key: "accessKeyId", label: "AccessKey ID", required: true },
    { key: "accessKeySecret", label: "AccessKey Secret", required: true },
    { key: "securityToken", label: "STS security token", required: false },
  ],
};
