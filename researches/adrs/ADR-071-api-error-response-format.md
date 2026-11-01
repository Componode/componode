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

---

**Amended by ADR-122**: the error enum gains `TARGET_NOT_FOUND` (404), `TARGET_DISABLED` (409), `TARGET_IN_USE` (409) (spec 049).
