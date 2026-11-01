# Tasks: Docker Hub execution and managed targets

**Input**: Design documents from `/specs/049-docker-hub-execution/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/docker-targets-api.md`

## Phase 1: Setup

- [x] T001 Add failing core contract/schema tests for Docker target, `cancelReason`, `targetProfileSchema`, and new error codes in `packages/core/test/`
- [x] T002 Add failing backend integration tests for target CRUD/lifecycle/test routes in `packages/backend/test/integration/docker-targets.test.ts`
- [x] T003 Add failing backend integration tests for Hub Docker config/run/credential target resolution in `packages/backend/test/integration/docker-hub-execution.test.ts`
- [x] T004 Add failing frontend tests for Docker target manager, Hub picker, executor switching, and cancel reason in `packages/frontend/src/test/unit/`

## Phase 2: Foundational

- [x] T005 Add `CANCEL_REASONS`, `TARGET_NOT_FOUND`, `TARGET_DISABLED`, and `TARGET_IN_USE` contracts plus optional `cancelReason` in `packages/core/src/`
- [x] T006 Add Docker target request/response/profile schemas and manifest `targetProfileSchema` typing in `packages/core/src/schemas/docker-target.ts` and `packages/core/src/importer-registry.ts`
- [x] T007 Export Docker target-profile schema from `packages/importer-docker/src/manifest.ts` and `packages/importer-docker/src/index.ts`; remove `requiresAgent` and update description/comments
- [x] T008 Create migration `packages/backend/src/db/migrations/024_docker_hub_targets.ts` for `docker_targets` and `import_runs.cancelReason`, updating `packages/backend/src/db/types.ts`
- [x] T009 Add `importer:target:read|create|update|delete|test` ADMIN permissions in `packages/backend/src/plugins/rbac.ts`

## Phase 3: US1 — Import Docker inventory through the Hub (P1)

**Goal**: A Hub-bound Docker config resolves a managed target and imports the full Docker inventory.

**Independent Test**: create enabled target + Hub config, run it, and verify Docker assets/Source without an Agent.

- [x] T010 Implement `docker-target-service.ts` row mapping, list/get/create/update/read validation, audit writes, and `docker_target` feed-name resolution in `packages/backend/src/services/`
- [x] T011 Implement Hub target preflight helpers in `packages/backend/src/services/docker-target-service.ts`: resolve enabled target by selector, return validated profile, classify `TARGET_NOT_FOUND`/`TARGET_DISABLED`/`TARGET_RESOLUTION_FAILED`
- [x] T012 Wire Hub `resolveTarget` in `packages/backend/src/services/import-run-service.ts` so Docker runs preflight the target before importer execution
- [x] T013 Add Hub Docker config save validation in `packages/backend/src/services/importer-config-service.ts`: active target plus `*Key` coverage from linked `STORED` credentials only
- [x] T014 Update Hub credential testing in `packages/backend/src/services/credential-service.ts` to resolve/pass target profiles for `targetRefKey` manifests
- [x] T015 Preserve Agent behavior and add regression assertions in `packages/backend/test/integration/config-agent-binding.test.ts` and `packages/agent/test/executor.test.ts`

## Phase 4: US2 — Administer Hub Docker targets safely (P1)

**Goal**: ADMINs can manage, test, enable/disable, and delete Docker targets.

**Independent Test**: create/edit/test/disable/enable/delete a target and verify validation, references, and responses.

- [x] T016 Implement target mutation/lifecycle/delete/test functions in `packages/backend/src/services/docker-target-service.ts`, including `/version`-only test via selected Hub config credentials
- [x] T017 Implement routes in `packages/backend/src/routes/docker-targets.ts` and register them in `packages/backend/src/app.ts` per `contracts/docker-targets-api.md`
- [x] T018 Add frontend Docker target API types/hooks in `packages/frontend/src/api/types.ts` and `packages/frontend/src/api/hooks/docker-targets.ts`
- [x] T019 Implement target list/create/edit/detail/test UI in `packages/frontend/src/ux/app/docker-targets/` and `packages/frontend/src/ux/components/admin/`
- [x] T020 Add ADMIN navigation and routes for `/docker-targets*` in `packages/frontend/src/ux/lib/nav.ts` and `packages/frontend/src/routes.tsx`

## Phase 5: US3 — Select and change executors without ambiguity (P1)

**Goal**: Docker configs use the correct target UX for Hub vs Agent and cannot carry stale selections across executors.

**Independent Test**: create/switch Docker configs and verify defaults, picker/text field, clearing, and disabled-target behavior.

- [x] T021 Update `packages/frontend/src/ux/components/importers/importer-form.tsx` to use a Hub target picker for Docker, retain Agent free-text `targetId`, and clear target+credentials on executor changes
- [x] T022 Update form data loading/tests so disabled targets remain visible but cannot be selected in `packages/frontend/src/test/unit/importer-form-scope.test.tsx`
- [x] T023 Enforce disabled-target assignment/unrelated-edit semantics for Hub Docker configs in `packages/backend/src/services/importer-config-service.ts`

## Phase 6: US4 — Revoke access and understand what happened (P2)

**Goal**: Disablement blocks new work, requests cancellation, and exposes neutral reasons/audit.

**Independent Test**: disable a target during active/pending work and inspect run history, test result, and Activity feed.

- [x] T024 Add `cancelRun(runId, reason)` and preserve `USER_REQUESTED` manual cancellation in `packages/backend/src/services/import-run-service.ts`
- [x] T025 Request cancellation of active Hub runs/tests from target disable in `packages/backend/src/services/docker-target-service.ts`
- [x] T026 Expose `cancelReason` in run API mapping and render neutral reason text in `packages/frontend/src/api/mappers/operations.ts`, `packages/frontend/src/ux/lib/view-types.ts`, and `packages/frontend/src/ux/components/importers/run-detail.tsx`
- [x] T027 Audit target tested/create/update/enable/disable/delete actions with non-secret route details and ensure Activity names resolve in `packages/backend/src/services/audit-query-service.ts`

## Phase 7: US5 — Contracts and operator guidance (P3)

**Goal**: Public API, docs, and ADRs accurately describe the feature.

**Independent Test**: OpenAPI route/permission/error coverage, importer/deployment docs, and ADR index/back-pointers match implementation.

- [x] T028 Update `docs/openapi.yaml` for target routes, schemas, permissions, errors, and `ImportRun.cancelReason`; regenerate `docs/api.md`
- [x] T029 Update `docs/importers/docker.md` and `docs/deployment.md` for Hub targets, credentials, transports, optional socket/context provisioning, and unchanged Agent registry
- [x] T030 Add `researches/adrs/ADR-122-docker-hub-execution.md`, amend/back-pointer affected ADRs, and update `researches/architecture-decisions.md`
- [x] T031 Update `docs/roadmap.md` shipped/next entries after implementation and reviews are green

## Phase 8: Polish & verification

- [x] T032 Run changed-package lint/typecheck/test/build and fix all findings
- [x] T033 Run API-docs contract, audit coverage/names, source reconciliation, Docker importer, Agent executor, and frontend importer form suites
- [x] T034 Review security: no secrets in profiles/API/audit/logs, no default socket mount, no insecure transport bypass
- [x] T035 Run `speckit-converge`, code review, final converge, and ship PR

## Dependencies

- Foundation T001–T009 blocks all story work.
- US1 T010–T015 blocks reliable target use by US2–US4.
- US2 API/service work may proceed in parallel with US1 once T005–T009 exist, but UI picker depends on target list API.
- US3 depends on T018.
- US4 depends on T010–T017.
- US5 depends on implementation contracts settling.

## Implementation Strategy

Deliver in task order. Keep each commit/test slice narrow, but do not ship a target UI without Hub execution or Hub execution without lifecycle/audit. MVP for local verification is T001–T017; the feature is incomplete until US3–US5 and verification phases pass.

## Phase 9: Convergence

- [x] T036 Fix `packages/backend/test/integration/docker-import.test.ts`: seed a `docker_targets` row and add `targetProfileSchema` to the mocked docker manifest so Hub-bound docker configs resolve their target (partial per US1/T003)
- [x] T037 Update `packages/backend/test/integration/config-agent-binding.test.ts`: docker is no longer `requiresAgent` — rewrite assertions for Hub binding with valid/unknown/disabled targets (contradicts per US3/T015)
- [x] T038 Add `packages/backend/test/integration/docker-targets.test.ts` covering target CRUD, enable/disable, test, and in-use delete per T002 (missing per US2)
- [x] T039 Map run/test-time malformed or missing profile resolution to `TARGET_RESOLUTION_FAILED` instead of `VALIDATION_FAILED` in `packages/backend/src/services/docker-target-service.ts` and `import-run-service.ts` (partial per US1)
- [x] T040 Add frontend coverage for the Hub Docker target picker and disabled-target visibility in `packages/frontend/src/test/unit/` (missing per T022/US3)
- [x] T041 Extend audit coverage/name tests for `docker_target` entity events in `packages/backend/test/integration/` (partial per T027)

## Phase 10: Review

- [x] T042 Fix createDockerTarget reading via global db inside its own transaction in packages/backend/src/services/docker-target-service.ts (code-review: standards)
- [x] T043 Return 409 CONFLICT on duplicate targetId instead of a 500 in packages/backend/src/services/docker-target-service.ts (code-review: spec)
- [x] T044 Only run assertHubDockerConfig when the scope's targetId changes or the config newly binds to Hub, so unrelated edits on disabled-target configs succeed per FR-018 in packages/backend/src/services/importer-config-service.ts (code-review: spec)
- [x] T045 Skip no-op enable/disable/empty-PATCH audit rows in packages/backend/src/services/docker-target-service.ts (code-review: spec)
