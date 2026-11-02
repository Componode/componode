# Tasks: URL Check Onboarding Completion

**Input**: Design documents from `specs/054-url-check-onboarding/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/http-api.md`

**Tests**: Required by the project constitution. Write each test task first, verify it fails for the intended reason, then implement the smallest passing change.

## Phase 1: Setup

- [x] T001 Confirm `054-url-check-onboarding` is the active branch and `.specify/feature.json` points to `specs/054-url-check-onboarding`
- [x] T002 Review `packages/frontend/src/ux/components/catalog/url-check-editor.tsx`, `packages/frontend/src/ux/components/forms/url-check-rows.tsx`, `packages/backend/src/routes/components.ts`, and `packages/backend/src/routes/url-checks.ts` and record the exact shared field/validation seams to reuse

## Phase 2: Foundational

- [x] T003 Add failing backend tests in `packages/backend/test/integration/components.test.ts` for `POST /api/v1/components/:id/instances`: 201 creates an instance + audit, 400 invalid body, 401 unauthenticated, 403 Viewer, 404 missing/RETIRED Component, and 409 when an instance already exists
- [x] T004 Add failing frontend tests in `packages/frontend/src/test/unit/url-checks.test.tsx` covering the zero-instance URL Checks empty state/action and successful refresh into normal Add check behavior
- [x] T005 Implement `createComponentInstance` in `packages/backend/src/services/component-instance-service.ts`: ACTIVE parent only, zero-existing-instance guard, UUID v7, `externalId=manual:<component-slug>`, unique slug via existing slug helper, `RUNNING`, and transactional `component_instance` audit event
- [x] T006 Register `POST /api/v1/components/:id/instances` in `packages/backend/src/routes/components.ts` with session verification, `component:update`, strict `createInstanceBlockSchema`, `{instance}` response, and `sendServiceError` mapping
- [x] T007 Add `useCreateComponentInstance` in `packages/frontend/src/api/hooks/components.ts` with POST `/components/:id/instances` and component-detail invalidation
- [x] T008 Implement `packages/frontend/src/ux/components/catalog/component-instance-create-dialog.tsx` using the existing dialog/form patterns and fields allowed by `createInstanceBlockSchema`
- [x] T009 Wire the zero-instance path in `packages/frontend/src/ux/components/catalog/url-checks-card.tsx`: Editor+ sees an Add first instance action, success refreshes detail, and `UrlCheckEditor` becomes available without creating a duplicate Component

**Checkpoint**: Existing zero-instance Component recovery is independently functional and covered by tests.

## Phase 3: User Story 1 - Configure a complete first URL Check (Priority: P2)

**Goal**: The composite new-Component flow supports the same applicable URL Check fields as the regular editor.

**Independent Test**: Create an API-category Component with authenticated and targeted checks; repeat with a non-API Component and confirm auth controls are absent.

- [x] T010 [P] [US1] Add failing backend integration coverage in `packages/backend/test/integration/url-checks.test.ts` for composite create carrying `authMode`, `credentialId`, `authConfig`, `availabilityTarget`, `targetWindow`, and atomic rollback on invalid check data
- [x] T011 [P] [US1] Add failing frontend tests in `packages/frontend/src/test/unit/url-checks.test.tsx` asserting API-category rows offer authentication and target/window controls, submit the complete payload, and non-API rows hide authentication
- [x] T012 [US1] Extract the authentication selector fields from `packages/frontend/src/ux/components/catalog/url-check-editor.tsx` into reusable `packages/frontend/src/ux/components/catalog/url-check-auth-fields.tsx`
- [x] T013 [US1] Extract or add shared URL Check auth/target validation and payload helpers in `packages/frontend/src/api/mappers/monitoring.ts` so edit and create rows use identical rules
- [x] T014 [US1] Extend `packages/frontend/src/ux/components/forms/url-check-rows.tsx` with per-row authentication, Credential, authConfig key, availability target, and target window fields; hide auth controls for non-API Components
- [x] T015 [US1] Update `packages/frontend/src/ux/app/components/new.tsx` to submit each row's `authMode`, `credentialId`, `authConfig`, `availabilityTarget`, and `targetWindow` and to fail validation when a selected auth configuration is unavailable or incomplete
- [x] T016 [US1] Refactor `packages/frontend/src/ux/components/catalog/url-check-editor.tsx` to consume the shared auth/validation code without behavior regression

**Checkpoint**: The composite flow has field/validation parity for applicable URL Check fields.

## Phase 4: User Story 2 - Start checks on an existing Component with no instances (Priority: P2)

**Goal**: A supported two-step recovery path saves the first ComponentInstance on an existing Component, then uses the regular URL Check editor.

**Independent Test**: From a zero-instance Component detail page, save the first instance, create a check normally, and confirm only one Component exists.

- [x] T017 [US2] Verify `POST /api/v1/components/:id/instances` behavior against acceptance scenarios in `packages/backend/test/integration/components.test.ts`, including that a valid first instance remains after a later check-validation failure
- [x] T018 [US2] Ensure `packages/frontend/src/ux/components/catalog/url-checks-card.tsx` guides the user from zero instances to first-instance creation and then normal check creation, with actionable server errors
- [x] T019 [US2] Add any missing frontend coverage in `packages/frontend/src/test/unit/url-checks.test.tsx` for invalid instance input, retired/unavailable Component guidance, and no duplicate-Component navigation

**Checkpoint**: The existing-Component dead end is closed without broadening this into general instance CRUD.

## Phase 5: User Story 3 - Understand role requirements before configuring checks (Priority: P2)

**Goal**: Ordinary check/Hub setup remains EDITOR; Credential and Import Agent selection is enforced as ADMIN.

**Independent Test**: Exercise Viewer, Editor, and Admin across UI and crafted API writes.

- [x] T020 [P] [US3] Add failing backend tests in `packages/backend/test/integration/url-checks.test.ts` proving non-null `credentialId` requires `credential:read`, `vantage=AGENT`/non-null `agentId` requires `agent:read`, removal/switch-to-Hub remains allowed, and unauthorized writes persist nothing
- [x] T021 [P] [US3] Add failing backend tests in `packages/backend/test/integration/components.test.ts` proving the composite `POST /components` path enforces the same Credential and Agent guards before creating any records
- [x] T022 [US3] Add shared request-level guards in `packages/backend/src/routes/url-checks.ts` and `packages/backend/src/routes/components.ts` using `hasPermission`; for monitoring-setup PATCH/PUT evaluate the effective setup after the patch
- [x] T023 [US3] Update frontend role guidance in `packages/frontend/src/ux/components/catalog/url-check-editor.tsx`, `packages/frontend/src/ux/components/catalog/monitoring-setup-editor.tsx`, and `packages/frontend/src/ux/app/components/new.tsx` so unavailable selectors state that Admin access is required and cannot silently downgrade the requested configuration
- [x] T024 [US3] Add/extend frontend role tests in `packages/frontend/src/test/unit/url-checks.test.tsx` for Viewer read-only behavior, Editor ordinary/Hub actions, Admin-only selector explanations, and no secret-value display

**Checkpoint**: Role requirements are consistent across both creation surfaces and enforced server-side.

## Phase 6: Contracts, ADR, and Documentation

- [x] T025 Add `POST /components/{id}/instances` to `docs/openapi.yaml` including `component:update`, request schema, 201/400/401/403/404/409 responses, and generated documentation fields
- [x] T026 Run `pnpm --filter @componode/backend docs:api` to regenerate `docs/api.md` and confirm `pnpm --filter @componode/backend docs:api:check` passes
- [x] T027 Create `researches/adrs/ADR-125-url-check-onboarding-recovery.md` ratifying the first-instance endpoint and Credential/Agent selector boundaries, add `Amended by ADR-125` back-pointers to `researches/adrs/ADR-054-rbac-permission-matrix.md`, `researches/adrs/ADR-123-http-url-check-monitoring.md`, and `researches/adrs/ADR-124-url-check-execution-surfaces.md`, and update `researches/architecture-decisions.md`
- [x] T028 Update `docs/url-checks.md`, `docs/using-the-catalog.md`, and any affected sidebar/index content so users can discover the composite flow, zero-instance recovery, and role split
- [x] T029 Update `docs/roadmap.md` to mark `054-url-check-onboarding` shipped and revise the `Next` entry
- [x] T030 Run Prettier over changed Markdown/TypeScript files and `git diff --check`

## Dependencies & Execution Order

- Phase 2 blocks all user stories: the first-instance API/UX seam must exist before zero-instance tests can pass.
- US1 depends on the shared URL Check form seam.
- US2 depends on Phase 2.
- US3 depends on Phase 2 and US1 because composite payload checks must be in place before role guards are fully tested.
- Phase 6 depends on all implementation phases.

## Parallel Opportunities

- T010 and T011 can be written in parallel.
- T020 and T021 can be written in parallel.
- Backend route/service work and frontend form extraction can proceed in parallel after their failing tests are established.

## Implementation Strategy

1. Establish the first-instance backend seam and frontend recovery flow (T003-T009).
2. Bring composite check fields to parity with the regular editor (T010-T016).
3. Prove and preserve the two-step zero-instance behavior (T017-T019).
4. Enforce the role boundary across API and UI (T020-T024).
5. Ratify the contract and ship documentation (T025-T030).

## Phase 7: Review

- [x] T031 [code-review: spec, code-review: standards] Evaluate the effective credential/auth state on `PATCH /url-checks/:id` so unchanged Admin-selected credentials can be preserved by Editors while credential selection, auth-mode changes, or auth-config changes require `credential:read`; add integration coverage for preserve-vs-reconfigure behavior

- [x] T032 [code-review: spec] Apply preserve-vs-change semantics to `PUT /components/:id/monitoring-setup`: Editors may preserve an existing AGENT vantage while changing unrelated fields, but switching to AGENT or changing `agentId` requires `agent:read`
- [x] T033 [code-review: standards] Add `minLength: 1` to the first-instance `url` field in `docs/openapi.yaml`, regenerate `docs/api.md`, and correct unavailable-credential guidance so it does not claim existing auth is removed
- [x] T034 [code-review: standards] Add focused frontend coverage for first-instance submission and composite authentication/target rows

- [x] T035 [code-review: spec] Add unauthenticated 401 and nonexistent-Component 404 coverage for the first-instance endpoint; hide the recovery action on non-ACTIVE Components
- [x] T036 [code-review: spec] Add composite-submit coverage proving API auth, availability target/window, and enabled values are sent, plus an incomplete-auth rejection path
- [x] T037 [code-review: spec] Add Admin-required selector guidance and no-secret-display coverage; align copy with create-vs-edit behavior
- [x] T038 [code-review: standards] Align ADR-125 and URL Check docs with preserve-vs-change semantics for Credential and Import Agent selections

- [x] T039 [code-review: spec] Reject non-null credential/auth-config submissions on `NONE` checks before service, and require mode-matched non-null `authConfig` for authenticated checks
- [x] T040 [code-review: spec] Keep `NONE` selectable when credential metadata is unavailable and gate first-instance recovery on the backend-visible total instance count
- [x] T041 [code-review: spec] Require `EDITOR` on the composite new-Component route
- [x] T042 [code-review: standards] Align spec contract/data-model wording with preserve-vs-change authorization semantics
