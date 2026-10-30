/**
 * View models consumed by the staged UX components. These mirror the v0
 * prototype's fixture shapes (originally `lib/mock-data.ts`) but live
 * independently so `mock-data.ts` can be deleted at cutover while routes
 * keep importing these types. Mappers in `src/api/mappers/` produce them.
 */
import type {
  AgentCredentialState,
  AgentStatus,
  Criticality,
  CredentialStatus,
  DisconnectReason,
  Environment,
  HealthStatus,
  InstanceStatus,
  Lifecycle,
  ProductType,
  Provider,
  Role,
  RunStatus,
} from "@/ux/lib/domain";

export interface Link {
  title: string;
  url: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  lifecycle: Lifecycle;
  status: HealthStatus | null;
  criticality: Criticality | null;
  description: string | null;
  lobOwnerId?: string | null;
  lobOwnerName: string | null;
  teamOwnerId?: string | null;
  teamOwnerName: string | null;
  tags: string[];
  links: Link[];
  sunsetAt: string | null;
  consumedByCount?: number;
  componentCount: number;
  completeness: { owner: boolean; description: boolean; dependencies: boolean };
  updatedAt: string;
}

export interface ComponentInstance {
  id: string;
  environment: Environment;
  region: string | null;
  status: InstanceStatus;
  version: string | null;
  url: string | null;
  externalId: string;
  lastSeenAt: string | null;
}

export interface Component {
  id: string;
  name: string;
  slug: string;
  category: string;
  provider: Provider;
  resourceType: string;
  lifecycle: Lifecycle;
  componentGroupId: string | null;
  componentGroupName: string | null;
  teamOwnerId: string | null;
  teamOwnerName: string | null;
  tags: string[];
  sunsetAt: string | null;
  links: Link[];
  instanceCount: number;
  instances: ComponentInstance[];
  lastSeenAt: string | null;
}

/** Prototype component-group card/detail shape (`componentGroups` fixture). */
export interface ComponentGroupView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  lifecycle: Lifecycle;
  /** Owning team display name, null when unassigned. */
  team: string | null;
  members: number;
}

export interface ImporterConfig {
  id: string;
  importerName: Provider;
  label: string;
  schedule: string | null;
  scheduleLabel: string;
  enabled: boolean;
  credentialLabel: string;
  /** Bound execution agent; null = in-process on the hub. */
  agent?: { id: string; name: string } | null;
  /** Bound agent is revoked or its policy no longer covers this importer. */
  agentIncompatible?: boolean;
  /** Still uses legacy env/file secretRefs — eligible for convert-secrets. */
  secretRefsDeprecated?: boolean;
  lastRun: { status: RunStatus; at: string; processed: number; durationSec: number } | null;
  history: { day: string; created: number; updated: number; failed: number }[];
}

export interface ImportRun {
  id: string;
  configId?: string;
  status: RunStatus;
  triggeredBy: string;
  startedAt: string | null;
  durationSec: number | null;
  assetsProcessed: number;
  assetsCreated: number;
  assetsUpdated: number;
  instancesOrphaned: number;
  componentsRetired: number;
  currentPhase: string | null;
  cancelRequestedAt?: string | null;
  errorMessage: string | null;
  /** Failure classification from the hub (e.g. AGENT_LOST, AGENT_UNAVAILABLE). */
  errorType: string | null;
  /** Null or absent = ran in-process on the hub. */
  agentId?: string | null;
  agentName?: string | null;
}

export interface RunError {
  id: string;
  runId: string;
  assetExternalId: string | null;
  errorType: string;
  errorMessage: string;
  at: string;
}

export interface RunChange {
  id: string;
  runId: string;
  entityKind: "component" | "instance" | "product";
  entityName: string;
  action: "created" | "updated" | "orphaned" | "retired";
  actor: string;
  at: string;
}

/** Latest operational snapshot an agent reported in its heartbeat (spec 028). Counts only, never key names. */
export interface AgentReportedStatus {
  reportedAt: string;
  /** Hub-stamped, so freshness does not depend on the agent clock. */
  receivedAt: string;
  uptimeSeconds: number;
  activeJobs: number;
  jobs: { assigned: number; completed: number; failed: number; cancelled: number };
  assetsStreamed: number;
  credentialTests: { dispatched: number; succeeded: number; failed: number };
  secretResolutionFailures: number;
  reconnects: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  username: string;
  displayName: string;
  device: string;
  location: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current?: boolean;
}

export interface Credential {
  id: string;
  slug: string;
  label: string;
  /** STORED = hub-encrypted values; AGENT_MANAGED = references resolved on the agent host. */
  kind: "STORED" | "AGENT_MANAGED";
  status: CredentialStatus;
  keyHints: Record<string, string>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usedBy: number;
  updatedBy: string;
}

export interface ImportAgent {
  id: string;
  name: string;
  status: AgentStatus;
  credentialState: AgentCredentialState;
  /** Agent-reported. Null until the first handshake. */
  agentVersion: string | null;
  protocolVersion: number | null;
  importerVersions: Record<string, string>;
  maxConcurrentJobs: number | null;
  /** Hub-managed policy. Empty = all compiled importers. */
  allowedImporters: string[];
  boundConfigs: number;
  lastSeenAt: string | null;
  enrollmentExpiresAt: string | null;
  createdBy: string;
  createdAt: string;
  /** Null = never reported (older build). Drives the "not reported" empty state. */
  reportedStatus: AgentReportedStatus | null;
  /** Live session only. Null when no session is established. */
  lastHeartbeatAt: string | null;
  lastDisconnectReason: DisconnectReason | null;
}

export interface AgentSession {
  id: string;
  agentId: string;
  connectedAt: string;
  disconnectedAt: string | null;
  reason: DisconnectReason | null;
  remoteAddress: string;
  agentVersion: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: "created" | "updated" | "deleted" | "revoked" | "rotated" | "enrolled" | "signed_in" | "ran" | "other";
  entityKind: "product" | "component" | "importer" | "credential" | "user" | "settings" | "session" | "agent" | "other";
  entityName: string;
  summary: string;
  at: string;
}

/** Dashboard "needs attention" row. `detail` is optional context. */
export interface AttentionEntry {
  kind: string;
  label: string;
  detail: string | null;
  href: string;
  at: string;
  tone: "destructive" | "warning";
}

export interface Suggestion {
  id: string;
  kind: "COMPOSES" | "DEPENDS_ON" | "CONSUMES_FROM";
  from: string;
  to: string;
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Row on a product detail's components tab — the API's ComponentDepRef
 * joined with the catalog component for display fields (group/provider/
 * instanceCount are null when the join misses).
 */
export interface ProductComponentRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  lifecycle: Lifecycle;
  provider: Provider | null;
  resourceType: string | null;
  instanceCount: number | null;
  componentGroupName: string | null;
  lastSeenAt: string | null;
  /** DepSource kinds in compact label form (DIRECT / GROUP:name / INHERITED:product). */
  sources: string[];
  /** Worst instance status across this component's dep instances; null = none observed. */
  worstStatus: InstanceStatus | null;
}
