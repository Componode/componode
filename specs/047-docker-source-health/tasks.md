# Tasks: Docker Source Health Observations and ImporterSource UI

**Input**: Design documents from `/specs/047-docker-source-health/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — constitution VI makes test-first non-negotiable;
`validateDiscoveredAsset` must be exercised on emitted asset shapes.

**Organization**: US1 = health-aware instance status (importer mapping +
rollup verification); US2 = allowlisted `dockerObservation` snapshot
(importer emit + instance-detail render + OpenAPI doc); US3 = generic
ImporterSource UI (`/sources` routes); US4 = user-confirmed
`compose:`/`service:` tag suggestions; US5 = operator docs.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: green baseline on the feature branch — no new packages or
migrations this wave

- [x] T001 Verify green baseline: `pnpm install`, then `pnpm --filter @componode/importer-docker test`, `pnpm --filter @componode/backend test`, `pnpm --filter @componode/frontend test` on branch `047-docker-source-health`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared frontend plumbing every UI story builds on — no
behavior change, wire fields carried through types/mappers only

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Re-export importer-source contracts in `packages/frontend/src/api/types.ts` (`ImporterSource`, `ImporterSourceListItem`, `BoundConfigSummary`, `ImporterSourceStatus` from `@componode/core` — precedent: agent type re-exports) and add local interfaces `SourceComponentMembership`, `SourceInstanceMembership`, `SourceMembershipsResponse` mirroring `docs/openapi.yaml` `SourceComponentMembership`/`SourceInstanceMembership` schemas (each carries `details: object | null`, `active`, `firstSeenInRunId`, `lastSeenInRunId`)
- [x] T003 [P] Carry `rawConfig` to the view layer: add `rawConfig?: Record<string, unknown> | null` to `ComponentInstance` in `packages/frontend/src/api/types.ts`, to the view `ComponentInstance` in `packages/frontend/src/ux/lib/view-types.ts`, and through `mapComponentInstance` in `packages/frontend/src/api/mappers/catalog.ts` (wire already sends it — `component-catalog-service.ts` `selectAll`)
- [x] T004 Carry `ComponentWithInstances.details` to the view layer in `packages/frontend/src/api/mappers/catalog.ts` `mapComponent` and the view `Component` in `packages/frontend/src/ux/lib/view-types.ts` (needed for tag-suggestion derivation — `details` holds `composeProject`/`composeService` for Docker components)
- [x] T005 [P] Importer-source data layer: new `packages/frontend/src/api/hooks/importer-sources.ts` mirroring `api/hooks/agents.ts` — `useImporterSources({status?, importerName?})` → `GET /importer-sources`, `useImporterSource(id)` → `GET /importer-sources/:id`, `useSourceRuns(id)` → `GET /importer-sources/:id/runs`, `useSourceMemberships(id)` → `GET /importer-sources/:id/memberships`, `useRetireSource`/`useReactivateSource` mutations POSTing retire/reactivate and invalidating `["importer-sources"]`; add `mapImporterSource` in `packages/frontend/src/api/mappers/operations.ts`, `ImporterSource` view type in `packages/frontend/src/ux/lib/view-types.ts`, and `SOURCE_STATUS_META` (`ACTIVE`/`UNMONITORED`/`RETIRED`) in `packages/frontend/src/ux/lib/domain.ts` (pattern: `AGENT_STATUS_META`)

**Checkpoint**: all wire fields reachable in the view layer; hooks ready —
story UI can begin

---

## Phase 3: User Story 1 - Health-aware instance status for containerized workloads (Priority: P1) 🎯 MVP

**Goal**: Docker-sourced Instances carry status that reflects engine state
+ health-check facts per `contracts/docker-observation.md`; ADR-112
rollup degrades automatically.

**Independent Test**: mocked inspect fixtures covering every table row →
emitted status matches; unhealthy → `ERROR` persisted → wired Product
health degrades.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [P] [US1] `packages/importer-docker/test/mapping.test.ts` (new): assert `mapStatus` returns per `contracts/docker-observation.md` table — `running`+`healthy`/`starting`/absent health → `RUNNING`; `running`+`unhealthy` → `ERROR`; `running`+`OOMKilled` → `ERROR`; `created`/`paused`/`exited` → `STOPPED`; `exited`+`OOMKilled` → `ERROR`; `dead`/`restarting`/`removing`/unknown/`undefined` → `ERROR` (fail-closed); non-zero `exitCode` alone does NOT escalate `exited` past `STOPPED`
- [x] T007 [P] [US1] Extend `packages/importer-docker/test/importer.test.ts`: mocked dockerode inspect carrying `State.Health`/`OOMKilled` fixtures → emitted `DiscoveredAssetInstance.status` matches the table; every emitted asset still passes `validateDiscoveredAsset`
- [x] T008 [P] [US1] Extend `packages/backend/test/integration/docker-import.test.ts`: fake docker importer emitting an unhealthy container → persisted `component_instances.status === "ERROR"`; a Product with a human-declared `DEPENDS_ON` edge to that Component reports degraded health via the existing rollup (`computeHealthForProducts`/`product-health-service`) — proves SC-002 with zero rollup changes

### Implementation for User Story 1

- [x] T009 [US1] `packages/importer-docker/src/mapping.ts`: extend `ContainerInspect.State` with `OOMKilled?: boolean`, `Restarting?: boolean`, `FinishedAt?: string`, and `Health?: { Status?: string; FailingStreak?: number }` — do NOT declare `Health.Log`; replace `mapStateToStatus(state)` with `mapStatus(state)` implementing the contract table (engine state first, `OOMKilled` override, then `running`+`unhealthy` → `ERROR`); update the `42-43` Wave C comment to reference ADR-121 Amendment 1

**Checkpoint**: every status row proven by test; rollup degrade verified
end-to-end

---

## Phase 4: User Story 2 - Allowlisted Docker observation snapshot as provenance (Priority: P1)

**Goal**: every Docker Instance persists `rawConfig.dockerObservation`
per the allowlist and the Instance detail view renders it.

**Independent Test**: inspect fixtures with/without health checks →
emitted observation equals allowlist exactly; excluded data absent from
asset JSON; UI renders fields for Docker instances and nothing for others.

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T010 [P] [US2] Extend `packages/importer-docker/test/mapping.test.ts`: emitted `rawConfig.dockerObservation` equals `contracts/docker-observation.md` allowlist — `state` verbatim (`unknown` fallback), `exitCode` only when non-zero, `oomKilled`/`restarting` only when true, `startedAt`/`finishedAt` with `0001-01-01` zero-time → `null`, `health{status,failingStreak>0}` or `health: null` when no healthcheck; fixture containing `State.Health.Log` and `Config.Healthcheck.Test` → none of those strings appear in the emitted asset JSON
- [x] T011 [P] [US2] `packages/frontend/src/test/unit/` component-detail test (new or extend nearest catalog test): instance with `rawConfig.dockerObservation` → expand control renders fields (`state`, `health.status`/`failingStreak`, `oomKilled`, times); instance without it → no expand control; `health: null` → explicit "no health check configured" rendering

### Implementation for User Story 2

- [x] T012 [US2] `packages/importer-docker/src/mapping.ts`: emit `rawConfig.dockerObservation` per `contracts/docker-observation.md` — read only `State.Status`/`ExitCode`/`OOMKilled`/`Restarting`/`StartedAt`/`FinishedAt`/`Health.Status`/`Health.FailingStreak` (never `Health.Log`, never `Config.Healthcheck`); merge into the existing `rawConfig` object alongside `containerName`/`imageRef`/etc.
- [x] T013 [US2] `packages/frontend/src/ux/components/catalog/component-detail.tsx`: expandable instance row in the existing Instances table — per-instance toggle revealing a `DescriptionList` of allowlisted `dockerObservation` fields (`HealthBadge`-styled health status, `MonoValue`/`RelativeTime` for values/times, "no health check configured" when `health: null`, control hidden when `dockerObservation` absent)
- [x] T014 [US2] `docs/openapi.yaml`: document the `instances` array on `GET /components/{id}` (already returned, currently undocumented) plus a `ComponentInstance` schema including `rawConfig` — verify the backend contract test still passes (route surface unchanged)

**Checkpoint**: provenance visible end-to-end — daemon-reported facts
persisted allowlisted and readable on instance detail

---

## Phase 5: User Story 3 - ImporterSource visibility and lifecycle controls (Priority: P2)

**Goal**: `/sources` + `/sources/$id` under the existing "Sources" nav
section — list, detail, retire/reactivate on the existing API.

**Independent Test**: fixtures with `ACTIVE`/`UNMONITORED`/`RETIRED`
sources → list renders all states; detail tabs show identity/runs/
memberships/activity; ADMIN retire+reactivate round-trip; non-ADMIN sees
no lifecycle controls.

### Tests for User Story 3 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T015 [P] [US3] `packages/frontend/src/test/unit/` sources tests (new): list renders identity/importer/bound-config-link/status-badge/lastCompletedRunAt/membership counts for all three lifecycle states + empty state; detail shows `UNMONITORED`/`RETIRED` explanation alert, run rows link only when `configId` non-null, retire/reactivate buttons gated on `canAccess(role,"ADMIN")`, `409 SOURCE_STATE_CONFLICT` surfaced as error

### Implementation for User Story 3

- [x] T016 [US3] Routes + nav: register `/sources` → `UxSourcesPage` and `/sources/$id` → `UxSourceDetailPage` in `packages/frontend/src/ux/routes.tsx` (next to importer/agent routes, `authed` wrapper — readable by all roles); add `Importer sources` → `/sources` as third item in the `"Sources"` section of `packages/frontend/src/ux/lib/nav.ts` + `sources: "Sources"` in `SEGMENT_LABELS`
- [x] T017 [US3] `packages/frontend/src/ux/app/sources/index.tsx` + `packages/frontend/src/ux/components/sources/sources-view.tsx` + `sources-table.tsx` mirroring `agents/`: `ListToolbar` (search on identity/label + `ACTIVE|UNMONITORED|RETIRED` status filter), `Table` columns — externalIdentity (`MonoValue`), importer (`importerProvider` mapper), boundConfig link or "—", `StatusBadge` via `SOURCE_STATUS_META`, `RelativeTime` lastCompletedRunAt, membership counts; row click navigates to `/sources/:id`; `EmptyState` explains Sources appear when an importer reports source identity; `TableSkeleton`/`ErrorState`/`ForbiddenState` loading states
- [x] T018 [US3] `packages/frontend/src/ux/app/sources/$id.tsx` + `packages/frontend/src/ux/components/sources/source-detail.tsx` mirroring `agent-detail`: tabs `overview`/`runs`/`memberships`/`activity` via `useValidatedTab`; overview `DescriptionList` (identity, label, importer, bound config link, status, first/last seen, membership counts) + `Alert` for `UNMONITORED` ("a config reporting the same identity rebinds on its next run") and `RETIRED`; runs `Table` (result/started/finished/assets/errors — link to `/importers/:configId/runs/:runId` only when `configId` non-null); memberships two tables (name/externalId, `active`, details summary) + `truncated` notice at the 200-row cap; activity via `useEntityHistory("importer_source", id)`; `DangerZone`/`ConfirmDialog` Retire (`POST retire`) / Reactivate (`POST reactivate`) gated `canAccess(role,"ADMIN")` with refetch-after-mutation and `409 SOURCE_STATE_CONFLICT` error toast

**Checkpoint**: full Source lifecycle visible and operable from the UI —
identity, bound config, runs, memberships, retire/reactivate, reattach
explained

---

## Phase 6: User Story 4 - User-confirmed Compose tag suggestions (Priority: P2)

**Goal**: `compose:<project>`/`service:<project>.<service>` suggestion
chips in the Component edit dialog — confirmation-only, invalid omitted.

**Independent Test**: compose details present → chips offered; accept →
tag added on save; invalid/overlong/already-present → not offered; no
compose details → nothing.

### Tests for User Story 4 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T019 [P] [US4] Extend `packages/frontend/src/test/unit/component-edit-dialog.test.tsx`: component with `details.composeProject`/`composeService` → `compose:<p>` + `service:<p>.<s>` chips rendered; accepting a chip appends to `TagsInput` state (nothing written until save); values failing core `tagSchema` (invalid chars, or `service:<p>.<s>` exceeding 32 chars) → no chip; candidates already in `tags` → not re-offered; absent details → no chips

### Implementation for User Story 4

- [x] T020 [US4] `packages/frontend/src/ux/components/catalog/component-edit-dialog.tsx`: below `TagsInput`, compute candidates from `component.details` (`compose:<project>` when `composeProject` set; `service:<project>.<service>` when both set) — validate each with `tagSchema` from `@componode/core` (trim/lowercase transform then grammar; failing values omitted, never truncated), exclude tags already present, render remaining as `Badge`+accept chips; accept → `onChange([...tags, candidate])`; hide section when no candidates

**Checkpoint**: suggestions derive, filter, and confirm correctly —
zero auto-writes

---

## Phase 7: User Story 5 - Operator documentation stays accurate (Priority: P3)

**Goal**: `docs/importers/docker.md` + operations docs match implemented
behavior.

**Independent Test**: guide sections match the allowlist/table; Source
lifecycle behavior documented where operators look.

### Implementation for User Story 5

- [x] T021 [US5] Update `docs/importers/docker.md`: replace the "health observations arrive in later waves" note — document `rawConfig.dockerObservation` allowlisted fields, the state×health→status table, the extended exclusion list (`Health.Log`, test commands, stats, events, inspect JSON, history); document Source lifecycle in the operations area (`/sources`: reattach via rebind-on-report, explicit retire/reactivate) — find the natural home (`docs/agents.md` sibling or importer docs) and link consistently

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T022 Append `## Amendment 1 — Health-aware status and dockerObservation` to `researches/adrs/ADR-121-docker-importer.md` ratifying `contracts/docker-observation.md` (allowlist + state×health table — supersedes item 7's Wave C engine-state-only rule; extends item 8's allowlist; item 9 deferred list updated); update `researches/architecture-decisions.md` (ADR-121 amended-by/amends list)
- [x] T023 Update `researches/docker-importer-implementation-tracking.md` Phase 4 checkboxes (observation/status table, Source UI, tag suggestions) and `docs/roadmap.md` — mark `047-docker-source-health` under Shipped, revise **Next** (Wave E Swarm next)
- [x] T024 Full verification per AGENTS.md: `git diff --name-only main...HEAD` changed-package detection → per changed package `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus root `pnpm build`; confirm the backend OpenAPI contract test passes with the `instances` schema addition

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on T001; T003 can run parallel to
  T002/T004/T005 except shared files (`view-types.ts` touched by
  T003/T004/T005 — sequence those edits)
- **US1 (Phase 3)**: depends on Phase 1 only — pure importer change +
  backend test
- **US2 (Phase 4)**: importer part (T012) shares `mapping.ts` with US1 —
  sequence after T009; frontend part (T013) depends on T003
- **US3 (Phase 5)**: depends on T002/T005 (hooks + types)
- **US4 (Phase 6)**: depends on T004 (`details` plumbing)
- **US5 (Phase 7)**: depends on all behavior tasks (documents reality)
- **Polish (Phase 8)**: depends on all stories

### Parallel Opportunities

- T006 / T007 / T008 — different test files, can be written together
- T010 / T011 — importer vs frontend test files
- US3 (Phase 5) and US4 (Phase 6) are fully independent once Phase 2 lands
- T003 parallel with T002 and T005 (different files)

### Implementation Strategy

MVP = Phase 1 + Phase 3 (US1) — health-aware status alone fixes the
"misleading RUNNING" catalog defect. US2's observation render and US3's
Source UI are independent follow-on slices; US4 is the smallest and can
land any time after Phase 2.
