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
  // Package-registry providers (spec 075 / ADR-013 Amendment 2) — curated
  // Library components promoted from BOM entries carry one of these.
  "NPM",
  "PYPI",
  "MAVEN",
  "NUGET",
  "GOLANG",
  "CARGO",
  "RUBYGEMS",
  "PACKAGIST",
  "GHCR",
  "ECR",
  "DEBIAN",
  "RPM",
  "ALPINE",
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
  NPM: {
    label: "npm",
    description: "JavaScript packages from the npm registry",
  },
  PYPI: {
    label: "PyPI",
    description: "Python packages from PyPI",
  },
  MAVEN: {
    label: "Maven",
    description: "Java/JVM packages from Maven Central",
  },
  NUGET: {
    label: "NuGet",
    description: ".NET packages from NuGet.org",
  },
  GOLANG: {
    label: "Go modules",
    description: "Go packages from the Go module proxy",
  },
  CARGO: {
    label: "Cargo",
    description: "Rust packages from crates.io",
  },
  RUBYGEMS: {
    label: "RubyGems",
    description: "Ruby packages from rubygems.org",
  },
  PACKAGIST: {
    label: "Packagist",
    description: "PHP packages from Packagist",
  },
  GHCR: {
    label: "GitHub Container Registry",
    description: "Container images from GHCR",
  },
  ECR: {
    label: "Amazon ECR",
    description: "Container images from AWS ECR",
  },
  DEBIAN: {
    label: "Debian apt",
    description: "OS packages from Debian/Ubuntu apt",
  },
  RPM: {
    label: "RPM",
    description: "OS packages from Red Hat/Fedora RPM",
  },
  ALPINE: {
    label: "Alpine apk",
    description: "OS packages from Alpine Linux apk",
  },
};

/**
 * Spec 075 / UX-LIB-03 — the Provider filter groups the enum into
 * *Platforms* (the original 11, importers/endpoints) and *Package
 * registries* (the 13 ecosystem providers added for BOM promotion).
 * Ordering inside each group follows `COMPONENT_PROVIDERS`.
 */
export const COMPONENT_PROVIDER_GROUPS = {
  platforms: [
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
  ],
  "package-registries": [
    "NPM",
    "PYPI",
    "MAVEN",
    "NUGET",
    "GOLANG",
    "CARGO",
    "RUBYGEMS",
    "PACKAGIST",
    "GHCR",
    "ECR",
    "DEBIAN",
    "RPM",
    "ALPINE",
  ],
} as const satisfies Record<string, readonly ComponentProvider[]>;

export type ComponentProviderGroup = keyof typeof COMPONENT_PROVIDER_GROUPS;

export const COMPONENT_PROVIDER_GROUP_META: Record<
  ComponentProviderGroup,
  { label: string }
> = {
  platforms: { label: "Platforms" },
  "package-registries": { label: "Package registries" },
};
