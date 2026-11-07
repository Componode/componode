# Implementation Plan: Source-scoped auto ComponentGroups

**Branch**: `067-auto-component-groups` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/067-auto-component-groups/spec.md`

## Summary

Add a provider-agnostic, source-scoped grouping pass to the backend: for every
`ImporterSource` bound to a config that hasn't opted out (`scope.autoGroup !==
false`) and whose importer manifest declares the capability, maintain at most
one auto-managed `ComponentGroup` whose members are exactly the components for
which that source is the sole effective-active reporter (ADR-129). The pass is
a failure-isolated post-run hook beside `runSuggestionPass` on both the Hub
(`import-run-service`) and Agent (`remote-run-service`) completion paths —
ordered before suggestion generation — plus hooks on `retireSource` /
`reactivateSource`. A new nullable `importer_sources.componentGroupId` FK is
the durable source→group link and auto-managed marker; `PATCH`/`DELETE` on
component groups gain controlled-conflict guards for auto-managed rows. Docker
is the only v1 adopter (`autoGroups: "source"` manifest capability +
`docker-cluster-{hash12(externalIdentity)}` slug strategy).

## Technical Context

**Language/Version**: TypeScript 6 (backend), Zod 4 schemas

**Primary Dependencies**: Fastify + Kysely (existing), `node:crypto` for the
slug hash, existing `writeEntityChange`/`metrics`/`appLogger` plumbing

**Storage**: PostgreSQL — one migration adds
`importer_sources.componentGroupId uuid NULL REFERENCES component_groups(id)
ON DELETE SET NULL` + index; `component_groups`/`components` rows are ordinary

**Testing**: Vitest integration tests (testcontainers Postgres) under
`packages/backend/test/integration/`, unit tests under `test/unit/`, Playwright
under `playwright/tests/` (mock Docker engine + seeded config, per
`docker-infra.spec.ts` precedent)

**Target Platform**: Componode backend (hub) — grouping runs server-side for
both Hub and Agent executions; `packages/agent` needs no changes

**Project Type**: web-service (pnpm monorepo; `packages/core` contract additions
+ `packages/backend` service/migration + `packages/importer-docker` manifest/
schema)

**Performance Goals**: N/A — pass is set-based over catalog-scale data, runs
once per completed run / source lifecycle event; no per-asset work

**Constraints**: failure-isolated (never throws into host run/source op);
full-recompute idempotent; null-or-ours membership rule; derived lifecycle;
no importer contract changes (`DiscoveredAsset` untouched)

**Scale/Scope**: one new service module, one migration, two trigger call sites
+ two source-lifecycle hooks, two API guards, one error code, docs updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface touched. |
| II. Importer-first | PASS | Importers stay pull-only `AsyncGenerator`s; grouping is backend derivation from stored `source_component_memberships` (ADR-113 precedent). Manifest gains an optional capability flag — additive, not a contract break. `DiscoveredAsset` unchanged (FR-016). |
| III. Two-level taxonomy | PASS | No category/provider/resourceType changes. |
| IV. Environment-as-instance | PASS | Reuses `ComponentGroup` per ADR-082 Amendment (system-provisioned mode); no `environment` fields, no lifecycle/status conflation — group lifecycle derives from member `Component.lifecycle`. |
| V. Factual vs. meaning | PASS (via ADR-129) | Auto-membership is a component attribute derived from factual memberships, not an edge; product hierarchy and all edges stay human-authored (FR-017/018). ADR-082/ADR-019 amendments ratified in ADR-129. |
| VI. Test-first | PASS | tasks.md sequences failing tests before implementation; Playwright coverage of the changed surface is a tracked task. |
| VII. Observability | PASS | Pass gets structured logging + Prometheus counters/histogram mirroring `runSuggestionPass`; failures metric-counted, never thrown. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/067-auto-component-groups/
├── plan.md              # This file
├── research.md          # Grilling record (pre-existing, ratified)
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── importer-registry.ts            # ImporterManifest.autoGroups?: "source"
│   └── constants/{error-codes,error-types}.ts  # + GROUP_AUTO_MANAGED (409)
├── backend/src/
│   ├── db/migrations/029_source_auto_groups.ts # importer_sources.componentGroupId
│   ├── db/types.ts                     # ImporterSourceRow.componentGroupId
│   ├── services/
│   │   ├── source-group-service.ts     # NEW — strategy registry, sole-reporter
│   │   │                               #   evaluation, pass, runAutoGroupPass wrapper
│   │   ├── component-group-service.ts  # auto-managed guards on update/delete
│   │   ├── import-run-service.ts       # Hub post-run trigger (before suggestions)
│   │   ├── remote-run-service.ts       # Agent store method + call before stageSuggestions
│   │   ├── importer-source-service.ts  # retire/reactivate post-commit hook
│   │   └── importer-config-service.ts  # (no change — scope passes through schema)
│   └── plugins/metrics.ts              # auto-group pass metrics
├── importer-docker/src/
│   ├── manifest.ts                     # autoGroups: "source"
│   └── config.ts                       # autoGroup?: boolean (strict schema)
└── agent/                              # no changes — grouping is hub-side

docs/
├── openapi.yaml                        # 409 GROUP_AUTO_MANAGED on PATCH/DELETE groups
├── api.md                              # regenerated error-codes table (docs:api)
├── importers/docker.md                 # autoGroup prose + regenerated config table
└── roadmap.md                          # ship-stage update

playwright/tests/                       # auto-group journey coverage
```

**Structure Decision**: backend monorepo service module + one Kysely migration +
core contract additions, matching the `edge-suggestion-service.ts` /
`runSuggestionPass` precedent exactly (failure-isolated derived-state pass,
metrics, post-run trigger ordering).

## Design resolutions carried from clarify/plan

- **DELETE semantics (clarify Q1 → A)**: `DELETE /component-groups/{id}` on an
  auto-managed group is rejected with `409 GROUP_AUTO_MANAGED`, same guard
  family as the `lifecycle` PATCH rejection. The `importer_sources.
  componentGroupId` FK uses `ON DELETE SET NULL` as defense-in-depth only —
  the service guard makes the path unreachable via the API.
- **Enablement under single binding**: `importer_sources.boundConfigId` is
  single-valued (last reporter binds; ADR-119). "Two configs on one source"
  therefore means *sequential* binding, not simultaneous feeds. Enablement is
  evaluated per source from its **currently bound config's**
  `scope.autoGroup !== false`; unbound (UNMONITORED) sources are skipped —
  frozen, never torn down. Post-run the just-bound config is authoritative;
  the spec's US3 scenarios hold under this reading ("maintained while any
  enabling config runs" = while an enabling config holds the binding and
  completes runs).
- **Evaluation scope**: the pass recomputes **all enabled capable sources** on
  every trigger. Sole-reporter status is a cross-source property — a
  `retireSource`/`reactivateSource` changes effective-active reporter sets for
  *other* sources' components, so per-source-scoped evaluation can leave
  derived state stale (violating the spec's "never goes stale" intent). The
  pass is set-based and idempotent; global scope is the simplest correct
  shape.
- **Effective-active reporter** (ADR-036 A1): membership `active = true` AND
  source `status IN ('ACTIVE','UNMONITORED')`. Computed by joining
  `source_component_memberships` → `importer_sources` and reducing in JS —
  components whose reporter set has exactly one source are that source's
  candidates.
- **Membership apply (per source, one transaction)**: ensure group via the
  `componentGroupId` link (create on first enable); `UPDATE components SET
  componentGroupId = groupId WHERE componentGroupId IS NULL AND id IN
  (eligible)`; `UPDATE components SET componentGroupId = NULL WHERE
  componentGroupId = groupId AND id NOT IN (eligible)` (evicts
  lost-exclusivity, stopped-reporting, and human-placed ineligible members —
  the group is automation-owned); lifecycle = `ACTIVE` iff ≥1 member
  `lifecycle = 'ACTIVE'` else `RETIRED`, updated only on transition.
- **Group identity**: `name` = `source.label` → engine component name
  (member with `resourceType = 'docker-engine'`, i.e. `externalId` =
  source `externalIdentity`) → `externalIdentity`; `slug` =
  `docker-cluster-{sha256(externalIdentity).hex[0:12]}` with
  `generateUniqueSlug` collision fallback; `description` = provenance text
  naming the source identity + ADR-129; `teamOwnerId`/`createdBy` = NULL.
- **Audit**: `writeEntityChange` for group `created` and `lifecycle`
  transitions only (rare, human-meaningful); per-component membership churn
  is derived state and stays unaudited (mirrors reconciliation precedent).
- **Metrics**: `auto_group_passes_total` (counter, `scope` label =
  `post-run`/`source-event`), `auto_group_pass_duration_seconds` (histogram),
  `auto_group_pass_errors_total` (counter) — mirrors the suggestion-pass
  trio.

## Phase 0 — Research

`research.md` already exists: the two-round grilling record (16 ratified
decisions) plus ADR-129. No NEEDS CLARIFICATION items remain in Technical
Context — the clarifications above resolve the only open design points
(DELETE guard from clarify; enablement/evaluation-scope interpretations
verified against `importer-source-service.ts` and `remote-run-service.ts`).

## Phase 1 — Design artifacts

- `data-model.md` — `importer_sources.componentGroupId`, auto-managed
  ComponentGroup lifecycle, membership invariant, strategy contract.
- `contracts/source-auto-groups.md` — pass trigger contract, membership
  invariant, API conflict responses, config scope key.
- `quickstart.md` — runnable validation scenarios (Hub run, Agent run,
  opt-out, retire/reactivate, guard matrix).
