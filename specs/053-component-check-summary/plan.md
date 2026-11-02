# Implementation Plan: Component Check Summary

**Branch**: `053-component-check-summary` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/053-component-check-summary/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Close the G2 gap: the Component checks table shows no windowed
availability/latency summary, and its recent-outcome strip fans out one
observations request per row. The design extends the existing bounded
list read instead of adding a second per-check path:

1. **Bounded list payload** — `GET /components/:componentId/url-checks`
   items gain `summary` (24h availability, p95, coverageGap, outcome
   counts — same formulas as `getMetrics`) and `recent` (last ≤12
   observations, the same payload the dot strip already renders).
   `listChecks` adds two constant-cost queries: one `GROUP BY
urlCheckId` windowed aggregate and one `row_number() over
(partition by urlCheckId)` recent-observations read — the endpoint
   stays at a fixed query count regardless of check count.
2. **Table summary columns** — the card renders "Availability (24h)"
   and "p95 (24h)" per row beside the existing columns, labeled with
   the window in the header and the "reachable from" vantage phrasing
   the card description already carries. Coverage gaps stay
   distinguishable: a row whose window contains MISSED slots marks its
   availability figure with a missed-slots annotation rather than
   reading as a plain endpoint failure. No-observation checks show an
   explicit no-data state.
3. **Fan-out removal** — `RecentOutcomes` reads `check.recent` from the
   list payload; the per-row `useUrlCheckObservations` call is deleted.
   The detail page's metrics/observations endpoints are untouched.
4. **Contract surfaces** — `UrlCheckSummary` joins the core contract;
   `UrlCheckListItem` extends in OpenAPI; ADR-124 gets a small
   amendment noting the read-path extension (its API-surface list is a
   closed contract); `docs/url-checks.md` documents the new columns and
   their semantics.

## Technical Context

**Language/Version**: TypeScript, Node.js 20+ (ESM)

**Primary Dependencies**: Fastify, Kysely, zod (backend); React 18, TanStack Query, Tailwind/shadcn (frontend); vitest + testcontainers (tests)

**Storage**: PostgreSQL — no schema changes; all figures derive from `url_check_observations` at read time

**Testing**: vitest — backend testcontainers integration (`test/integration/url-checks-*`), frontend unit (`src/test/unit/url-checks.test.tsx`)

**Target Platform**: Linux containers / Node services; browser SPA

**Project Type**: web-service + SPA in a pnpm monorepo

**Performance Goals**: list endpoint stays at a constant query count (≤6) for any check count; windowed aggregates run against the existing `(urlCheckId, scheduledAt)` access path

**Constraints**: GET stays side-effect-free (ADR-094); no `sql.raw`/`sql.fragment` — Kysely `sql` template parameters only (ADR-084); no per-check/per-URL telemetry labels (ADR-069); response schema documented in OpenAPI in the same change (ADR-104)

**Scale/Scope**: 3 packages (`core`, `backend`, `frontend`) + docs + 1 ADR amendment; no agent, importer, or migration work

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                       | Verdict | Notes                                                                                                                                                    |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Single-organization          | PASS    | Read-path extension only; no tenancy                                                                                                                     |
| II. Importer-first              | PASS    | No importer touched; monitoring stays separate from importer runs                                                                                        |
| III. Two-level taxonomy         | PASS    | No category/provider changes                                                                                                                             |
| IV. Environment-as-instance     | PASS    | Checks stay attached to ComponentInstance; monitoring status remains distinct from instance status (FR-014)                                              |
| V. Factual vs. meaning layer    | PASS    | No hierarchy/importer-edge changes                                                                                                                       |
| VI. Test-first (NON-NEGOTIABLE) | PASS    | tasks.md orders failing integration + unit tests before implementation per module                                                                        |
| VII+ workflow rules             | PASS    | OpenAPI + `docs:api` in-change (ADR-104); ADR-124 amendment for the read-path surface (ADR fidelity); `docs/url-checks.md` updated; side-effect-free GET |

No violations — Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/053-component-check-summary/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── http-api.md      # extended list-item payload: summary + recent
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── contracts/url-check.ts          # +UrlCheckSummary; UrlCheckListItem += {summary, recent}
└── index.ts                        # export UrlCheckSummary

packages/backend/src/
├── services/url-check-service.ts   # listChecks: +windowed aggregate query, +recent-observations query
└── (routes unchanged — same GET /components/:componentId/url-checks)

packages/frontend/src/
├── api/mappers/monitoring.ts       # mapUrlCheckListItem: +summary/recent view fields
├── ux/lib/view-types.ts            # +UrlCheckSummaryView; UrlCheckView += {summary, recent}
└── ux/components/catalog/
    └── url-checks-card.tsx         # summary columns; RecentOutcomes reads check.recent (fan-out deleted)

docs/
├── openapi.yaml                    # UrlCheckListItem += summary/recent; +UrlCheckSummary schema
├── api.md                          # regenerated via docs:api
└── url-checks.md                   # compact summary columns + coverage-gap semantics

researches/adrs/
└── ADR-124-url-check-execution-surfaces.md  # Amendment 2: list read-path carries summary + recent
```

**Structure Decision**: extend the existing feature-051 surfaces — the
compact summary is a read-path extension of `listChecks`, not a new
endpoint, service, or table. The windowed aggregate shares the metric
definitions `getMetrics` already implements (kept as the single
formula reference; the list query duplicates the aggregation shape at
`GROUP BY` level rather than calling `getMetrics` per check — that
would reintroduce the fan-out at the SQL layer).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass.

## Phase 0 → research.md

See [research.md](research.md): contract shape, windowed-aggregate query
shape, recent-observations read, coverage-gap presentation, no-data
presentation, fan-out verification strategy, and doc/ADR surfaces — all
resolved.

## Phase 1 → design artifacts

- [data-model.md](data-model.md) — one new derived contract type, no new entities
- [contracts/http-api.md](contracts/http-api.md) — extended list-item payload
- [quickstart.md](quickstart.md) — runnable validation scenarios
