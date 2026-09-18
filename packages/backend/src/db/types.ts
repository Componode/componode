import type { ColumnType } from "kysely";

// Kysely row types — the DB interface maps table names to row types.
// Generated/updated timestamps use ColumnType for insert/update defaults.
type Generated<T> = ColumnType<T, T | undefined, T>;
type OptionalGenerated<T> = ColumnType<T | null, T | undefined, T | null>;

export interface PersonRow {
  id: string;
  username: string;
  passwordHash: string | null;
  oidcSubject: string | null;
  role: string;
  displayName: string | null;
  email: string | null;
  teamId: string | null;
  slug: string;
  isActive: boolean;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface SessionRow {
  id: string; // SHA-256 of the bearer token — never expose via the API
  publicId: string; // non-secret identifier safe to return to clients
  tokenLast4: string; // last 4 chars of the token, for display only
  userId: string;
  createdAt: Generated<string>;
  lastSeenAt: Generated<string>;
  expiresAt: string;
  revokedAt: string | null;
}

export interface PasswordResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: Generated<string>;
}

export interface OidcConfigRow {
  id: Generated<number>;
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  clientSecretRef: string | null;
  clientSecretCredentialId: string | null;
  roleClaimPath: string | null;
  claimValueField: string | null;
  roleMapping: Record<string, string> | null;
  updatedAt: Generated<string>;
}

export interface AppSettingsRow {
  key: string;
  value: unknown;
  updatedAt: Generated<string>;
}

export interface DigitalProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: string;
  lifecycle: string;
  lobOwnerId: string | null;
  teamOwnerId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ComponentRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  provider: string;
  resourceType: string;
  lifecycle: string;
  teamOwnerId: string | null;
  componentGroupId: string | null;
  externalId: string | null;
  details: Record<string, unknown> | null;
  lastSeenAt: string | null;
  lastSeenInRunId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ComponentInstanceRow {
  id: string;
  componentId: string;
  environment: string;
  url: string | null;
  region: string | null;
  status: string;
  version: string | null;
  deployedAt: string | null;
  rawConfig: Record<string, unknown> | null;
  externalId: string;
  slug: string;
  lastSeenAt: string | null;
  lastSeenInRunId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ComponentGroupRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  lifecycle: string;
  teamOwnerId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface LineOfBusinessRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ImporterConfigRow {
  id: string;
  importerName: string;
  label: string;
  scope: Record<string, unknown>;
  secretRefs: Array<{ key: string; env?: string; file?: string }> | null;
  schedule: string | null;
  enabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ImportRunRow {
  id: string;
  configId: string;
  status: string;
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
  credentialIds: string[] | null;
  errorMessage: string | null;
  errorStack: string | null;
  errorType: string | null;
  createdAt: Generated<string>;
}

export interface CredentialRow {
  id: string;
  slug: string;
  label: string;
  status: string;
  encryptedPayload: string;
  keyVersion: number;
  keyHints: Record<string, string>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ImporterConfigCredentialRow {
  configId: string;
  credentialId: string;
  createdAt: Generated<string>;
}

export interface ImportRunErrorRow {
  id: string;
  runId: string;
  assetExternalId: string | null;
  errorType: string;
  errorMessage: string;
  errorStack: string | null;
  createdAt: Generated<string>;
}

export interface EntityChangeRow {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  changes: Record<string, unknown> | null;
  importRunId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Generated<string>;
}

export interface EdgeChangeRow {
  id: string;
  edgeType: string;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  action: string;
  reason: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Generated<string>;
}

export interface JunctionRow {
  parentId?: string;
  childId?: string;
  consumerId?: string;
  platformId?: string;
  productId?: string;
  componentId?: string;
  serviceId?: string;
  repositoryId?: string;
  apiId?: string;
  createdAt: Generated<string>;
}

export interface KyselyMigrationRow {
  name: string;
  timestamp: number;
}

export interface KyselyMigrationLockRow {
  id: string;
}

export interface DB {
  persons: PersonRow;
  sessions: SessionRow;
  password_reset_tokens: PasswordResetTokenRow;
  oidc_config: OidcConfigRow;
  app_settings: AppSettingsRow;
  digital_products: DigitalProductRow;
  components: ComponentRow;
  component_instances: ComponentInstanceRow;
  component_groups: ComponentGroupRow;
  line_of_businesses: LineOfBusinessRow;
  teams: TeamRow;
  product_composes: JunctionRow;
  product_consumes_from: JunctionRow;
  product_depends_on_component: JunctionRow;
  component_depends_on_component: JunctionRow;
  component_sources_from: JunctionRow;
  component_exposes: JunctionRow;
  importer_configs: ImporterConfigRow;
  importer_config_credentials: ImporterConfigCredentialRow;
  credentials: CredentialRow;
  import_runs: ImportRunRow;
  import_run_errors: ImportRunErrorRow;
  entity_changes: EntityChangeRow;
  edge_changes: EdgeChangeRow;
  kysely_migration: KyselyMigrationRow;
  kysely_migration_lock: KyselyMigrationLockRow;
}

export type { OptionalGenerated };
