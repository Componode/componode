### ADR-099 — Secure password and credential handling

> **Status:** Ratified

**Context**: [ADR-044](./ADR-044-password-hashing.md) mandates Argon2id but doesn't cover password
complexity, reset flows, secret lifecycle, or timing attacks.

**Decision**: **Comprehensive password/credential handling.** (1) Argon2id
via `@node-rs/argon2`, PHC format, configurable params (OWASP defaults: 19
MiB, 2 iterations, 1 lane). (2) Minimum 12 characters, no maximum, no
complexity rules (NIST SP 800-63B). (3) Password reset: Admin-triggered,
32-byte base64url token, SHA-256 hashed in `password_reset_tokens` table,
15-min expiry, single-use, Admin never knows the new password, email
delivery post-v1. (4) OIDC client secret: `clientSecretRef`, in-memory only
for token exchange. (5) Importer secrets: in-memory only for run duration,
dereferenced after. (6) Bootstrap admin password: read once on empty-DB
boot, hashed immediately. (7) Timing attacks: login hashes a dummy password
for non-existent users. (8) **Session IDs are 32-byte cryptographically
random (base64url), NOT UUID v7 — exception to [ADR-045](./ADR-045-entity-identifier-format.md).** Session tokens are
credentials, not entity identifiers, and require cryptographic randomness.

**Rationale**: The session ID exception to [ADR-045](./ADR-045-entity-identifier-format.md) is critical: UUID v7's
74 bits of randomness is brute-force infeasible but not the standard for
session tokens (256-bit crypto-random is). The token-based reset flow is
more secure than "Admin sets temp password" (the Admin never knows the new
password). The timing-attack mitigation (dummy hash) prevents user
enumeration via response time differences.

**Amendment (2026-09-10 security assessment)**: (a) Session tokens are now
stored **SHA-256 hashed at rest** — `sessions.id` holds `sha256(token)` and a
non-secret `tokenLast4` column keeps the last four token characters for
display matching. A database leak therefore no longer exposes usable session
credentials. Migration `009_session_token_hash` revokes all pre-existing
sessions (one forced re-login). Client-facing session operations use the
separate non-secret `publicId` (UUID v7), never the bearer token. (b) The
12-character minimum is enforced on all *password-setting* paths (register,
change, reset-confirm, admin create) but **not** on `POST /auth/login`, which
stays lenient so legacy shorter passwords keep working until rotated.
---

**Amended by ADR-107**: integration secret values may persist, encrypted, in
the `credentials` table. Password-handling rules (Argon2id, no plaintext user
passwords) are unchanged.
