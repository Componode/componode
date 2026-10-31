// Constants
export { ROLES, ROLE_META } from "./constants/roles.js";
export type { Role } from "./constants/roles.js";
export {
  COMPONENT_CATEGORIES,
  COMPONENT_CATEGORY_META,
} from "./constants/component-categories.js";
export type { ComponentCategory } from "./constants/component-categories.js";
export {
  COMPONENT_PROVIDERS,
  COMPONENT_PROVIDER_META,
} from "./constants/component-providers.js";
export type { ComponentProvider } from "./constants/component-providers.js";
export { ENVIRONMENTS, ENVIRONMENT_META } from "./constants/environments.js";
export type { Environment } from "./constants/environments.js";
export {
  COMPONENT_LIFECYCLE,
  COMPONENT_LIFECYCLE_META,
} from "./constants/lifecycle.js";
export type { ComponentLifecycle } from "./constants/lifecycle.js";
export {
  INSTANCE_STATUS,
  INSTANCE_STATUS_META,
} from "./constants/instance-status.js";
export type { InstanceStatus } from "./constants/instance-status.js";
export { PRODUCT_TYPES, PRODUCT_TYPE_META } from "./constants/product-types.js";
export type { ProductType } from "./constants/product-types.js";
export { CRITICALITIES, CRITICALITY_META } from "./constants/criticality.js";
export type { ProductCriticality } from "./constants/criticality.js";
export {
  RELATIONSHIP_TYPES,
  RELATIONSHIP_TYPE_META,
} from "./constants/relationship-types.js";
export type { RelationshipType } from "./constants/relationship-types.js";
export {
  IMPORT_RUN_STATUS,
  IMPORT_RUN_STATUS_META,
} from "./constants/import-run-status.js";
export type { ImportRunStatus } from "./constants/import-run-status.js";
export {
  CREDENTIAL_STATUSES,
  CREDENTIAL_STATUS_META,
} from "./constants/credential-status.js";
export type { CredentialStatus } from "./constants/credential-status.js";
export {
  CREDENTIAL_KINDS,
  CREDENTIAL_KIND_META,
} from "./constants/credential-kind.js";
export type { CredentialKind } from "./constants/credential-kind.js";
export { ERROR_CODES } from "./constants/error-codes.js";
export type { ErrorCode } from "./constants/error-codes.js";
export {
  EDGE_SUGGESTION_REASON,
  EDGE_SUGGESTION_REASON_META,
  EDGE_SUGGESTION_STATUS,
  EDGE_SUGGESTION_STATUS_META,
} from "./constants/edge-suggestion.js";
export type {
  EdgeSuggestionReason,
  EdgeSuggestionStatus,
} from "./constants/edge-suggestion.js";
export { PASSWORD_MIN_LENGTH } from "./constants/passwords.js";
export {
  ERROR_TYPES,
  getErrorType,
  isErrorCode,
} from "./constants/error-types.js";
export type { ErrorType } from "./constants/error-types.js";
export { createProblem, buildProblemTypeUri } from "./errors/problem.js";
export type {
  Problem,
  CreateProblemOptions,
  InvalidParam,
} from "./errors/problem.js";

// Contracts
export type { Person } from "./contracts/person.js";
export type { Session } from "./contracts/session.js";
export type { Component } from "./contracts/component.js";
export type { ComponentInstance } from "./contracts/component-instance.js";
export type {
  ComponentGroup,
  ComponentGroupListItem,
} from "./contracts/component-group.js";
export type {
  DigitalProduct,
  ProductHealth,
  ProductHealthStatus,
  DepSource,
  ProductGroupEdge,
  ComponentDependent,
  PlatformCandidate,
  PromoteToPlatformResult,
} from "./contracts/digital-product.js";
export type { LineOfBusiness } from "./contracts/line-of-business.js";
export type { Team } from "./contracts/team.js";
export type { ImporterConfig } from "./contracts/importer-config.js";
export type { ImportRun, ImportRunError } from "./contracts/import-run.js";
export type {
  ImporterSource,
  ImporterSourceListItem,
  SourceIdentityInput,
  BoundConfigSummary,
} from "./contracts/importer-source.js";
export type { OidcConfig } from "./contracts/oidc-config.js";
export type { AppSettings } from "./contracts/app-settings.js";
export type { PasswordResetToken } from "./contracts/password-reset-token.js";
export type {
  EntityChange,
  EdgeChange,
  ActivityFeedItem,
} from "./contracts/audit.js";
export type {
  DiscoveredAsset,
  DiscoveredAssetInstance,
  DiscoveredAssetEnvironment,
} from "./contracts/discovered-asset.js";
export type {
  Importer,
  ImporterContext,
  SecretResolver,
  ImporterSecretDeclaration,
} from "./contracts/importer.js";
export {
  canonicalizeSourceIdentity,
  qualifyExternalId,
  isQualifiedExternalId,
  unqualifyExternalId,
} from "./utils/source-identity.js";
export {
  importerSourceListQuerySchema,
  type ImporterSourceListQuery,
} from "./schemas/importer-source.js";
export {
  parseTargetRegistry,
  TargetRegistryError,
  targetProfileSchema,
  targetRegistrySchema,
} from "./utils/target-registry.js";
export type {
  TargetProfile,
  TargetRegistry,
} from "./utils/target-registry.js";
export {
  IMPORTER_SOURCE_STATUSES,
  SOURCE_AUDIT_ACTIONS,
} from "./constants/importer-source.js";
export type {
  ImporterSourceStatus,
  SourceAuditAction,
} from "./constants/importer-source.js";
export type {
  Credential,
  CredentialDependents,
  CredentialDetail,
  CredentialListItem,
  CredentialTestResult,
} from "./contracts/credential.js";
export type {
  EdgeSuggestion,
  SuggestionQueueItem,
  SuggestionListResult,
  SuggestionRescanReport,
} from "./contracts/edge-suggestion.js";
export type {
  CatalogCoverage,
  ProductCompleteness,
} from "./contracts/catalog-coverage.js";

// Observability
export type { Logger } from "./observability/logger.js";
export type { Span, Tracer } from "./observability/tracer.js";
export { NOOP_LOGGER } from "./observability/logger.js";
export { NOOP_TRACER } from "./observability/tracer.js";

// Schemas
export {
  loginSchema,
  registerSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from "./schemas/auth.js";
export { createUserSchema, updateUserSchema, updateSelfSchema } from "./schemas/user.js";
export {
  updateSettingsSchema,
  updateOidcConfigSchema,
} from "./schemas/settings.js";
export {
  createImporterConfigSchema,
  updateImporterConfigSchema,
} from "./schemas/importer-config.js";
export {
  createCredentialSchema,
  updateCredentialSchema,
  testCredentialSchema,
  secretRefSchema,
  secretRefMapSchema,
} from "./schemas/credential.js";
export type {
  CreateCredentialInput,
  UpdateCredentialInput,
  TestCredentialInput,
  SecretRefInput,
  SecretRefMap,
} from "./schemas/credential.js";

// Shared secret-reference resolution (spec 026) — used by the backend's
// in-process path and the agent's remote path.
// The secret resolver is node-only (fs/path) — exposed via the
// "@componode/core/secrets" subpath so browser bundles never pull it in.
export {
  activityFeedQuerySchema,
  entityHistoryQuerySchema,
  correctionInputSchema,
} from "./schemas/audit.js";
export {
  linkSchema,
  linksSchema,
  tagSchema,
  tagsSchema,
} from "./schemas/metadata.js";
export type { Link } from "./schemas/metadata.js";
export {
  listComponentsQuerySchema,
  updateComponentGroupAssignmentSchema,
  updateComponentSchema,
  createComponentSchema,
  createComponentGroupSchema,
  updateComponentGroupSchema,
  listComponentGroupsQuerySchema,
} from "./schemas/components.js";
export { searchQuerySchema } from "./schemas/search.js";
export type { SearchQuery } from "./schemas/search.js";
export {
  productTypeSchema,
  productLifecycleSchema,
  productCriticalitySchema,
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  addComposesEdgeSchema,
  addConsumesFromEdgeSchema,
  addDependsOnEdgeSchema,
  promoteToPlatformSchema,
} from "./schemas/product.js";
export type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsQuery,
  PromoteToPlatformInput,
} from "./schemas/product.js";
export {
  bootstrapDocumentSchema,
  bootstrapProductItemSchema,
  bootstrapOwnerSchema,
} from "./schemas/bootstrap.js";
export type {
  BootstrapDocument,
  BootstrapProductItem,
  BootstrapOwner,
} from "./schemas/bootstrap.js";
export type {
  BootstrapReport,
  BootstrapSkippedItem,
} from "./contracts/bootstrap.js";
export { listSuggestionsQuerySchema } from "./schemas/suggestions.js";
export type { ListSuggestionsQuery } from "./schemas/suggestions.js";
export {
  createOrgEntitySchema,
  updateOrgEntitySchema,
  createTeamSchema,
  updateTeamSchema,
} from "./schemas/org.js";
export type {
  CreateOrgEntityInput,
  UpdateOrgEntityInput,
  CreateTeamInput,
  UpdateTeamInput,
} from "./schemas/org.js";
export type {
  ListComponentsQuery,
  UpdateComponentGroupAssignmentInput,
  UpdateComponentInput,
  CreateComponentInput,
  CreateComponentGroupInput,
  UpdateComponentGroupInput,
  ListComponentGroupsQuery,
} from "./schemas/components.js";
export type {
  LoginInput,
  RegisterInput,
  PasswordChangeInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
} from "./schemas/auth.js";
export type { CreateUserInput, UpdateUserInput, UpdateSelfInput } from "./schemas/user.js";
export type {
  UpdateSettingsInput,
  UpdateOidcConfigInput,
} from "./schemas/settings.js";
export type {
  ActivityFeedQuery,
  EntityHistoryQuery,
  CorrectionInput,
} from "./schemas/audit.js";
export type {
  CreateImporterConfigInput,
  UpdateImporterConfigInput,
} from "./schemas/importer-config.js";

export {
  AGENT_STATUSES,
  AGENT_STATUS_META,
  AGENT_DISCONNECT_REASONS,
  AGENT_AUDIT_ACTIONS,
  AGENT_PROTOCOL_VERSION,
  AGENT_HEARTBEAT_INTERVAL_MS,
  AGENT_STALE_AFTER_MS,
  AGENT_SESSION_SWEEP_MS,
  AGENT_ENROLLMENT_TTL_MS,
  AGENT_HELLO_TIMEOUT_MS,
  AGENT_CREDENTIAL_TEST_TIMEOUT_MS,
  AGENT_DISPATCH_TIMEOUT_MS,
  AGENT_JOB_ACK_TIMEOUT_MS,
  AGENT_NACK_SECRET_RESOLUTION_PREFIX,
  AGENT_NACK_TARGET_RESOLUTION_PREFIX,
  AGENT_NACK_UNAVAILABLE_PREFIX,
  AGENT_ERROR_CODES,
} from "./constants/import-agent.js";
export type {
  AgentStatus,
  AgentDisconnectReason,
  AgentAuditAction,
  AgentErrorCode,
} from "./constants/import-agent.js";
export type {
  ImportAgent,
  AgentSession,
  AgentEnrollment,
  AgentDetail,
  AgentActiveRun,
  AgentBoundConfig,
  AgentRun,
  AgentReportedStatus,
} from "./contracts/import-agent.js";
export {
  createImportAgentSchema,
  updateImportAgentSchema,
  enrollAgentRequestSchema,
  listAgentSessionsQuerySchema,
} from "./schemas/import-agent.js";
export type {
  CreateImportAgentInput,
  UpdateImportAgentInput,
  EnrollAgentRequest,
  ListAgentSessionsQuery,
} from "./schemas/import-agent.js";
export * from "./contracts/agent-protocol.js";
export {
  createImporterRegistry,
  IMPORTER_PACKAGES,
} from "./importer-registry.js";
export type {
  ImporterRegistry,
  ImporterManifest,
} from "./importer-registry.js";

// Validation
export {
  validateDiscoveredAsset,
  validateDiscoveredAssetDetailed,
} from "./validation/discovered-asset.js";
export type { ValidationResult } from "./validation/discovered-asset.js";
export {
  isUrlAllowedForImport,
  assertUrlAllowedForImport,
  urlSafetyError,
} from "./validation/url-safety.js";
export { computeProductHealth } from "./product-health.js";
export type { ProductHealthInput } from "./product-health.js";
