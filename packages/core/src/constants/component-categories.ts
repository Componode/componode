export const COMPONENT_CATEGORIES = [
  "ACCOUNT",
  "COMPUTE",
  "SERVERLESS",
  "CONTAINER",
  "CONTAINER_ORCHESTRATION",
  "DATABASE",
  "STORAGE",
  "NETWORK",
  "QUEUE",
  "CDN",
  "DNS",
  "CERTIFICATE",
  "SECRET",
  "KMS_KEY",
  "IDENTITY",
  "OBSERVABILITY",
  "API",
  "MCP_SERVER",
  "WEB_ENDPOINT",
  "REPOSITORY",
  "PACKAGE_REGISTRY",
  "DOCUMENTATION",
  "IAC",
  "JOB",
  "LIBRARY",
] as const;

export type ComponentCategory = typeof COMPONENT_CATEGORIES[number];

export const COMPONENT_CATEGORY_META: Record<
  ComponentCategory,
  { label: string; description: string }
> = {
  ACCOUNT: {
    label: "Account",
    description:
      "Provider-level billing and administrative container that owns assets (e.g. GitHub organization, AWS account, Azure subscription)",
  },
  COMPUTE: {
    label: "Compute",
    description: "Virtual machines, bare-metal hosts, and general compute resources",
  },
  SERVERLESS: {
    label: "Serverless",
    description: "Function-as-a-service and serverless compute resources",
  },
  CONTAINER: {
    label: "Container",
    description: "Individual container workloads",
  },
  CONTAINER_ORCHESTRATION: {
    label: "Container Orchestration",
    description: "Orchestrated workload resources such as Kubernetes Deployments or ReplicaSets",
  },
  DATABASE: {
    label: "Database",
    description: "Managed relational, document, and other datastore services",
  },
  STORAGE: {
    label: "Storage",
    description: "Object, block, and file storage services",
  },
  NETWORK: {
    label: "Network",
    description: "Virtual networks, subnets, routing, and connectivity resources",
  },
  QUEUE: {
    label: "Queue",
    description: "Brokers and queues for asynchronous messaging",
  },
  CDN: {
    label: "CDN",
    description: "Content delivery networks and edge distribution",
  },
  DNS: {
    label: "DNS",
    description: "DNS zones, records, and name services",
  },
  CERTIFICATE: {
    label: "Certificate",
    description: "TLS certificates and certificate authorities",
  },
  SECRET: {
    label: "Secret",
    description: "Secret storage and vault entries",
  },
  KMS_KEY: {
    label: "KMS Key",
    description: "Key management service keys",
  },
  IDENTITY: {
    label: "Identity",
    description: "Identity providers, roles, and access management",
  },
  OBSERVABILITY: {
    label: "Observability",
    description: "Monitoring, logging, tracing, and alerting services",
  },
  API: {
    label: "API",
    description: "Managed APIs, API gateways, and API products",
  },
  MCP_SERVER: {
    label: "MCP Server",
    description: "Model Context Protocol servers exposing tools, resources, or prompts",
  },
  WEB_ENDPOINT: {
    label: "Web Endpoint",
    description: "Web-accessible endpoints and URLs",
  },
  REPOSITORY: {
    label: "Repository",
    description: "Source code repositories such as GitHub, GitLab, or Bitbucket repos",
  },
  PACKAGE_REGISTRY: {
    label: "Package Registry",
    description: "Published package and artifact registries",
  },
  DOCUMENTATION: {
    label: "Documentation",
    description: "Documentation sites, wikis, and knowledge bases",
  },
  IAC: {
    label: "IaC",
    description: "Infrastructure-as-code modules, stacks, and definitions",
  },
  JOB: {
    label: "Job",
    description: "Scheduled or ad-hoc batch and job workloads",
  },
  LIBRARY: {
    label: "Library",
    description: "Reusable libraries and SDKs",
  },
};
