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