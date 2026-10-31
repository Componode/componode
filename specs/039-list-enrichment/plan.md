# Implementation Plan: List Enrichment

**Branch**: `039-list-enrichment` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

## Summary

Ship the backend rollups that the spec-038 flag-gated columns need: per-row
`worstStatus` + `lastSeenAt` on `GET /components`, and `memberCount` on
`GET /teams` — all computed in the same list query via correlated
subqueries (the `instanceCount` subquery at
`component-catalog-service.ts:151` is the established pattern). Then flip
the three flags and mark G21/G22 resolved.

## Technical Context

**Language/Version**: TypeScript (strict); Fastify + Kysely backend,
React/TanStack frontend.

**Primary Dependencies**: Kysely `eb.case()`/`eb.fn.max` for the rollups —
no `sql.raw` (ADR-084).

**Storage**: PostgreSQL — read-path subqueries only, no migrations.

**Testing**: Backend integration tests on the list endpoints;
frontend mapper test updates.

**Constraints**: single aggregate query per list endpoint (SC-003); CHECK
constraints only (no migrations needed — columns are computed, not stored).

## Constitution Check

| Principle | Verdict |
|---|---|
| IV. Lifecycle vs status separation | Pass — `worstStatus` is a rollup of `component_instances.status`, not a new lifecycle field. |
| VI. Test-first | Pass — integration test per endpoint first. |
| VII. Security | Pass — parameterized Kysely, no `sql.raw`. |
| ADR-104 | Response fields added — `docs/openapi.yaml` MUST be regenerated. |

## Phase 0 — Research (resolved; see research.md)

1. **worstStatus order**: ERROR > GONE > STOPPED > RUNNING — implemented as a
   `eb.case().when(exists-error).then("ERROR").when(exists-gone).then("GONE")
   .when(exists-stopped).then("STOPPED").when(exists-running).then("RUNNING")
   .else(null)` scalar select, matching `HEALTH_META` severity.
2. **lastSeenAt**: `eb.fn.max("component_instances.lastSeenAt")` correlated
   subquery — `components.lastSeenAt` (the table column, currently on the
   detail read) is a denormalized write-path field; the spec asks for the
   instance rollup, which is the honest read.
3. **memberCount**: `persons` rows carry `teamId` — same countAll subquery
   shape as `memberCount` already used for component_groups at
   `component-group-service.ts:57`.
4. **FR-004 (LOB detail)**: the LOB page consumes `useTeams()` (the list) —
   `memberCount` on `GET /teams` covers it; no second read needed.
5. **Importer `lastRun`**: already wired via `DashboardSummary.lastRuns`
   (spec 038) — verified sufficient; out of scope per G21's own wording.
6. **LOB-teams `Components` column**: `componentCount` per team is NOT
   computed by this spec — the column stays flag-gated on `teamMemberCounts`;
   registry note added (it rides with memberCount only if the same query
   yields it — it does not, components belong to teams via `teamOwnerId`
   and can be added cheaply — decision: **include it**, one more countAll
   subquery on `components.teamOwnerId`, so the whole flag flips cleanly).

## Phase 1 — Design

See `data-model.md` (payload fields) and `quickstart.md` (validation).
No `contracts/` dir — fields added to existing responses; OpenAPI regen
records them.
