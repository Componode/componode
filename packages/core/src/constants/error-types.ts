import { type ErrorCode, ERROR_CODES } from "./error-codes.js";

export interface ErrorType {
  code: ErrorCode;
  status: number;
  title: string;
}

export const ERROR_TYPES: Record<ErrorCode, ErrorType> = {
  AUTH_INVALID_CREDENTIALS: { code: "AUTH_INVALID_CREDENTIALS", status: 401, title: "Invalid credentials" },
  AUTH_RATE_LIMITED: { code: "AUTH_RATE_LIMITED", status: 429, title: "Too many requests" },
  AUTH_NO_SESSION: { code: "AUTH_NO_SESSION", status: 401, title: "Authentication required" },
  AUTH_FORBIDDEN: { code: "AUTH_FORBIDDEN", status: 403, title: "Forbidden" },
  AUTH_USERNAME_TAKEN: { code: "AUTH_USERNAME_TAKEN", status: 409, title: "Username already taken" },
  AUTH_RESET_TOKEN_INVALID: { code: "AUTH_RESET_TOKEN_INVALID", status: 400, title: "Invalid reset token" },
  AUTH_RESET_TOKEN_EXPIRED: { code: "AUTH_RESET_TOKEN_EXPIRED", status: 400, title: "Reset token expired" },
  AUTH_RESET_TOKEN_USED: { code: "AUTH_RESET_TOKEN_USED", status: 400, title: "Reset token already used" },
  OIDC_NOT_CONFIGURED: { code: "OIDC_NOT_CONFIGURED", status: 400, title: "OIDC not configured" },
  OIDC_INVALID_STATE: { code: "OIDC_INVALID_STATE", status: 400, title: "Invalid OIDC state" },
  OIDC_INVALID_CODE: { code: "OIDC_INVALID_CODE", status: 400, title: "Invalid OIDC code" },
  OIDC_TOKEN_VERIFICATION_FAILED: { code: "OIDC_TOKEN_VERIFICATION_FAILED", status: 401, title: "OIDC token verification failed" },
  OIDC_DISCOVERY_FAILED: { code: "OIDC_DISCOVERY_FAILED", status: 503, title: "OIDC discovery failed" },
  CSRF_TOKEN_MISMATCH: { code: "CSRF_TOKEN_MISMATCH", status: 403, title: "CSRF token mismatch" },
  VALIDATION_FAILED: { code: "VALIDATION_FAILED", status: 400, title: "Validation failed" },
  NOT_FOUND: { code: "NOT_FOUND", status: 404, title: "Not found" },
  CONFLICT: { code: "CONFLICT", status: 409, title: "Conflict" },
  CYCLE_DETECTED: { code: "CYCLE_DETECTED", status: 409, title: "Cycle detected" },
  INVALID_EDGE_TYPE: { code: "INVALID_EDGE_TYPE", status: 422, title: "Invalid edge type" },
  REFERENCED: { code: "REFERENCED", status: 409, title: "Resource is referenced" },
  TYPE_CHANGE_BLOCKED: { code: "TYPE_CHANGE_BLOCKED", status: 409, title: "Type change blocked" },
  SLUG_TAKEN: { code: "SLUG_TAKEN", status: 409, title: "Slug already in use" },
  SLUG_CONFLICT: { code: "SLUG_CONFLICT", status: 409, title: "Slug conflict" },
  CONFIG_NOT_FOUND: { code: "CONFIG_NOT_FOUND", status: 404, title: "Configuration not found" },
  RUN_IN_PROGRESS: { code: "RUN_IN_PROGRESS", status: 409, title: "Run already in progress" },
  RUN_NOT_ACTIVE: { code: "RUN_NOT_ACTIVE", status: 409, title: "Run is not active" },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", status: 500, title: "Internal server error" },
  CREDENTIAL_NOT_FOUND: { code: "CREDENTIAL_NOT_FOUND", status: 404, title: "Credential not found" },
  CREDENTIAL_IN_USE: { code: "CREDENTIAL_IN_USE", status: 409, title: "Credential is in use" },
  CREDENTIAL_REVOKED: { code: "CREDENTIAL_REVOKED", status: 409, title: "Credential is revoked" },
  CREDENTIAL_MISSING_KEY: { code: "CREDENTIAL_MISSING_KEY", status: 400, title: "Missing required secret key" },
  CREDENTIAL_KEY_COLLISION: { code: "CREDENTIAL_KEY_COLLISION", status: 400, title: "Duplicate secret key across sources" },
  CREDENTIAL_KEY_UNAVAILABLE: { code: "CREDENTIAL_KEY_UNAVAILABLE", status: 503, title: "Credential store key unavailable" },
  MANIFEST_NO_TEST: { code: "MANIFEST_NO_TEST", status: 400, title: "Importer does not support credential testing" },
  CONVERSION_NOTHING_TO_CONVERT: { code: "CONVERSION_NOTHING_TO_CONVERT", status: 400, title: "No legacy secret references to convert" },
  LEGACY_SECRET_UNRESOLVABLE: { code: "LEGACY_SECRET_UNRESOLVABLE", status: 502, title: "Legacy secret reference could not be resolved" },
};

export function getErrorType(code: ErrorCode): ErrorType {
  const errorType = ERROR_TYPES[code];
  if (!errorType) {
    return { code, status: 500, title: "Internal server error" };
  }
  return errorType;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODES.includes(value as ErrorCode);
}
