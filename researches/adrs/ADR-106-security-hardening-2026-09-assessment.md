### ADR-106 — Security hardening from the 2026-09-10 assessment

> **Status:** Ratified

**Context**: The 2026-09-10 repository security assessment
(`docs/security/2026-09-10-security-assessment.md`) identified 16 findings of
critical, high, and medium severity. Spec `010-security-hardening` implements
the fixes; this ADR records the decisions that are not covered by amendments
to ADR-093, ADR-099, and ADR-101.

**Decision**:

1. **OIDC ID-token verification.** `oidc-service.ts` uses `openid-client`
   discovery plus `authorizationCodeGrant` with `expectedState`,
   `expectedNonce`, `pkceCodeVerifier`, and `idTokenExpected: true`. The
   configuration is wrapped in `enableNonRepudiationChecks` because
   oauth4webapi deliberately defers token-endpoint ID-token signature
   verification — without it, a forged `id_token` signed by an unknown key is
   accepted. Issuer, audience, `exp`/`iat`, `sub`, nonce, and JWKS signature
   are all validated. The previous manual `fetch` + `decodeJwtPayload` path
   (no signature check, hardcoded `/authorize` + `/oauth/token` endpoints) is
   removed.

2. **Session revocation ownership.** `DELETE /sessions/{publicId}/revoke`
   resolves the session by its non-secret `publicId` (404 when absent) and
   requires `ADMIN` role or ownership (`session.userId === caller.id`),
   returning `403` otherwise. Revocations are written to the audit log.

3. **Importer-config `secretRefs` are masked in API responses.** Responses
   expose only the reference `key`; the `env`/`file` location is a response
   projection concern and never leaves the service layer. Stored config is
   unchanged.

4. **`SECRETS_DIR` filesystem allowlist.** `file:` secret references resolve
   via `path.resolve(SECRETS_DIR, ref)`; absolute paths and any resolved path
   outside the directory are rejected. Default: `/run/secrets`.

5. **Importer URL allowlist.** `urlSafetyError`/`isUrlAllowedForImport`/
   `assertUrlAllowedForImport` in `packages/core` reject non-HTTP(S) schemes,
   `localhost`/`*.localhost`/`.local`, IPv4 loopback/RFC-1918/link-local
   (incl. `169.254.169.254` metadata)/CGNAT/multicast/reserved, and IPv6
   loopback/ULA/link-local/multicast (incl. IPv4-mapped forms). Applied via
   `.superRefine` to the `web-url` and `api-url` config schemas, which
   enforces it at config save and at run time (`schema.parse` inside `run()`).
   **Residual risk:** the guard checks the URL as written and cannot prevent
   DNS rebinding — a public hostname may resolve to a private address at
   request time. Deployments that expose importer configuration should
   additionally restrict container egress.

6. **Self-registration / ADMIN invariant.** `allowSelfRegistration` cannot be
   enabled while the effective `defaultUserRole` is `ADMIN` — evaluated
   against the merged state (defaults + stored + env overrides + patch), not
   just the patch. Registration defensively clamps `ADMIN` to `VIEWER`.

7. **Runtime floor.** Node 24 LTS (`node:24.x-alpine` Dockerfile, `.nvmrc`,
   `engines >= 24`, CI `node-version-file`) and PostgreSQL 14+ (startup
   preflight; `postgres:16.x-alpine` pinned in Compose and tests).

**Rationale**: These are the security-boundary decisions that were either
missing or implemented insecurely. Recording them here keeps the review
trail: each maps to a finding in the assessment and to a regression test in
the `010-security-hardening` spec.
