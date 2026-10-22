/** Shared API contract types for the Componode frontend. */

import type {
  DepSource,
  ProductHealth,
  ProductHealthStatus,
  ProductGroupEdge,
} from "@componode/core";

// Catalog coverage & hygiene (spec 023) — contract shapes live in core.
export type { CatalogCoverage, ProductCompleteness } from "@componode/core";
import type { CatalogCoverage, ProductCompleteness } from "@componode/core";

export type UserRole = "VIEWER" | "EDITOR" | "ADMIN";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  displayName: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface AppSettings {
  allowSelfRegistration: boolean;
  sessionIdleTimeoutMs: number;
  sessionAbsoluteTimeoutMs: number;
  defaultUserRole: UserRole;
}

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretRef: string;
  // Stored credential holding the client secret (spec 013 US7) — preferred
  // over the deprecated env clientSecretRef.
  clientSecretCredentialId?: string | null;
  roleClaimPath: string;
  claimValueField: string;
  roleMapping: Record<string, string>;
}

export interface OidcStatus {
  enabled: boolean;
}

export type ImportRunStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";

export interface ImportRunError {
  id: string;
  runId: string;
  assetExternalId: string | null;
  errorType: string;
  errorMessage: string;
  createdAt: string;
}

export interface ImporterManifest {
  name: string;
  label: string;
  description: string;
  configSchema: Record<string, unknown>;
  secrets?: Array<{ key: string; label: string; required: boolean }>;
}

export interface ImporterConfig {
  id: string;
  importerName: string;
  label: string;
  scope: Record<string, unknown>;
  secretRefs: Array<{ key: string; env?: string; file?: string }>;
  credentialIds: string[];
  secretRefsDeprecated: boolean;
  agentId: string | null;
  agent: { id: string; name: string; status: string } | null;
  agentIncompatible: boolean;
  schedule: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Credential shapes are owned by @componode/core contracts (ADR-117) —
// re-exported here so API types and core can't drift.
export type {
  Credential,
  CredentialDependents,
  CredentialDetail,
  CredentialKind,
  CredentialListItem,
  CredentialStatus,
  SecretRefMap,
} from "@componode/core";
import type { SecretRefInput } from "@componode/core";

// AGENT_MANAGED reference — names a source on the agent host, never a value
// (ADR-117).
export type SecretRef = SecretRefInput;

export type { CredentialTestResult } from "@componode/core";

export interface ImportRun {
  id: string;
  configId: string;
  agentId: string | null;
  agentName: string | null;
  status: ImportRunStatus;
  triggeredBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assetsProcessed: number;
  assetsCreated: number;
  assetsUpdated: number;
  instancesOrphaned: number;
  componentsRetired: number;
  currentPhase: string | null;
  cancelRequestedAt: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  errorType: string | null;
  // Credentials resolved for this run (spec 013 US4 run→credential linkage).
  credentialIds: string[] | null;
  createdAt: string;
}

export interface ComponentGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  lifecycle: string;
  teamOwnerId?: string | null;
  teamOwnerName?: string | null;
  memberCount?: number;
}

export interface Link {
  title: string;
  url: string;
}

export interface Component {
  id: string;
  name: string;
  slug: string;
  category: string;
  provider: string;
  resourceType: string;
  lifecycle: string;
  componentGroupId: string | null;
  componentGroupName: string | null;
  teamOwnerId?: string | null;
  teamOwnerName?: string | null;
  links?: Link[];
  tags?: string[];
  sunsetAt?: string | null;
  instanceCount: number;
}

export interface ComponentInstance {
  id: string;
  componentId: string;
  environment: string;
  url: string | null;
  region: string | null;
  status: string;
  version: string | null;
  deployedAt: string | null;
  externalId: string;
  slug: string;
  lastSeenAt: string | null;
}

export interface ComponentWithInstances extends Component {
  externalId: string | null;
  details: Record<string, unknown> | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  instances: ComponentInstance[];
}

export interface AttentionItem {
  kind:
    | "FAILED_RUN"
    | "INSTANCE_ERROR"
    | "INSTANCE_GONE"
    | "PRODUCT_ERROR"
    | "SUNSET_OVERDUE_PRODUCT"
    | "SUNSET_OVERDUE_COMPONENT"
    | "OFFLINE_AGENT";
  label: string;
  href: string;
  at: string;
}

export interface ImporterRunStatus {
  configId: string;
  importerName: string;
  configLabel: string;
  runId: string | null;
  status: ImportRunStatus | null;
  completedAt: string | null;
  assetsProcessed: number;
  assetsCreated: number;
  assetsUpdated: number;
}

export interface DashboardSummary {
  counts: {
    products: { total: number; byType: Record<string, number> };
    components: { total: number; byLifecycle: Record<string, number> };
    instances: { total: number; byStatus: Record<string, number> };
  };
  lastImportAt: string | null;
  attention: AttentionItem[];
  lastRuns: ImporterRunStatus[];
  coverage: CatalogCoverage;
}

export interface SearchHit {
  id: string;
  name: string;
  slug: string | null;
  kind: "component" | "product" | "group" | "importer" | "lob" | "team";
  href: string;
}

export interface SearchResults {
  components: SearchHit[];
  products: SearchHit[];
  groups: SearchHit[];
  importers: SearchHit[];
  lobs: SearchHit[];
  teams: SearchHit[];
}

export interface ComponentListResponse {
  data: Component[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    hasNext: boolean;
  };
}

// --- Product hierarchy (spec 005) ---------------------------------------

export interface ProductRef {
  id: string;
  name: string;
  slug: string;
  type: string;
  lifecycle: string;
}

export interface DigitalProduct extends ProductRef {
  status?: ProductHealthStatus | null;
  /** Spec 023: per-facet completeness (never a score). */
  completeness?: ProductCompleteness;
  /** Spec 023 US5: CONSUMES_FROM in-degree; rendered on PLATFORM rows. */
  consumedByCount?: number;
  description?: string | null;
  lobOwnerId?: string | null;
  teamOwnerId?: string | null;
  lobOwnerName?: string | null;
  teamOwnerName?: string | null;
  links?: Link[];
  tags?: string[];
  criticality?: string | null;
  sunsetAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: DigitalProduct[];
  edges: Array<{ parentId: string; childId: string }>;
}

export interface ComponentDepRef {
  id: string;
  name: string;
  slug: string;
  category: string;
  lifecycle: string;
  sources: DepSource[];
}

export interface InstanceDepRef {
  id: string;
  componentId: string;
  componentName: string;
  environment: string;
  status: string;
  region: string | null;
  via?: { id: string; name: string; slug: string };
}

export interface ProductDetail {
  product: DigitalProduct;
  health: ProductHealth | null;
  composedBy: ProductRef[];
  composes: ProductRef[];
  consumesFrom: ProductRef[];
  consumedBy: ProductRef[];
  components: { declared: ComponentDepRef[]; inherited: ComponentDepRef[] };
  dependsOnGroups: ProductGroupEdge[];
  instances: { declared: InstanceDepRef[]; inherited: InstanceDepRef[] };
  counts: {
    composedBy: number;
    composes: number;
    components: number;
    instances: number;
  };
}

export interface OrgEntity {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  displayName: string | null;
  username: string;
  slug: string;
}

// --- Platform product workflow (spec 020 / ADR-017) ------------------------

export interface ComponentDependent {
  id: string;
  name: string;
  slug: string;
  type: string;
}

export interface PlatformCandidate {
  component: {
    id: string;
    name: string;
    slug: string;
    category: string;
    provider: string;
  };
  dependerCount: number;
  dependents: ComponentDependent[];
}

export interface PromoteToPlatformInput {
  name?: string;
  slug?: string;
  description?: string | null;
  lobOwnerId?: string | null;
  teamOwnerId?: string | null;
  links?: Link[];
  tags?: string[];
  criticality?: string | null;
  sunsetAt?: string | null;
  consumerIds?: string[];
}

export interface PromoteToPlatformResult {
  product: DigitalProduct;
  consumers: ComponentDependent[];
}

export type { BootstrapReport, BootstrapSkippedItem } from "@componode/core";

// Edge suggestions (spec 022 / ADR-113) — contracts live in core; re-export
// so the API layer stays the single import site.
export type {
  EdgeSuggestion,
  EdgeSuggestionReason,
  EdgeSuggestionStatus,
  SuggestionQueueItem,
  SuggestionListResult,
  SuggestionRescanReport,
} from "@componode/core";

// Import Agents (spec 025 / ADR-116) — contracts live in core.
export type {
  ImportAgent,
  AgentSession,
  AgentEnrollment,
  AgentDetail,
  AgentActiveRun,
  AgentBoundConfig,
  AgentRun,
} from "@componode/core";

export interface CreateAgentResult {
  agent: import("@componode/core").ImportAgent;
  enrollment: import("@componode/core").AgentEnrollment;
}

/** Show-once enrollment material plus the owning agent's display name —
 *  the state the enrollment dialog needs (create + rotate flows). */
export interface EnrollmentGrant {
  agentName: string;
  enrollment: import("@componode/core").AgentEnrollment;
}
