### ADR-071 — API error response format

> **Status:** Ratified

**Context**: Q21 established RBAC. What is the error response shape?

**Decision**: **`{code, message, details?}`.** `code` is a machine-readable
string (e.g. `"AUTH_RATE_LIMITED"`, `"VALIDATION_FAILED"`, `"CYCLE_DETECTED"`)
— a controlled enum defined in `packages/core`. `message` is human-readable.
`details` is optional (e.g. validation errors array, retry-after seconds).
RFC 7807 wrapping is a post-v1 additive option (mechanical transform, the
`code`/`message`/`details` fields are preserved as extensions).

**Rationale**: RFC 7807 is "correct" for a public API with external clients,
but v1's only client is the frontend (co-deployed). `code` is what the
frontend actually needs (switch on `"AUTH_RATE_LIMITED"` to show a specific
message). The `code` strings are a controlled enum in `core` — machine-
readable, type-safe, no URI namespace to maintain.

## Amendment 1 — URL Check error codes (2026-11-01, ADR-124)

**Refinement**: `URL_CHECK_NOT_FOUND` and `MONITORING_SETUP_NOT_FOUND`
join the controlled `code` enum — `ERROR_CODES`, `ERROR_TYPES`, the
OpenAPI `Problem.code` enum, and `CODE_MEANINGS` update in the same
change (ADR-104).

---

**Amended by ADR-124**: the error-code set gains `URL_CHECK_NOT_FOUND`
and `MONITORING_SETUP_NOT_FOUND`; see Amendment 1.