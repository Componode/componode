// Constants
export { ROLES, ROLE_META } from "./constants/roles.js";
export type { Role } from "./constants/roles.js";
export { COMPONENT_CATEGORIES, COMPONENT_CATEGORY_META } from "./constants/component-categories.js";
export type { ComponentCategory } from "./constants/component-categories.js";
export { COMPONENT_PROVIDERS, COMPONENT_PROVIDER_META } from "./constants/component-providers.js";
export type { ComponentProvider } from "./constants/component-providers.js";
export { ENVIRONMENTS, ENVIRONMENT_META } from "./constants/environments.js";
export type { Environment } from "./constants/environments.js";
export { COMPONENT_LIFECYCLE, COMPONENT_LIFECYCLE_META } from "./constants/lifecycle.js";
export type { ComponentLifecycle } from "./constants/lifecycle.js";
export { INSTANCE_STATUS, INSTANCE_STATUS_META } from "./constants/instance-status.js";
export type { InstanceStatus } from "./constants/instance-status.js";
export { PRODUCT_TYPES, PRODUCT_TYPE_META } from "./constants/product-types.js";
export type { ProductType } from "./constants/product-types.js";
export { RELATIONSHIP_TYPES, RELATIONSHIP_TYPE_META } from "./constants/relationship-types.js";
export type { RelationshipType } from "./constants/relationship-types.js";
export { IMPORT_RUN_STATUS, IMPORT_RUN_STATUS_META } from "./constants/import-run-status.js";
export type { ImportRunStatus } from "./constants/import-run-status.js";
export { CREDENTIAL_STATUSES, CREDENTIAL_STATUS_META } from "./constants/credential-status.js";
export type { CredentialStatus } from "./constants/credential-status.js";
export { ERROR_CODES } from "./constants/error-codes.js";
export type { ErrorCode } from "./constants/error-codes.js";
export { PASSWORD_MIN_LENGTH } from "./constants/passwords.js";
export { ERROR_TYPES, getErrorType, isErrorCode } from "./constants/error-types.js";
export type { ErrorType } from "./constants/error-types.js";
export { createProblem, buildProblemTypeUri } from "./errors/problem.js";
export type { Problem, CreateProblemOptions, InvalidParam } from "./errors/problem.js";

// Contracts
export type { Person } from "./contracts/person.js";
export type { Session } from "./contracts/session.js";
export type { Component } from "./contracts/component.js";
export type { ComponentInstance } from "./contracts/component-instance.js";
export type { ComponentGroup } from "./contracts/component-group.js";
export type { DigitalProduct } from "./contracts/digital-product.js";
export type { LineOfBusiness } from "./contracts/line-of-business.js";
export type { Team } from "./contracts/team.js";
export type { ImporterConfig } from "./contracts/importer-config.js";
export type { ImportRun, ImportRunError } from "./contracts/import-run.js";
export type { OidcConfig } from "./contracts/oidc-config.js";
export type { AppSettings } from "./contracts/app-settings.js";
export type { PasswordResetToken } from "./contracts/password-reset-token.js";
export type { EntityChange, EdgeChange, ActivityFeedItem } from "./contracts/audit.js";
export type { DiscoveredAsset, DiscoveredAssetInstance, DiscoveredAssetEnvironment } from "./contracts/discovered-asset.js";
export type { Importer, ImporterContext, SecretResolver, ImporterSecretDeclaration } from "./contracts/importer.js";
export type { Credential, CredentialDependents, CredentialDetail, CredentialTestResult } from "./contracts/credential.js";

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
export { createUserSchema, updateUserSchema } from "./schemas/user.js";
export { updateSettingsSchema, updateOidcConfigSchema } from "./schemas/settings.js";
export {
  createImporterConfigSchema,
  updateImporterConfigSchema,
} from "./schemas/importer-config.js";
export {
  createCredentialSchema,
  updateCredentialSchema,
  testCredentialSchema,
} from "./schemas/credential.js";
export type {
  CreateCredentialInput,
  UpdateCredentialInput,
  TestCredentialInput,
} from "./schemas/credential.js";
export {
  activityFeedQuerySchema,
  entityHistoryQuerySchema,
  correctionInputSchema,
} from "./schemas/audit.js";
export {
  listComponentsQuerySchema,
  updateComponentGroupAssignmentSchema,
  createComponentGroupSchema,
  updateComponentGroupSchema,
  listComponentGroupsQuerySchema,
} from "./schemas/components.js";
export { searchQuerySchema } from "./schemas/search.js";
export type { SearchQuery } from "./schemas/search.js";
export {
  productTypeSchema,
  productLifecycleSchema,
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  addComposesEdgeSchema,
  addConsumesFromEdgeSchema,
  addDependsOnEdgeSchema,
} from "./schemas/product.js";
export type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsQuery,
} from "./schemas/product.js";
export { createOrgEntitySchema, updateOrgEntitySchema } from "./schemas/org.js";
export type { CreateOrgEntityInput, UpdateOrgEntityInput } from "./schemas/org.js";
export type {
  ListComponentsQuery,
  UpdateComponentGroupAssignmentInput,
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
export type { CreateUserInput, UpdateUserInput } from "./schemas/user.js";
export type { UpdateSettingsInput, UpdateOidcConfigInput } from "./schemas/settings.js";
export type {
  ActivityFeedQuery,
  EntityHistoryQuery,
  CorrectionInput,
} from "./schemas/audit.js";
export type {
  CreateImporterConfigInput,
  UpdateImporterConfigInput,
} from "./schemas/importer-config.js";

// Validation
export { validateDiscoveredAsset, validateDiscoveredAssetDetailed } from "./validation/discovered-asset.js";
export type { ValidationResult } from "./validation/discovered-asset.js";
export { isUrlAllowedForImport, assertUrlAllowedForImport, urlSafetyError } from "./validation/url-safety.js";
