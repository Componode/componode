# Implementation Plan: URL Check Monitoring

**Branch**: `051-url-check-monitoring` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/051-url-check-monitoring/spec.md`
(ratified design: ADR-123; research: `researches/url_importer_multi_endpoint_research.md`)

## Summary

Add a unified HTTP(S) monitoring capability: administrators configure **URL
Checks** against a Component's ComponentInstances from the Component detail
page; a scheduler probes each check on a cadence (default 5 min) from one
consistent vantage (Hub or a selected Import Agent); each attempt is stored as
an observation; the API computes availability / error rate / p50·p95·p99
request-to-response-headers latency over 24h/7d/30d rolling windows; API-type
checks authenticate via reusable Credentials (Basic/Bearer/custom headers).
Monitoring is fully separate from importer runs, ImporterSource, and
ComponentInstance status (ADR-123). ADR-106 destination restrictions are
unchanged.

Technical approach: three new tables (`component_monitoring_setups`,
`url_checks`, `url_check_observations`), a shared probe executor in
`packages/core` used by both Hub and Agent paths, a sweep-based probe
scheduler in backend, a new `url_check.probe`/`url_check.probe.result` agent
frame family (protocol v4) modeled on `credential.test`, REST routes under
`/api/v1`, React UI on the Component detail page plus a check-detail page and
a create-Component-with-checks page, OpenAPI + generated docs in the same
change (ADR-104), and an ADR ratifying the newly-closed contract surfaces
(ADR fidelity rule).

## Technical Context

**Language/Version**: TypeScript 6 (pnpm workspaces + Turborepo monorepo)

**Primary Dependencies**: Fastify (routes), Kysely (queries + migrations),
Zod (boundary schemas), node-cron/interval sweep (scheduling), `p-queue`
(probe concurrency — already a backend dep), React 18 + TanStack Query +
shadcn/ui (frontend), prom-client (metrics), pino (logging).

**Storage**: PostgreSQL — Kysely migrations (`packages/backend/src/db/migrations/`),
row types in `packages/backend/src/db/types.ts`, CHECK constraints from
`packages/core` constants (no native ENUMs).

**Testing**: Vitest — unit tests (core probe executor, schemas, services),
integration tests (testcontainers Postgres for service + scheduler behavior),
contract test (`api-docs-contract.test.ts`) for OpenAPI parity, frontend
component tests (vitest + RTL pattern from `catalog-authoring-042.test.tsx`).

**Target Platform**: Node server (Docker Compose single container serving
backend + static frontend); remote Import Agents (outbound WSS, protocol v4).

**Project Type**: web-service (REST API + SPA)

**Performance Goals**: probe dispatch sweep every ~15 s; per-check cadence min
60 s / default 300 s; probe timeout bounded (default 30 s, env-tunable);
concurrent hub probes bounded (default 10 via p-queue); metrics queries over
≤30 days of rows per check (≤ ~8.6k rows at default cadence).

**Constraints**: ADR-106 URL validation at write and run time; secrets never
in observations/logs/audit (ADR-107/090/091); STORED credential values never
leave the Hub (ADR-117); Prometheus labels low-cardinality only (ADR-069);
error codes/permissions/agent frames are closed contract surfaces → new ADR.

**Scale/Scope**: hundreds of checks, ≤ ~3M observation rows at 30-day
retention — indexed `(urlCheckId, scheduledAt)` queries + nightly purge.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-Organization | PASS | No tenant surfaces. |
| II. Importer-First | PASS | Monitoring is explicitly NOT an importer (ADR-123); importer contract untouched. |
| III. Two-Level Taxonomy | PASS | No category/provider changes. |
| IV. Environment-as-Instance | PASS | Checks attach to ComponentInstance; lifecycle/status never written by probes. |
| V. Factual vs Meaning | PASS | Checks are admin configuration on existing catalog entities; no importer-declared edges. |
| VI. Test-First | PASS | tasks.md orders failing tests before each implementation step; integration tests via testcontainers. |
| VII. Observability | PASS | pino logs + Prometheus counters/histogram (`vantage`,`outcome`,`errorType` labels only) included as tasks, not deferred. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/051-url-check-monitoring/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (http-api.md, agent-frames.md)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/url-check.ts           # enums: methods, auth modes, vantage, outcomes, error types, cadence/retention defaults
├── contracts/url-check.ts           # UrlCheck, UrlCheckObservation, MonitoringSetup, metrics/view DTOs
├── contracts/agent-protocol.ts      # + url_check.probe / url_check.probe.result frames (v4)
├── schemas/url-check.ts             # strict Zod create/update/query schemas
├── monitoring/probe.ts              # shared probe executor (fetch, manual redirect, timeout, header-boundary timing)
└── validation/url-safety.ts         # reused unchanged (ADR-106)

packages/backend/src/
├── db/migrations/024_url_checks.ts  # three tables + constraints + indexes
├── db/types.ts                      # row types + DB entries
├── services/
│   ├── url-check-service.ts         # CRUD + validation + audit
│   ├── monitoring-setup-service.ts  # setup CRUD (may fold into url-check-service)
│   ├── url-check-scheduler.ts       # sweep, dispatch, MISSED bookkeeping, retention purge
│   ├── probe-dispatcher.ts          # hub probe execution via p-queue + observation write
│   └── agent-session-service.ts     # + dispatchUrlCheckProbe (credential.test precedent)
├── routes/url-checks.ts             # /api/v1 routes; register in app.ts + contract test
├── plugins/rbac.ts                  # + urlCheck:* permissions
└── plugins/metrics.ts               # + url_check_probe_total, url_check_probe_duration_seconds

packages/agent/src/
├── client.ts                        # route url_check.probe frame
└── probe.ts                         # local probe execution + result reply (executor.ts patterns)

packages/frontend/src/
├── api/hooks/url-checks.ts          # TanStack Query hooks
├── api/mappers/monitoring.ts        # API→view mappers
├── ux/components/catalog/
│   ├── url-checks-card.tsx          # checks table on Component detail
│   ├── url-check-editor.tsx         # create/edit dialog incl. auth section
│   ├── monitoring-setup-editor.tsx  # cadence + vantage editor
│   └── url-check-detail.tsx         # metrics + observations
├── ux/components/forms/url-check-rows.tsx  # repeated-check row editor
├── ux/app/components/
│   ├── $slug.checks.$checkId.tsx    # check detail route
│   └── new.tsx                      # create-Component-with-checks FormPage
└── ux/lib/nav.ts                    # + "checks" segment label

docs/
├── url-checks.md                    # user guide (sidebar in docs-site config)
├── openapi.yaml                     # paths + Problem.code enum
└── api.md                           # regenerated GENERATED table

researches/adrs/ADR-124-url-check-execution-surfaces.md  # new ADR (fidelity rule)
```

**Structure Decision**: follows the existing three-package split — domain
contracts/constants/schemas in `core`, runtime services/routes/migrations in
`backend`, stream frames handled in `agent`, UI in `frontend`. The probe
executor lives in `core` so Hub and Agent share one implementation (same as
secrets resolvers today). Frontend additions follow the catalog/`ux`
conventions; no new package is created.

## Phase 0 → research.md

Resolves: probe timeout/cancellation/concurrency/rate-limit values; storage
and query design for observations + rolling summaries + percentiles; URL-edit
identity and disabled/removed retention semantics; credential linkage and
secret contract (custom-header mapping, write-only, audit redaction,
testing, STORED vs AGENT_MANAGED vantage rule); missed-probe recording;
agent frame design and protocol version bump; permission names and error
codes; OpenAPI/doc surfaces.

## Phase 1 → data-model.md, contracts/, quickstart.md

- `data-model.md` — `component_monitoring_setups`, `url_checks`,
  `url_check_observations` columns, constraints, indexes, state transitions,
  metric computation queries.
- `contracts/http-api.md` — REST endpoints, request/response shapes,
  permissions, error codes.
- `contracts/agent-frames.md` — `url_check.probe`/`url_check.probe.result`
  frame shapes, secretRefMap handling, protocol v4.
- `quickstart.md` — runnable validation scenarios.
