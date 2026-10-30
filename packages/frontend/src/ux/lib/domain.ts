/**
 * Mirrors @componode/core constants. In the real app import the *_META maps from
 * @componode/core and only keep the `tone` mapping below in the frontend.
 */

export type Tone = "neutral" | "success" | "warning" | "destructive" | "info" | "brand"

export type Role = "ADMIN" | "EDITOR" | "VIEWER"
export type ProductType = "BUSINESS_CAPABILITY" | "PLATFORM" | "CUSTOMER_FACING"
export type Criticality = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
export type Lifecycle = "ACTIVE" | "RETIRED"
export type HealthStatus = "RUNNING" | "STOPPED" | "ERROR"
export type InstanceStatus = "RUNNING" | "STOPPED" | "ERROR" | "GONE"
export type Environment = "DEV" | "TEST" | "STAGING" | "DEMO" | "PRODUCTION" | "OTHER"
export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED"
export type CredentialStatus = "ACTIVE" | "REVOKED"
export type AgentStatus = "CONNECTED" | "OFFLINE" | "NEVER_CONNECTED"
export type AgentCredentialState = "PENDING_ENROLLMENT" | "ACTIVE" | "REVOKED"
export type DisconnectReason = "client_close" | "heartbeat_timeout" | "revoked" | "shutdown" | "superseded" | "replaced"
export type CredentialKind = "STORED" | "AGENT_MANAGED"
export type Provider =
  | "GITHUB"
  | "AWS"
  | "AZURE"
  | "GOOGLE_CLOUD"
  | "ALIBABA_CLOUD"
  | "KUBERNETES"
  | "DOCKER"
  | "WEB_URL"
  | "API_URL"
  | "MCP_SERVER"
  | "OTHER"

interface Meta {
  label: string
  description: string
  tone: Tone
}

export const ROLE_META: Record<Role, Meta> = {
  ADMIN: { label: "Admin", description: "Full access including user management and settings", tone: "brand" },
  EDITOR: { label: "Editor", description: "Curate products, edges, and component lifecycle", tone: "info" },
  VIEWER: { label: "Viewer", description: "Read-only access to all entities", tone: "neutral" },
}

export const PRODUCT_TYPE_META: Record<ProductType, Meta> = {
  BUSINESS_CAPABILITY: {
    label: "Business capability",
    description: "Line-of-business capability that composes shared platforms",
    tone: "info",
  },
  PLATFORM: { label: "Platform", description: "Shared platform consumed by business capabilities", tone: "brand" },
  CUSTOMER_FACING: { label: "Customer-facing", description: "Delivered directly to external customers", tone: "neutral" },
}

export const CRITICALITY_META: Record<Criticality, Meta> = {
  CRITICAL: { label: "Critical", description: "Immediate attention in an incident", tone: "destructive" },
  HIGH: { label: "High", description: "Elevated priority in triage", tone: "warning" },
  MEDIUM: { label: "Medium", description: "Normal priority", tone: "info" },
  LOW: { label: "Low", description: "Least urgent in triage", tone: "neutral" },
}

export const LIFECYCLE_META: Record<Lifecycle, Meta> = {
  ACTIVE: { label: "Active", description: "In service", tone: "success" },
  RETIRED: { label: "Retired", description: "No longer in service", tone: "neutral" },
}

export const HEALTH_META: Record<InstanceStatus, Meta> = {
  RUNNING: { label: "Running", description: "Instance observed and healthy", tone: "success" },
  STOPPED: { label: "Stopped", description: "Instance observed but not serving", tone: "warning" },
  ERROR: { label: "Error", description: "Instance reported an error", tone: "destructive" },
  GONE: { label: "Gone", description: "Instance no longer observed by its importer", tone: "neutral" },
}

export const ENVIRONMENT_META: Record<Environment, Meta> = {
  PRODUCTION: { label: "Production", description: "Live environment serving real users", tone: "brand" },
  STAGING: { label: "Staging", description: "Pre-production mirror", tone: "info" },
  TEST: { label: "Test", description: "Automated test execution", tone: "neutral" },
  DEV: { label: "Development", description: "Active iteration", tone: "neutral" },
  DEMO: { label: "Demo", description: "Previews and training", tone: "neutral" },
  OTHER: { label: "Other", description: "Non-standard environment", tone: "neutral" },
}

export const RUN_STATUS_META: Record<RunStatus, Meta> = {
  PENDING: { label: "Pending", description: "Queued, not started", tone: "neutral" },
  RUNNING: { label: "Running", description: "Currently executing", tone: "info" },
  COMPLETED: { label: "Completed", description: "Finished successfully", tone: "success" },
  FAILED: { label: "Failed", description: "Terminated due to an error", tone: "destructive" },
  CANCELLED: { label: "Cancelled", description: "Cancelled by a user", tone: "neutral" },
  INTERRUPTED: { label: "Interrupted", description: "Interrupted before completion", tone: "warning" },
}

export const CREDENTIAL_STATUS_META: Record<CredentialStatus, Meta> = {
  ACTIVE: { label: "Active", description: "Can be resolved for importer runs", tone: "success" },
  REVOKED: { label: "Revoked", description: "Resolution fails fast until replaced", tone: "destructive" },
}

export const AGENT_STATUS_META: Record<AgentStatus, Meta> = {
  CONNECTED: { label: "Connected", description: "Holding a live, authenticated session with the hub", tone: "success" },
  OFFLINE: { label: "Offline", description: "No heartbeat for ~90 seconds or the session was closed", tone: "neutral" },
  NEVER_CONNECTED: { label: "Never connected", description: "Registered, but the enrollment token has not been used yet", tone: "warning" },
}

export const AGENT_CREDENTIAL_META: Record<AgentCredentialState, Meta> = {
  PENDING_ENROLLMENT: { label: "Awaiting enrollment", description: "A single-use enrollment token is outstanding", tone: "warning" },
  ACTIVE: { label: "Active", description: "Durable credential issued and valid", tone: "success" },
  REVOKED: { label: "Revoked", description: "Credential killed. Rotate to re-enable this identity", tone: "destructive" },
}

export const DISCONNECT_REASON_META: Record<DisconnectReason, { label: string; description: string; tone: Tone }> = {
  client_close: { label: "Client closed", description: "The agent closed the connection cleanly", tone: "neutral" },
  heartbeat_timeout: { label: "Heartbeat timeout", description: "No contact for ~90 seconds", tone: "warning" },
  revoked: { label: "Revoked", description: "An admin revoked the credential", tone: "destructive" },
  shutdown: { label: "Hub shutdown", description: "The hub restarted or shut down", tone: "neutral" },
  superseded: { label: "Superseded", description: "A newer connection used the same credential", tone: "warning" },
  replaced: { label: "Replaced", description: "A rotated credential took over this session", tone: "neutral" },
}

export const KIND_META: Record<CredentialKind, { label: string; description: string }> = {
  STORED: {
    label: "Stored in Componode",
    description: "Secret values are encrypted at rest and resolved on the hub. Values cannot be read back after saving.",
  },
  AGENT_MANAGED: {
    label: "Resolved on an Import Agent",
    description: "Holds references only. Values live on the agent host as environment variables or files.",
  },
}

/** Importer names an agent may be allowed to serve. Mirrors the compiled importer packages. */
export const IMPORTER_NAMES = ["github", "aws", "azure", "alibaba-cloud", "kubernetes", "web-url", "api-url", "mcp-server"] as const

export const PROVIDER_META: Record<Provider, { label: string; short: string }> = {
  GITHUB: { label: "GitHub", short: "GH" },
  AWS: { label: "AWS", short: "AWS" },
  AZURE: { label: "Azure", short: "AZ" },
  GOOGLE_CLOUD: { label: "Google Cloud", short: "GCP" },
  ALIBABA_CLOUD: { label: "Alibaba Cloud", short: "ALI" },
  KUBERNETES: { label: "Kubernetes", short: "K8s" },
  DOCKER: { label: "Docker", short: "DKR" },
  WEB_URL: { label: "Web URL", short: "WEB" },
  API_URL: { label: "API URL", short: "API" },
  MCP_SERVER: { label: "MCP server", short: "MCP" },
  OTHER: { label: "Other", short: "OTH" },
}

export const CATEGORY_LABELS: Record<string, string> = {
  ACCOUNT: "Account",
  COMPUTE: "Compute",
  SERVERLESS: "Serverless",
  CONTAINER: "Container",
  CONTAINER_ORCHESTRATION: "Orchestration",
  DATABASE: "Database",
  STORAGE: "Storage",
  NETWORK: "Network",
  QUEUE: "Queue",
  CDN: "CDN",
  DNS: "DNS",
  CERTIFICATE: "Certificate",
  SECRET: "Secret",
  KMS_KEY: "KMS key",
  IDENTITY: "Identity",
  OBSERVABILITY: "Observability",
  API: "API",
  MCP_SERVER: "MCP server",
  WEB_ENDPOINT: "Web endpoint",
  REPOSITORY: "Repository",
  PACKAGE_REGISTRY: "Package registry",
  DOCUMENTATION: "Documentation",
  IAC: "Infrastructure as code",
  JOB: "Job",
  LIBRARY: "Library",
}
