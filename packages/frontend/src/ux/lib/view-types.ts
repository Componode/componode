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
  SourceStatus,
  UrlCheckAuthMode,
  UrlCheckMethod,
  UrlCheckOutcome,
  UrlCheckStatus,
  UrlCheckTargetWindow,
  UrlCheckVantage,
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
  /** Importer-emitted allowlisted snapshot (dockerObservation — spec 047). */
  rawConfig: Record<string, unknown> | null;
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
  /** Detail-only total including GONE rows. */
  totalInstanceCount?: number;
  instances: ComponentInstance[];
  lastSeenAt: string | null;
  /** Backend rollup (spec 039) — null when the component has no instances. */
  worstStatus: InstanceStatus | null;
  /** Shared canonical facts (composeProject/composeService for Docker) —
   *  only populated on the detail read; null on list rows. */
  details: Record<string, unknown> | null;
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
  /** Configured scope — collection importers declare Component profiles here. */
  scope: Record<string, unknown>;
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
  lastRun: {
    status: RunStatus;
    at: string;
    processed: number;
    durationSec: number;
  } | null;
  history: { day: string; created: number; updated: number; failed: number }[];
}

export interface ImportRun {
  id: string;
  configId?: string | null;
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
  cancelReason?: "USER_REQUESTED" | "TARGET_DISABLED" | null;
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
  jobs: {
    assigned: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
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
  /** Display name of the enrolling user; null when unresolvable. */
  createdBy: string | null;
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
  action:
    | "created"
    | "updated"
    | "deleted"
    | "revoked"
    | "rotated"
    | "enrolled"
    | "signed_in"
    | "ran"
    | "other";
  entityKind:
    | "product"
    | "component"
    | "importer"
    | "credential"
    | "user"
    | "settings"
    | "session"
    | "agent"
    | "other";
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
  /** Queue fields carried for the spec-068 summary hover (optional —
   *  older producers may not populate them). */
  score?: number | null;
  status?: string | null;
  createdAt?: string | null;
  decidedAt?: string | null;
  decidedByName?: string | null;
}

/** Related product node in the detail topology (spec 059) — enriched
 *  ProductRef: derived health status (null = no data) and the same
 *  declared+inherited component count the product detail reports. */
export interface RelatedProduct {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  lifecycle: Lifecycle;
  criticality: Criticality | null;
  status: HealthStatus | null;
  componentCount: number;
}

/** ComponentGroup dependency node in the detail topology (spec 059). */
export interface TopologyGroup {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  lifecycle: Lifecycle;
}

/** Direct Component dependency node in the detail topology (spec 061). */
export interface TopologyComponent {
  id: string;
  name: string;
  slug: string;
  category: string;
  lifecycle: Lifecycle;
  /** Worst operational status across non-GONE instances; null = no data. */
  worstStatus: InstanceStatus | null;
}

/** Complete one-hop relation data for the Product detail topology. */
export interface ProductTopology {
  composedBy: RelatedProduct[];
  composes: RelatedProduct[];
  consumesFrom: RelatedProduct[];
  consumedBy: RelatedProduct[];
  dependsOnGroups: TopologyGroup[];
  /** Direct Product→Component DEPENDS_ON targets (spec 061, ADR-127 Amendment 2). */
  dependsOnComponents: TopologyComponent[];
  /** Relation families that failed to read — rendered as a partial warning. */
  unavailableGroups: string[];
}

/** Related-Component node in the spec-060 Relationships view. */
export interface RelatedComponentNode {
  id: string;
  name: string;
  slug: string;
  category: string;
  provider: Provider;
  resourceType: string;
  lifecycle: Lifecycle;
}

/** Product node that depends on the focused Component (spec 060). */
export interface ComponentDependentNode {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  lifecycle: Lifecycle;
}

/** ComponentGroup ref carried on group-mediated Product paths. */
export interface ComponentGroupNode {
  id: string;
  name: string;
  slug: string;
  lifecycle: Lifecycle;
}

/** Group-mediated Product path — attributed, never a direct edge. */
export interface GroupMediatedDependentNode extends ComponentDependentNode {
  viaGroup: ComponentGroupNode;
}

/** One-hop typed relation data for the Component Relationships tab (spec 060). */
export interface ComponentRelationshipsView {
  component: RelatedComponentNode;
  dependsOn: RelatedComponentNode[];
  dependedOnBy: RelatedComponentNode[];
  sourcesFrom: RelatedComponentNode[];
  sourcedBy: RelatedComponentNode[];
  exposes: RelatedComponentNode[];
  exposedBy: RelatedComponentNode[];
  productDependents: {
    direct: ComponentDependentNode[];
    viaGroups: GroupMediatedDependentNode[];
  };
  instances: ComponentInstance[];
  /** Relation groups that failed to read — rendered as a partial warning. */
  unavailableKinds: string[];
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

/** ImporterSource list/detail row (spec 047) — provenance record from the
 *  existing `/importer-sources*` API; never a catalog entity. */
export interface ImporterSource {
  id: string;
  importerName: string;
  provider: Provider;
  externalIdentity: string;
  label: string | null;
  status: SourceStatus;
  boundConfig: { id: string; label: string } | null;
  lastCompletedRunAt: string | null;
  activeComponentMemberships: number;
  activeInstanceMemberships: number;
  firstSeenInRunId: string | null;
  lastSeenInRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- URL Check monitoring (spec 051) ---------------------------------------

/** Shared per-component probe defaults — cadence and execution vantage. */
export interface MonitoringSetupView {
  id: string;
  cadenceSeconds: number;
  vantage: UrlCheckVantage;
  agentId: string | null;
  agentName: string | null;
  /** Display label for the vantage: "Hub" or the agent's name. */
  vantageLabel: string;
}

/** Latest-observation summary embedded on list rows. */
export interface UrlCheckLatestView {
  scheduledAt: string;
  outcome: UrlCheckOutcome;
  httpStatus: number | null;
  durationMs: number | null;
  errorType: string | null;
  vantage: UrlCheckVantage;
}

/** authConfig maps logical fields to credential KEY NAMES — never values. */
export type UrlCheckAuthConfigView =
  | { usernameKey: string; passwordKey: string }
  | { tokenKey: string }
  | { headers: { name: string; key: string }[] };

/** Compact 24h rollup embedded on list rows (spec 053). */
export interface UrlCheckSummaryView {
  window: "24h";
  /** Human label for the rolling window, e.g. "24 hours". */
  windowLabel: string;
  /** 0..1 — successful scheduled probes / all scheduled probes. */
  availability: number | null;
  /** Request-start → response-headers p95 over successful probes. */
  p95: number | null;
  /** 0..1 — scheduled slots that never ran (monitor-side downtime). */
  coverageGap: number;
  counts: { success: number; failure: number; missed: number };
}

export interface UrlCheckView {
  id: string;
  setupId: string;
  componentInstanceId: string;
  /** ImporterConfig-declared check identity (spec 058); null = legacy/manual. */
  managedKey: string | null;
  /** ImporterConfig owning this managed check — the only edit surface. */
  managedByConfigId: string | null;
  credentialId: string | null;
  name: string;
  url: string;
  method: UrlCheckMethod;
  enabled: boolean;
  /** null = inherits the monitoring setup cadence. */
  cadenceSeconds: number | null;
  successPolicy: { codes: number[]; ranges: { min: number; max: number }[] };
  /** Compact rendering of successPolicy, e.g. "200–299, 301". */
  successPolicyLabel: string;
  authMode: UrlCheckAuthMode;
  authConfig: UrlCheckAuthConfigView | null;
  availabilityTarget: number | null;
  targetWindow: UrlCheckTargetWindow | null;
  nextProbeAt: string | null;
  /** null = inherit the global URL_CHECK_AUTO_DISABLE_AFTER; 0 = never auto-disable. */
  autoDisableAfter: number | null;
  /** Current non-SUCCESS streak — resets on SUCCESS and manual re-enable. */
  consecutiveFailures: number;
  /** Set only when the check disabled itself at its streak threshold. */
  autoDisabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  latest: UrlCheckLatestView | null;
  /** Compact 24h summary from the bounded list payload (null fields = no data). */
  summary: UrlCheckSummaryView;
  /** ≤12 most recent observations — the outcome-dot strip payload. */
  recent: UrlCheckObservationView[];
  /** Derived display status — visually distinct from instance health. */
  status: UrlCheckStatus;
}

export interface UrlCheckObservationView {
  id: string;
  scheduledAt: string;
  outcome: UrlCheckOutcome;
  httpStatus: number | null;
  durationMs: number | null;
  errorType: string | null;
  vantage: UrlCheckVantage;
  agentId: string | null;
}

export interface UrlCheckMetricsView {
  window: "24h" | "7d" | "30d";
  /** Human label for the rolling window, e.g. "24 hours". */
  windowLabel: string;
  /** 0..1 — successful scheduled probes / all scheduled probes. */
  availability: number | null;
  /** 0..1 — failed probes / attempted probes. */
  errorRate: number | null;
  /** 0..1 — scheduled slots that never ran (monitor-side downtime). */
  coverageGap: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  counts: { success: number; failure: number; missed: number };
  latest: UrlCheckLatestView | null;
  vantage: UrlCheckVantage;
  /** "Hub" or the executing agent's name — phrase as "reachable from". */
  vantageLabel: string;
  target: { availability: number; window: UrlCheckTargetWindow } | null;
}
