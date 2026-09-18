/** Shared API contract types for the Componode frontend. */

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
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";

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
  schedule: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CredentialStatus = "ACTIVE" | "REVOKED";

export interface Credential {
  id: string;
  slug: string;
  label: string;
  status: CredentialStatus;
  keyHints: Record<string, string>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialDependents {
  importerConfigs: Array<{ id: string; label: string }>;
  oidc: boolean;
}

export interface CredentialDetail {
  credential: Credential;
  dependents: CredentialDependents;
}

export interface CredentialTestResult {
  ok: boolean;
  error?: string;
}

export interface ImportRun {
  id: string;
  configId: string;
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
  kind: "FAILED_RUN" | "INSTANCE_ERROR" | "INSTANCE_GONE";
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
  description?: string | null;
  lobOwnerId?: string | null;
  teamOwnerId?: string | null;
  lobOwnerName?: string | null;
  teamOwnerName?: string | null;
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
  via?: { id: string; name: string; slug: string };
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
  composedBy: ProductRef[];
  composes: ProductRef[];
  consumesFrom: ProductRef[];
  consumedBy: ProductRef[];
  components: { declared: ComponentDepRef[]; inherited: ComponentDepRef[] };
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
