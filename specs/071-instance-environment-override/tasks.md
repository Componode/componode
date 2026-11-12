# Tasks: Manual environment override for ComponentInstances

**Input**: Design documents from `/specs/071-instance-environment-override/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/instance-environment-api.md, quickstart.md

**Tests**: REQUIRED — constitution VI + spec acceptance scenarios (backend integration, frontend unit, Playwright).

**Organization**: US1 (override + persistence, P1) is the MVP; US2 (provenance + reset UX, P2) layers visibility/reset on the same endpoint. Both share the foundational schema/serializer phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependencies)
- **[Story]**: US1–US2 map to spec.md user stories

---

## Phase 1: Setup

- [x] T001 Verify workspace: on branch `071-instance-environment-override`, `pnpm install` clean, backend test DB reachable

---

## Phase 2: Foundational — schema, contracts, serializer (blocks all stories)

- [x] T002 Create migration `packages/backend/src/db/migrations/031_instance_environment_override.ts`: `addColumn` `environmentOverride text NULL`, `environmentOverriddenBy uuid NULL`, `environmentOverriddenAt timestamptz NULL` on `component_instances`; CHECK `environmentOverride IS NULL OR environmentOverride IN (...)` built from core `ENVIRONMENTS` via the same `sql.join` pattern as `component_instances_environment_check` in `001_initial_schema.ts`; `down()` drops columns + constraint. No backfill, no index
- [x] T003 Update `packages/backend/src/db/types.ts`: add `environmentOverride: string | null`, `environmentOverriddenBy: string | null`, `environmentOverriddenAt: Date | null` (match existing timestamp column typing) to `ComponentInstanceRow`
- [x] T004 [P] Update `packages/core`: `contracts/component-instance.ts` — `ComponentInstance` gains `reportedEnvironment: Environment`, `environmentOverride: Environment | null`, `environmentOverriddenBy: string | null`, `environmentOverriddenAt: string | null` (`environment` stays the effective value); `schemas/components.ts` (or sibling schema file) — new `updateComponentInstanceSchema = z.object({ environment: z.enum(ENVIRONMENTS).nullable() })` with `additionalProperties: false` semantics matching house zod style; export from `packages/core/src/index.ts`
- [x] T005 [P] `packages/frontend/src/api/types.ts`: `ComponentInstance` gains the four contract fields (`reportedEnvironment`, `environmentOverride`, `environmentOverriddenBy`, `environmentOverriddenAt`)
- [x] T006 Create `toApiComponentInstance(row)` serializer in `packages/backend/src/services/component-instance-service.ts`: maps a `ComponentInstanceRow` to the API contract — `environment: row.environmentOverride ?? row.environment`, `reportedEnvironment: row.environment`, passthrough of override/by/at + all existing fields. Apply it at every instance-emitting boundary: `getComponentById` `instances[]` (`component-catalog-service.ts` ~L290), `createComponentInstance` response (`component-instance-service.ts`), composite `POST /components` `{instance}` (`component-group-service.ts` ~L669), and the component-relationships instance payloads (`component-relationship-service.ts` — verify whether it emits instance rows; map if so)

**Checkpoint**: schema + contracts compile; new serializer unit-covered; existing tests may fail where payload shape assertions are strict (expected red until US1/US2 land)

---

## Phase 3: User Story 1 — Override an instance's environment (P1) 🎯 MVP

**Goal**: `PATCH /component-instances/{id}` sets/clears the override under `component:update`; effective env persists across importer runs; audited.

**Independent Test**: override `OTHER`→`PRODUCTION`, re-run the import, effective stays `PRODUCTION` while reported refreshes — verifiable via API alone.

### Tests for User Story 1

- [x] T007 [US1] Failing integration tests in `packages/backend/test/integration/component-instance-environment.test.ts` (new file; reuse fixtures/helpers from `component-detail.test.ts` / `auto-component-groups.test.ts`): PATCH set → 200 + payload `environment=override`, `reportedEnvironment=<stored>`, `environmentOverride`, `environmentOverriddenBy=<actor>`, `environmentOverriddenAt`; `GET /components/{id}` instances[] shows same; invalid env value → 400; missing `environment` key → 400; unknown extra field → 400; unknown instance id → 404; VIEWER role → 403; `entity_changes` audit row written with environment transition
- [x] T008 [US1] Failing integration test (same file): override an instance, trigger the owning source's import run (reuse the run-trigger helpers from `auto-component-groups.test.ts`), assert stored `environment` column refreshed to the newly reported value while API `environment` (effective) remains the override and `reportedEnvironment` shows the new reported value

### Implementation for User Story 1

- [x] T009 [US1] `packages/backend/src/services/component-instance-service.ts`: `updateComponentInstanceEnvironment(instanceId, input, actor)` — parse via `updateComponentInstanceSchema`; transaction: load row (404 `NOT_FOUND` if absent — no component-lifecycle gate per spec edge case; GONE instances editable, visibility unchanged per FR-011); `environment` non-null → set override columns (`environmentOverride`, `environmentOverriddenBy=actor.id`, `environmentOverriddenAt=now`); `environment` null → clear all three; `writeEntityChange({entityType:"component_instance", action:"update", changes:{environment: newEffective, previousEnvironment: oldEffective, environmentOverride, reportedEnvironment}})`; return serialized instance via `toApiComponentInstance`
- [x] T010 [US1] New `packages/backend/src/routes/component-instances.ts`: `PATCH /:id` — `verifySession` + `requireRole("component:update")`, uuid param + `updateComponentInstanceSchema` body validation, `sendServiceError` mapping; register plugin in the Fastify server alongside `componentRoutes`/`urlCheckRoutes`
- [x] T011 [US1] `docs/openapi.yaml`: add `PATCH /component-instances/{id}` (x-permission `component:update`, request schema `{environment: enum|null}` required, 200/400/401/403/404 responses) + extend `ComponentInstance` schema with the four new fields; regenerate `docs/api.md` via `pnpm docs:api`
- [x] T012 [US1] Checkpoint: `pnpm --filter @componode/backend exec vitest run test/integration/component-instance-environment.test.ts` green; backend typecheck+lint clean

**Checkpoint**: US1 independently verifiable — override persists across a real import run via API.

---

## Phase 4: User Story 2 — See provenance and reset (P2)

**Goal**: overridden instances are visibly marked with reported value + actor provenance; one action resets to importer truth; full UI journey proven end-to-end.

**Independent Test**: override via UI → badge + reported value visible → reset → reported restored; verifiable in browser + Playwright.

### Tests for User Story 2

- [x] T013 [US2] Failing frontend unit tests in `packages/frontend/src/test/unit/component-detail.test.tsx` (or sibling): env edit affordance visible for EDITOR+, hidden for VIEWER; dialog lists all six `ENVIRONMENTS`; shows "Importer reported: X" when overridden; Save submits `{environment: <value>}`; Reset submits `{environment: null}`; override badge/indicator rendered on overridden rows only
- [x] T014 [US2] Backend integration additions (same `component-instance-environment.test.ts`): PATCH `environment:null` → override columns cleared, effective = reported; re-override after reset updates `environmentOverriddenBy`/`At`; `reportedEnvironment` keeps tracking importer writes while overridden (covered by T008 — assert explicitly here if not already)

### Implementation for User Story 2

- [x] T015 [US2] `packages/frontend/src/api/hooks/`: `useUpdateComponentInstance` mutation — `PATCH /component-instances/{id}`, invalidates the component detail query (follow `useUpdateComponentGroup` invalidation pattern in `api/hooks/component-groups.ts`)
- [x] T016 [US2] `packages/frontend/src/ux/components/catalog/component-detail.tsx`: environment cell — EDITOR+ (`useSession` + `canAccess(role,"EDITOR")`, same gate as list-page create buttons) gets edit affordance opening an "Edit environment" dialog; dialog shows current effective env, "Importer reported: X" line when overridden, Select of six `ENVIRONMENTS` (labels from `ENVIRONMENT_META` if exposed, else raw values), Save → mutate; "Reset to reported" secondary action when `environmentOverride != null` → mutate `{environment: null}`; overridden rows show a visual indicator (badge variant/dot) on the environment cell
- [x] T017 [P] [US2] `packages/frontend/src/ux/components/catalog/docker-details.tsx` (`InstanceDetails` expanded row): when `environmentOverride != null`, render "Importer reported: {reportedEnvironment}" (+ overridden-by if cheap) so provenance is visible without opening the dialog
- [x] T018 [US2] Playwright journey `playwright/tests/journeys/component-instances.spec.ts` (new, or extend existing component journey): seed/import a component with an instance → open detail → edit environment via dialog → assert badge + reported value → trigger the source's import run again → assert effective env still override via API → reset via UI → assert reported restored. Reuse `apiLogin`/`loginPage`/docker-mock scenario helpers from `app-auto-groups.spec.ts`
- [x] T019 [US2] Checkpoint: frontend unit suite green; `pnpm --filter @componode/frontend typecheck && lint` clean; Playwright spec green under `pnpm e2e`

**Checkpoint**: US2 independently verifiable — provenance visible, reset works, e2e proves persistence across a real import.

---

## Phase 5: Polish & cross-cutting

- [x] T020 [P] Docs: `docs/using-the-catalog.md` — document environment override semantics on the instances surface (effective vs reported, who can edit, reset); amend `researches/adrs/ADR-034-componentinstance-upsert-key.md` with the environment field-ownership split (reported column vs override columns); check `docs/roadmap.md` convention and add entry if prior specs did
- [x] T021 [P] `docs:oracle:check`, `docs:sidebar:check`, `docs:api:check` all green (no new error codes expected — verify)
- [x] T022 Full verification sweep: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` at root (or per-package equivalents); backend integration suite; frontend suite; targeted Playwright spec; `git status` clean except intended files
- [ ] T023 Commit spec artifacts + implementation on `071-instance-environment-override`; push; open PR per repo convention (do NOT include `.devin/sec-review/`)

---

## Dependencies

```
Phase 2 (schema/contracts/serializer) ──▶ Phase 3 US1 (endpoint+persistence) ──▶ Phase 4 US2 (provenance+reset UI) ──▶ Phase 5 polish
```

- US2 depends on US1's endpoint + payload fields (same PATCH serves set and reset).
- T006 serializer must land before T007's payload assertions.
- T018 Playwright depends on T016 UI + a working import path (T008 proves it earlier at API level).

## Parallel opportunities

- T004 ∥ T005 (core schema vs frontend types — different files)
- T017 ∥ T015/T016 (docker-details vs hooks/detail page)
- T020 ∥ T021 (docs prose vs generated checks)
- Within Phase 3: T007/T008 test files can be authored together; T009→T010 sequential (service then route)

## Implementation strategy

MVP = Phase 2 + Phase 3 (API-level override with import persistence). US2 adds the human-facing provenance/reset surface. Each phase ends at a checkpoint with tests green before the next begins.
