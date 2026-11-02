# Implementation Plan: URL Check repeated-failure policy & spec-status reconciliation

**Branch**: `056-url-check-failure-policy` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/056-url-check-failure-policy/spec.md`

## Summary

Ratify and ship the URL Check repeated-failure contract: a check probes on
its configured cadence, records exactly one observation per scheduled slot,
never retries or backs off in-slot, and **auto-disables after a configurable
consecutive-failure threshold** (global env default, per-check override;
`FAILURE` and `MISSED` both count, `SUCCESS` resets). The disable is
audited, distinguishable from a manual disable, and re-enabled manually —
alerting stays out of scope. The contract is recorded as ADR-124 Amendment
3 and in `docs/url-checks.md`. The same change normalizes spec `Status` to
`Shipped` across every shipped spec under `specs/` and records the
`Draft` → `Shipped` convention in `AGENTS.md`.

## Technical Context

**Language/Version**: TypeScript (Node 22 ESM backend/agent, React frontend)

**Primary Dependencies**: Fastify, Kysely, Zod (backend/core); React +
TanStack Query + shadcn/ui (frontend)

**Storage**: PostgreSQL — one migration extending `url_checks`

**Testing**: Vitest + testcontainers integration tests (backend),
Vitest unit tests (frontend)

**Target Platform**: Linux containers (Compose), Windows dev shell

**Project Type**: pnpm workspace monorepo (`packages/{core,backend,frontend}`)

**Performance Goals**: streak update is O(1) inside the existing observation
transaction — no per-write queries added

**Constraints**: no `sql.raw` (Kysely parameterized only); GET routes
side-effect-free; error shape `{code,message,details?}`; env tunables via
`envInt`; audit writes in the same transaction as the domain mutation;
Prometheus metrics with bounded labels (ADR-069)

**Scale/Scope**: 3 new columns, 1 new service module, ~2 modified write
paths, schema/contract field additions, frontend badge + editor field,
~55 spec status lines, ADR amendment + docs

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Verdict | Notes                                                                                                                                      |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Single-Organization      | PASS    | no tenancy surface                                                                                                                         |
| II. Importer-First          | PASS    | no importer change; URL checks are monitoring, not import                                                                                  |
| III. Two-Level Taxonomy     | PASS    | no entity/taxonomy change                                                                                                                  |
| IV. Environment-as-Instance | PASS    | checks stay attached to ComponentInstance; no lifecycle conflation — `enabled`/`autoDisabledAt` are check config, not `lifecycle`/`status` |
| V. Factual vs. Meaning      | PASS    | monitoring data stays display-only; no health-rollup impact                                                                                |
| VI. Test-First              | PASS    | integration tests for both write paths precede implementation in tasks.md                                                                  |
| VII. Observability          | PASS    | structured log + bounded-label metric on auto-disable; audit entry                                                                         |

No violations — Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/056-url-check-failure-policy/
├── plan.md              # This file
├── research.md          # Phase 0 output — write-path and threshold decisions
├── data-model.md        # Phase 1 output — url_checks column deltas + invariants
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/
│   └── api.md           # Phase 1 output — UrlCheck schema delta
├── checklists/
│   └── requirements.md  # spec-quality checklist (specify output)
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/url-check.ts        # URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT/MAX
├── contracts/url-check.ts        # UrlCheck += 3 fields; AUTO_DISABLED status
└── schemas/url-check.ts          # autoDisableAfter on create/update schemas

packages/backend/src/
├── db/
│   ├── migrations/027_url_check_auto_disable.ts   # 3 columns + CHECK
│   └── types.ts                                   # UrlCheckRow delta
├── services/
│   ├── url-check-auto-disable.ts  # NEW — streak step + threshold eval + disable + audit
│   ├── probe-dispatcher.ts        # recordObservation calls the streak step
│   ├── url-check-scheduler.ts     # bulk-MISSED writer calls the streak step
│   └── url-check-service.ts       # toApi fields; enable transition resets
└── observability metrics          # url_check auto-disable counter

packages/frontend/src/
├── api/mappers/monitoring.ts      # checkStatusOf → AUTO_DISABLED
├── api/hooks/url-checks.ts        # field plumbing
└── ux/components/catalog/
    ├── url-checks-card.tsx        # Auto-disabled badge
    ├── url-check-detail.tsx       # threshold + disable-time copy
    └── url-check-editor.tsx       # optional threshold input
```

**Structure Decision**: backend service-module addition inside the existing
monitoring seam; no new packages, routes, or protocol frames.

## Phase 0 — Research summary

See [research.md](research.md). Key decisions: maintained
`consecutiveFailures` counter (not derived) updated in-transaction at both
observation write paths; effective threshold =
`COALESCE(autoDisableAfter, URL_CHECK_AUTO_DISABLE_AFTER)` with shipped
default 12 and `0` = never; `autoDisabledAt` marker distinguishes
auto-disable; no agent-protocol or route changes; ADR-124 Amendment 3;
status convention recorded in `AGENTS.md`.

## Phase 1 — Design summary

- [data-model.md](data-model.md): `autoDisableAfter` (int, NULL/0–1000),
  `consecutiveFailures` (int, default 0), `autoDisabledAt` (timestamptz);
  state-transition table and invariants.
- [contracts/api.md](contracts/api.md): `UrlCheck` +3 fields;
  `autoDisableAfter` accepted on create/update; system-actor
  `auto_disable` audit event; `AUTO_DISABLED` display status.
- [quickstart.md](quickstart.md): test-first validation path and a
  Compose smoke scenario.

## Constitution Check — post-design re-evaluation

Unchanged: PASS across all seven principles. The design adds no tenancy,
importer, taxonomy, or lifecycle-surface change; tests lead implementation;
observability ships with the code path.

## Risk notes

- **Both write paths must call the streak step** — a missed path silently
  breaks the contract. Mitigated by an integration test that drives
  backlog `MISSED` insertion to the threshold and asserts the disable.
- **Existing checks** gain `consecutiveFailures=0` on migration — their
  streak starts clean, which matches "consecutive failures from when the
  policy shipped"; noted in the ADR amendment.
- **Bulk MISSED batches** can overshoot the threshold mid-batch; the
  evaluation runs once per check after the batch lands — disable happens
  at the same sweep, never partially.
