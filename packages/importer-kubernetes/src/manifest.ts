import { kubernetesConfigSchema } from "./config.js";

export const manifest = {
  name: "kubernetes",
  label: "Kubernetes",
  description: "Import Kubernetes workloads and namespaces as components and instances.",
  version: "1.0.0",
  implPath: "@componode/importer-kubernetes/importer",
  configSchema: kubernetesConfigSchema,
  secrets: [],
};
