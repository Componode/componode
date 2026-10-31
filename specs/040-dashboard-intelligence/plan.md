# Implementation Plan: Dashboard Intelligence

**Branch**: `040-dashboard-intelligence` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

## Summary

Ship the backend fields the spec-038 flag-gated dashboard surfaces need:
`deltas` (trailing-7-day created counts) on `GET /dashboard/summary`,
`detail` strings plus the `CREDENTIAL_EXPIRING` kind on `AttentionItem`,
and `createdBy`/`enrollmentExpiresAt` on the agent read — then wire the
mappers, flip `statDeltas`/`attentionDetail`/`credentialExpiring`/
`agentEnrolledBy`, and mark G23–G25 resolved.

## Technical Context

**Language/Version**: TypeScript (strict); Fastify + Kysely backend,
React/TanStack frontend.

**Primary Dependencies**: Kysely `eb.fn.count` / correlated subqueries /
`distinctOn` — no `sql.raw` (ADR-084).

**Storage**: PostgreSQL — read-path only, no migrations (`createdAt`,
`expiresAt`, `enrollmentTokenExpiresAt`, `createdBy` columns all exist).

**Testing**: Backend integration tests on `GET /dashboard/summary` and
`GET /agents/:id`; frontend mapper + component test updates.

**Constraints**: single pass over existing queries (SC-004); side-effect-
free GET (ADR-094); OpenAPI regen (ADR-104); kind-enum extension ratified
via ADR-116 amendment (ADR fidelity).

## Constitution Check

| Principle | Verdict |
|---|---|
| IV. Lifecycle vs status separation | Pass — deltas mirror each headline population's existing lifecycle/status filters; nothing new persisted. |
| VI. Test-first | Pass — integration test per endpoint first. |
| VII. Security | Pass — parameterized Kysely; `createdBy` resolved to a display name server-side (no raw id leak); `enrollmentExpiresAt` never carries token material. |
| ADR-094 | Pass — read-only fields on an already side-effect-free GET. |
| ADR-104 | Response fields + new enum value — `docs/openapi.yaml` MUST be regenerated. |
| ADR fidelity | `AttentionItem.kind` enum extended → Amendment 4 on ADR-116 (owns the attention-kind mechanism) + amends-list back-pointer. |

## Phase 0 — Research (resolved; see research.md)

1. **Deltas**: three grouped `createdAt >= now-7d` counts scoped to each
   headline population (products: all; components: ACTIVE; instances:
   non-GONE). `0` is a real value.
2. **`detail` per kind**: FAILED_RUN ← `import_runs.errorType`/
   `errorMessage` (add to select); OFFLINE_AGENT ← `lastSeenAt` +
   `disconnectReason` (DISTINCT ON, agent-service pattern); INSTANCE_* ←
   status + lastSeenAt; CREDENTIAL_EXPIRING ← expiry distance;
   PRODUCT_ERROR/SUNSET_* → optional null.
3. **`CREDENTIAL_EXPIRING`**: `expiresAt <= now + 30d` (G5 window),
   expired included; `href` `/credentials/{id}`; ranked below
   OFFLINE_AGENT, above sunset items, asc by `expiresAt`.
4. **`createdBy`/`enrollmentExpiresAt`**: added to core `ImportAgent`
   contract, populated by `toApi` — `LEFT JOIN persons` →
   `COALESCE(displayName, username)`; live-token expiry gated on the
   existing `pendingEnrollment` predicate.
5. **"All healthy" importer line**: derived client-side from
   `summary.data.attention` — no backend field.
6. **ADR-116 Amendment 4**: ratifies `detail` + `CREDENTIAL_EXPIRING`
   (enum extension + ranking); openapi.yaml regen records the wire shape.

## Phase 1 — Design

See `data-model.md` (payload fields) and `quickstart.md` (validation).
No `contracts/` dir — fields added to existing responses; OpenAPI regen
records them.

## Project Structure

```text
packages/backend/src/
├── services/dashboard-service.ts   # deltas + detail + CREDENTIAL_EXPIRING
├── services/agent-service.ts       # createdBy/enrollmentExpiresAt in toApi + getAgent join
packages/core/src/contracts/
└── import-agent.ts                 # +createdBy, +enrollmentExpiresAt
packages/frontend/src/
├── api/types.ts                    # AttentionItem.detail/kind, DashboardSummary.deltas
├── api/mappers/dashboard.ts        # pass item.detail through
├── api/mappers/operations.ts       # wire createdBy/enrollmentExpiresAt
├── ux/app/index.tsx                # pass deltas + importersHealthy to StatGrid
├── ux/components/dashboard/stat-grid.tsx   # "All healthy" importer line
└── ux/lib/flags.ts                 # flip 4 flags ON
docs/openapi.yaml                   # AttentionItem.detail, CREDENTIAL_EXPIRING,
                                    # DashboardSummary.deltas, ImportAgent fields
researches/adrs/ADR-116-*.md        # Amendment 4
researches/ux-rewrite-gaps.md       # G23/G24/G25 → RESOLVED by spec 040
```

**Structure Decision**: backend-service + shared-contract field additions
with frontend wiring — same shape as spec 039.
