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

**Amended by ADR-122**: the error enum gains `TARGET_NOT_FOUND` (404), `TARGET_DISABLED` (409), `TARGET_IN_USE` (409) (spec 049).

**Amended by ADR-124**: the error-code set gains `URL_CHECK_NOT_FOUND`
and `MONITORING_SETUP_NOT_FOUND`; see Amendment 1.

## Amendment 2 — Deprecated URL Check writes (2026-11-03, ADR-126)

**Context**: URL Check definitions for the Web/API importer profiles are
owned by ImporterConfig. Existing direct write routes remain in the v1
contract as deprecated, read-only operations.

**Refinement**: Direct URL Check create/update/delete requests and the
manual Component-create monitoring payload return HTTP `410` with controlled
code `URL_CHECK_WRITE_DEPRECATED`. Read routes remain available. The code
is added to `ERROR_CODES`, `ERROR_TYPES`, and the OpenAPI error enum under
ADR-104.

---

**Amended by ADR-126**: `URL_CHECK_WRITE_DEPRECATED` identifies direct
URL Check write attempts rejected by the importer-managed authoring model.

**Amended by ADR-129**: the error-code set gains `GROUP_AUTO_MANAGED`
(409) — controlled conflict for lifecycle/delete writes on
system-provisioned ComponentGroups (spec 067).
