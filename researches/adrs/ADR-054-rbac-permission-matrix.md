### ADR-054 — RBAC permission matrix

> **Status:** Ratified

**Context**: [ADR-027](./ADR-027-authentication-built-in-local-optional-oidc.md) names three roles but never enumerates permissions.

**Decision**: **Matrix approved as proposed in Q22.**

| Action | Viewer | Editor | Admin |
|---|---|---|---|
| View all entities, hierarchy, audit log | ✅ | ✅ | ✅ |
| View importer configs + run history | ✅ | ✅ | ✅ |
| Trigger on-demand importer run | ❌ | ✅ | ✅ |
| Create/edit/retire `DigitalProduct` | ❌ | ✅ | ✅ |
| Author/edit `COMPOSES`/`CONSUMES_FROM`/`DEPENDS_ON` edges | ❌ | ✅ | ✅ |
| Author/edit `OWNS`/`BELONGS_TO` edges | ❌ | ✅ | ✅ |
| Manually edit `Component.lifecycle` | ❌ | ✅ | ✅ |
| Manually edit `Component` attributes | ❌ | ✅ | ✅ |
| Create/edit `LineOfBusiness`/`Team` | ❌ | ❌ | ✅ |
| Create/edit `Person` (user management) | ❌ | ❌ | ✅ |
| Create/edit/delete `importer_config` | ❌ | ❌ | ✅ |
| View all sessions | ❌ | ❌ | ✅ |
| Revoke sessions (self or any) | self only | self only | ✅ any |
| Configure OIDC integration | ❌ | ❌ | ✅ |
| Bulk-retire components by importer config | ❌ | ❌ | ✅ |

**Rationale**: Viewer is strictly read-only (safest default for OIDC JIT-
provisioned users). Editor owns the meaning layer (architect/curator). Admin
owns everything including destructive/organizational actions. Session
revocation is self-service for Viewer/Editor; Admin can revoke anyone's.

---

**Amended by ADR-116**: the matrix gains `agent:read|create|update|delete`
(admin default) governing `/api/v1/agents[...]` management routes.

## Amendment 1 — `component:create` for manual component authoring (spec 042, gap G29)

**Context**: spec `042-catalog-authoring` ships `POST /api/v1/components` —
manual creation of components no importer discovers. The matrix's "Manually
edit `Component` attributes" row covers updates but the enumerated
`PERMISSIONS` map had no create permission for components (`componentGroup:create`
already exists for groups).

**Decision**: `component:create` → **EDITOR** — same tier as "Manually edit
`Component` attributes". Creation writes a `component` `created` entity
audit event with `toActor` attribution, enforces unique kebab-case slugs
(`409 SLUG_CONFLICT`), and never accepts importer-managed columns
(`externalId`, `details`, `lastSeen*`).
## Amendment 2 — ImporterSource lifecycle permissions (2026-10-31, spec 044)

**Refinement**: `importer:source:retire` and `importer:source:reactivate`
map to ADMIN. Source reads (`GET /importer-sources*`) are
authenticated-any, consistent with `GET /importer-configs`.

## Amendment 3 — URL Check monitoring permissions (2026-11-01, ADR-124)

**Refinement**: `urlCheck:create`, `urlCheck:update`, `urlCheck:delete`,
and `monitoringSetup:update` map to EDITOR — the `component:*`
catalog-authoring tier. The composite create-Component-with-checks path
requires `component:create` + `urlCheck:create`. All URL Check `GET`
routes stay authenticated-any (`verifySession`), per the read convention.

---

**Amended by ADR-122**: the matrix gains `importer:target:read|create|update|delete|test` → ADMIN for `/api/v1/docker-targets` (spec 049).

**Amended by ADR-124**: the matrix gains `urlCheck:create|update|delete`
and `monitoringSetup:update` (all EDITOR); see Amendment 3.

**Amended by ADR-125**: URL Check onboarding uses the same permission
granularity — composite monitoring creation requires `urlCheck:create`;
Credential references require `credential:read`; Agent vantage/ID requires
`agent:read`. First-instance recovery uses `component:update` (EDITOR).
