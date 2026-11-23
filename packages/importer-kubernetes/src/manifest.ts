import { kubernetesConfigSchema } from "./config.js";

export const manifest = {
  name: "kubernetes",
  label: "Kubernetes",
  description: "Import Kubernetes workloads and namespaces as components and instances.",
  version: "1.1.0",
  implPath: "@componode/importer-kubernetes/importer",
  reportsSourceIdentity: true,
  // Spec 079 / ADR-133 — fourth declared-edge carrier; the scope key below
  // activates the backend edge pass + flagged form switch for this importer.
  declaredEdgesConfigKey: "importDeclaredEdges",
  configSchema: kubernetesConfigSchema,
  secrets: [],
};
