export const COMPONENT_PROVIDERS = [
  "GITHUB",
  "AWS",
  "AZURE",
  "GOOGLE_CLOUD",
  "ALIBABA_CLOUD",
  "KUBERNETES",
  "DOCKER",
  "WEB_URL",
  "API_URL",
  "MCP_SERVER",
  "OTHER",
] as const;

export type ComponentProvider = typeof COMPONENT_PROVIDERS[number];

export const COMPONENT_PROVIDER_META: Record<
  ComponentProvider,
  { label: string; description: string }
> = {
  GITHUB: {
    label: "GitHub",
    description: "Repositories discovered from GitHub",
  },
  AWS: {
    label: "AWS",
    description: "Cloud assets discovered from Amazon Web Services",
  },
  AZURE: {
    label: "Azure",
    description: "Cloud assets discovered from Microsoft Azure",
  },
  GOOGLE_CLOUD: {
    label: "Google Cloud",
    description: "Cloud assets discovered from Google Cloud Platform",
  },
  ALIBABA_CLOUD: {
    label: "Alibaba Cloud",
    description: "Cloud assets discovered from Alibaba Cloud",
  },
  KUBERNETES: {
    label: "Kubernetes",
    description: "Workloads and namespaces discovered from a Kubernetes cluster",
  },
  DOCKER: {
    label: "Docker",
    description: "Containers and images discovered from a Docker host",
  },
  WEB_URL: {
    label: "Web URL",
    description: "Endpoints discovered by probing a web URL",
  },
  API_URL: {
    label: "API URL",
    description: "APIs discovered by probing an API URL (OpenAPI/health)",
  },
  MCP_SERVER: {
    label: "MCP Server",
    description: "Tools and resources discovered from an MCP server",
  },
  OTHER: {
    label: "Other",
    description: "Component sourced from a provider not yet modeled",
  },
};
