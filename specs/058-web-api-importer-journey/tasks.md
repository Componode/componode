# Tasks: Web/API importer profiles and managed URL Checks

**Input**: Design documents from `/specs/058-web-api-importer-journey/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: Required by Constitution Principle VI. Write each test first,
verify it fails for the intended reason, then implement the smallest passing
change.

## Phase 1: Setup

**Purpose**: Confirm the implementation branch and current contract surfaces.

- [ ] T001 Confirm the `058-web-api-importer-journey` branch and
      `.specify/feature.json` point to
      `specs/058-web-api-importer-journey/spec.md`
- [ ] T002 Review importer config, Source reconciliation, URL Check, and
      monitoring setup contracts in
      `packages/core/src/contracts/importer-config.ts`,
      `packages/backend/src/services/importer-source-service.ts`,
      `packages/backend/src/services/import-run-service.ts`, and
      `packages/backend/src/services/url-check-service.ts`

## Phase 2: Foundational

**Purpose**: Establish failing coverage for identity, ownership, and the
cross-domain write contract before implementation.

- [ ] T003 Add failing backend integration coverage in
      `packages/backend/test/integration/importer-sources.test.ts` for generated
      collection Source identity, stable-key reattachment, and one-config/one-
      Source binding
- [ ] T004 Add failing backend integration coverage in
      `packages/backend/test/integration/import-runs.test.ts` for profile-level
      asset upsert, per-Source instance membership, and no `PARTIAL` run status
- [ ] T005 Add failing backend integration coverage in
      `packages/backend/test/integration/url-checks-monitoring.test.ts` for
      managed-key upsert, shared Source ownership, conflicting definitions, and
      configured-enabled owner union
- [ ] T006 Add failing backend integration coverage in
      `packages/backend/test/integration/url-checks-monitoring.test.ts` for
      direct URL Check write rejection and `POST /components` monitoring-block
      rejection while ordinary Component/instance creation remains valid
- [ ] T007 Add failing migration coverage in
      `packages/backend/test/integration/migrations.test.ts` for one-to-one v1
      config migration, Source rekey preserving the Source row, matching-check
      history preservation, and disabled legacy check retention

**Checkpoint**: Tests define the identity, Source ownership, migration, and
deprecated-write contracts before the collection form or runtime sync is
changed.

## Phase 3: User Story 1 — Configure a collection (Priority: P1)

**Goal**: Configure multiple stable Component profiles and ComponentInstances
in one Web/API ImporterConfig.

**Independent Test**: Create a config with two profiles and multiple
instances; verify field validation, generated stable keys, and correct
profile/instance summary.

### Tests for User Story 1

- [ ] T008 [P] [US1] Add failing Web URL scope-schema tests in
      `packages/importer-web-url/test/importer.test.ts` for multiple profiles,
      multiple instances, stable keys, URL safety per row, and strict unknown-
      field rejection
- [ ] T009 [P] [US1] Add failing API URL scope-schema tests in
      `packages/importer-api-url/test/importer.test.ts` for multiple profiles,
      multiple instances, API-only authentication, URL safety per row, and
      strict unknown-field rejection
- [ ] T010 [P] [US1] Add failing importer form tests in
      `packages/frontend/src/test/unit/importer-form-scope.test.tsx` for profile
      and instance add/remove, stable keys, host-suggested editable names,
      row-level errors, and review counts
- [ ] T011 [US1] Add failing coverage in
      `packages/frontend/src/test/unit/importer-form-scope.test.tsx` proving Web
      URL hides authentication controls and API URL shows Credential-backed
      controls without secret values

### Implementation for User Story 1

- [ ] T012 [P] [US1] Define the v2 profile/instance/check scope schema and
      public types in `packages/core/src/schemas/importer-config.ts` and
      `packages/core/src/contracts/importer-config.ts`
- [ ] T013 [P] [US1] Extend Web URL importer config validation in
      `packages/importer-web-url/src/config.ts` with stable profile/instance
      keys, environment/URL fields, and one managed check definition per instance
- [ ] T014 [P] [US1] Extend API URL importer config validation in
      `packages/importer-api-url/src/config.ts` with stable profile/instance
      keys, environment/URL fields, and API-category check authentication
- [ ] T015 [US1] Update the shared ImporterConfig form in
      `packages/frontend/src/ux/components/importers/importer-form.tsx` with the
      scoped nested profile/instance builder, host-derived name suggestion,
      check controls, validation, review summary, and keyboard operations
- [ ] T016 [US1] Update `packages/core/src/importer-registry.ts` manifests and
      `packages/importer-web-url/src/manifest.ts` /
      `packages/importer-api-url/src/manifest.ts` for the v2 scope contract
- [ ] T017 [US1] Update scope mapping/view types in
      `packages/frontend/src/api/types.ts` and
      `packages/frontend/src/ux/lib/view-types.ts` for profile, instance, and
      managed-check rows

**Checkpoint**: An administrator can save and review a collection without
URL or identity errors being assigned to the wrong profile/instance.

## Phase 4: User Story 2 — Run and reconcile the configured inventory (Priority: P1)

**Goal**: Produce one catalog Component per profile and the complete set of
configured ComponentInstances with source-scoped reconciliation.

**Independent Test**: Run a multi-profile config with reachable and failing
endpoints; verify one asset per profile, `ERROR` on failed instances, and
`COMPLETED` only after every configured row was evaluated.

### Tests for User Story 2

- [ ] T018 [P] [US2] Add failing Web URL importer tests in
      `packages/importer-web-url/test/importer.test.ts` for one asset per
      profile, multiple instances per asset, Source identity before the first
      yield (including empty inventory), per-row fetch failure handling, and
      `validateDiscoveredAsset` on every yield
- [ ] T019 [P] [US2] Add failing API URL importer tests in
      `packages/importer-api-url/test/importer.test.ts` for one asset per
      profile, multiple instances per asset, per-row fetch failure handling,
      Source identity before the first yield (including empty inventory), API
      response detail behavior, and `validateDiscoveredAsset` on every yield
- [ ] T020 [P] [US2] Add failing integration tests in
      `packages/backend/test/integration/import-runs.test.ts` for Source-scoped
      Component/instance membership reconciliation, completed-run absence
      handling, and fatal/incomplete-run no-reconcile behavior
- [ ] T021 [US2] Add failing integration tests in
      `packages/backend/test/integration/import-runs.test.ts` proving importer
      status seeds a new instance but cannot overwrite status after the first
      managed URL Check observation

### Implementation for User Story 2

- [ ] T022 [US2] Update `packages/importer-web-url/src/importer.ts` to report
      the stable collection Source key before yielding and emit one validated
      `DiscoveredAsset` per profile with all configured instances
- [ ] T023 [US2] Update `packages/importer-api-url/src/importer.ts` to report
      the stable collection Source key before yielding and emit one validated
      `DiscoveredAsset` per profile with all configured instances
- [ ] T024 [US2] Update core upsert identity mapping in
      `packages/backend/src/services/import-run-service.ts` so stable profile
      and instance keys preserve Component/ComponentInstance IDs across name,
      URL, and environment edits
- [ ] T025 [US2] Add core-managed profile/check synchronization in
      `packages/backend/src/services/import-run-service.ts` without adding
      check persistence to `DiscoveredAsset` or importer packages
- [ ] T026 [US2] Preserve per-asset commits and Source-scoped completion
      reconciliation in `packages/backend/src/services/import-run-service.ts`;
      continue after endpoint-level errors but keep fatal run failures
      non-reconciling
- [ ] T027 [US2] Update the Source identity adapter in
      `packages/backend/src/services/importer-source-service.ts` to register,
      reattach, and label generated collection Sources without using mutable
      names or URL-set identities

**Checkpoint**: A complete run preserves all configured inventory and only
reconciles memberships absent from that completed Source snapshot.

## Phase 5: User Story 3 — Manage and understand URL Checks (Priority: P1)

**Goal**: Synchronize one managed URL Check per imported instance, display
its status/history read-only in Component detail, and make its outcomes
authoritative for monitored ComponentInstance status after the first
observation.

**Independent Test**: Run importer discovery, record Check observations,
and verify URL Check status mapping, Product health, source ownership, and
config enable/disable behavior.

### Tests for User Story 3

- [ ] T028 [P] [US3] Add failing backend integration tests in
      `packages/backend/test/integration/url-checks-monitoring.test.ts` for
      managed-key synchronization, shared check definitions across Sources,
      definition conflict rejection, and enabled-owner union behavior
- [ ] T029 [P] [US3] Add failing backend integration tests in
      `packages/backend/test/integration/url-checks-monitoring.test.ts` for
      `SUCCESS`→`RUNNING`, `FAILURE`→`ERROR`, `MISSED`/no-data preservation,
      importer-after-check precedence, `GONE` protection, transition audit,
      and the resulting ADR-112 Product health status
- [ ] T030 [P] [US3] Add failing integration coverage in
      `packages/backend/test/integration/url-checks-failure-policy.test.ts`
      proving ordinary importer runs preserve auto-disable and explicit config
      re-enable resets streak/marker only for configured-enabled checks
- [ ] T031 [P] [US3] Add failing frontend tests in
      `packages/frontend/src/test/unit/url-checks.test.tsx` for read-only
      managed/legacy check rows, Importer navigation, status mapping, and
      continued Component monitoring-setup controls
- [ ] T032 [US3] Add failing API contract coverage in
      `packages/backend/test/integration/url-checks.test.ts` for HTTP 410
      `URL_CHECK_WRITE_DEPRECATED` on direct Check writes and the manual
      Component-create monitoring payload; retain read paths and assert
      Credential values never enter Check responses, observations, or audits

### Implementation for User Story 3

- [ ] T033 [US3] Add a nullable managed check key to `url_checks` and a
      typed `source_url_check_memberships` table in
      `packages/backend/src/db/migrations/028_web_api_managed_checks.ts`
- [ ] T034 [US3] Add Kysely row types for managed URL Check keys and
      Source-to-check memberships in `packages/backend/src/db/types.ts`
- [ ] T035 [US3] Implement idempotent source-owned check upsert, shared-key
      conflict validation, enable-owner union, pause/re-enable, and GONE cleanup
      in `packages/backend/src/services/url-check-service.ts`
- [ ] T036 [US3] Update the observation finalization path in
      `packages/backend/src/services/probe-dispatcher.ts` and
      `packages/backend/src/services/url-check-scheduler.ts` to update
      ComponentInstance status only on SUCCESS/FAILURE transitions, preserve
      MISSED/no-data/disabled state, protect GONE/RETIRED, and audit transitions
- [ ] T037 [US3] Batch-read managed observation state in
      `packages/backend/src/services/import-run-service.ts` so later importer
      results cannot overwrite a ComponentInstance after its first Check
      observation without introducing per-row query fan-out
- [ ] T038 [US3] Update the URL Checks card in
      `packages/frontend/src/ux/components/catalog/url-checks-card.tsx` and
      `packages/frontend/src/ux/components/catalog/component-detail.tsx` to show
      managed/legacy Check data read-only and link managed edits to Importer UI
- [ ] T039 [US3] Update Importer detail and edit views in
      `packages/frontend/src/ux/components/importers/importer-detail.tsx` and
      `packages/frontend/src/ux/components/importers/importer-form.tsx` to group
      profiles, instances, status, Check summaries, and settings
- [ ] T040 [US3] Retire the manual Check block from
      `packages/frontend/src/ux/app/components/new.tsx`,
      `packages/core/src/schemas/components.ts`, and
      `packages/backend/src/services/component-group-service.ts` while
      preserving ordinary manual Component/Instance creation
- [ ] T041 [US3] Return the controlled 410 error from deprecated Check write
      handlers in `packages/backend/src/routes/url-checks.ts` and
      `packages/backend/src/routes/components.ts`; preserve `GET` routes and
      `PUT /components/:componentId/monitoring-setup`
- [ ] T042 [US3] Add the controlled `URL_CHECK_WRITE_DEPRECATED` code to
      `packages/core/src/constants/error-codes.ts` and
      `packages/core/src/constants/error-types.ts`

**Checkpoint**: Managed Check definitions have one canonical write path;
observations and instance status remain auditable and source-safe.

## Phase 6: User Story 4 — Migrate existing configs and checks (Priority: P1)

**Goal**: Convert existing one-URL configs without losing durable identities,
Source history, or unambiguous Check observations.

**Independent Test**: Upgrade a fixture with a single URL config, Component,
instance, Source, and matching Check; verify their internal IDs and history
are unchanged after the first v2 run.

### Tests for User Story 4

- [ ] T043 [P] [US4] Add migration fixtures in
      `packages/backend/test/integration/migrations.test.ts` for singleton
      profile conversion, generated Source key, preserved Source row/run/
      membership IDs, and idempotent rerun
- [ ] T044 [P] [US4] Add migration cases in
      `packages/backend/test/integration/migrations.test.ts` for a unique URL
      Check match, no match, multiple matching checks, and extra legacy checks
      retained disabled with observations
- [ ] T045 [US4] Add frontend migration-display tests in
      `packages/frontend/src/test/unit/importer-form-scope.test.tsx` proving
      migrated host-suggested names are editable and stable keys survive reload

### Implementation for User Story 4

- [ ] T046 [US4] Add the idempotent one-to-one JSON scope migration and
      Source identity rekey in
      `packages/backend/src/db/migrations/028_web_api_managed_checks.ts`
- [ ] T047 [US4] Seed stable profile/instance keys from existing external
      identities and preserve Component/Instance slugs in
      `packages/backend/src/services/import-run-service.ts`
- [ ] T048 [US4] Adopt the unique instance-URL-matching Check row into the
      managed key without changing its URL Check ID or observations in
      `packages/backend/src/services/url-check-service.ts`
- [ ] T049 [US4] Disable and retain unmatched/extra legacy Checks and
      surface migration conflicts in `packages/backend/src/services/url-check-service.ts`
- [ ] T050 [US4] Add Source reattachment selection for unmonitored Sources
      to `packages/frontend/src/ux/components/importers/importer-form.tsx` and
      `packages/frontend/src/api/hooks/importers.ts`

**Checkpoint**: Existing one-URL configs migrate independently; no Source,
Component, instance, run, or unambiguous Check history is merged or lost.

## Phase 7: User Story 5 — Pause, reattach, and retire safely (Priority: P1)

**Goal**: Apply config enablement, Source membership, and check cleanup rules
without unintended status changes or observation deletion.

**Independent Test**: Disable/re-enable a config, remove an endpoint while
shared, then remove its final effective Source membership; verify pauses,
streak resets, retention, and cleanup.

### Tests for User Story 5

- [ ] T051 [P] [US5] Add failing backend lifecycle tests in
      `packages/backend/test/integration/importer-sources.test.ts` for
      config deletion, Source `UNMONITORED`, same-Source reattachment, and
      preservation of Source/run history
- [ ] T052 [P] [US5] Add failing URL Check cleanup tests in
      `packages/backend/test/integration/url-checks-monitoring.test.ts` for
      shared effective memberships, check retention, GONE cleanup, and
      observation cascade only after the final membership disappears
- [ ] T053 [US5] Add frontend tests in
      `packages/frontend/src/test/unit/importer-form-scope.test.tsx` for
      disabled-config messaging, enable-transition reactivation, and
      configured-disabled check preservation

### Implementation for User Story 5

- [ ] T054 [US5] Synchronize Source-owned check pause/enable state on
      ImporterConfig disable, enable, and delete in
      `packages/backend/src/services/importer-config-service.ts` and
      `packages/backend/src/services/importer-source-service.ts`
- [ ] T055 [US5] Deactivate absent check memberships only after a completed
      Source run and delete managed Check history only when the instance is GONE
      with no effective Source membership in
      `packages/backend/src/services/import-run-service.ts`
- [ ] T056 [US5] Preserve auto-disabled state during ordinary synchronization
      and clear it only on explicit ImporterConfig re-enable in
      `packages/backend/src/services/url-check-service.ts`

**Checkpoint**: Config lifecycle and Source sharing cannot stop or delete a
Check still owned by another effective Source.

## Phase 8: API, UX, documentation, and observability

- [ ] T057 Update the canonical API contract in `docs/openapi.yaml` for
      deprecated URL Check writes, the manual Component monitoring rejection,
      importer config scope responses, and any changed read payloads
- [ ] T058 Regenerate `docs/api.md` with
      `pnpm --filter @componode/backend docs:api` and verify
      `pnpm --filter @componode/backend docs:api:check`
- [ ] T059 Update Web/API setup guides in `docs/importers/web-url.md` and
      `docs/importers/api-url.md`, and update monitoring/status language in
      `docs/url-checks.md` and `docs/using-the-catalog.md`
- [ ] T060 Verify the ratified UX/domain wording in `docs/ux.md` and
      `CONTEXT.md` matches the shipped nested importer builder, check-editing
      boundary, and ComponentInstance status semantics
- [ ] T061 Verify ADR-126 and its amendments/back-pointers remain consistent in
      `researches/adrs/ADR-126-web-api-importer-profiles-and-managed-url-checks.md`,
      the amended ADRs under `researches/adrs/`, and
      `researches/architecture-decisions.md`
- [ ] T062 Add the G33 importer profile builder gap entry and matching fallback
      flag in `researches/ux-rewrite-gaps.md` and
      `packages/frontend/src/ux/lib/flags.ts`; flip the flag only when the
      complete backend contract is available
- [ ] T063 Regenerate importer contract sections with
      `pnpm --filter @componode/backend docs:importers` and verify
      `pnpm --filter @componode/backend docs:importers:check`

## Phase 9: Polish and verification

- [ ] T064 Run importer tests for
      `packages/importer-web-url/test/importer.test.ts` and
      `packages/importer-api-url/test/importer.test.ts`, backend integration
      tests in `packages/backend/test/integration/`, and frontend tests in
      `packages/frontend/src/test/unit/`
- [ ] T065 Run `pnpm --filter @componode/agent test` and
      `pnpm --filter @componode/agent typecheck` to verify the lockstep importer
      manifest/config contract in the Import Agent
- [ ] T066 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
      `pnpm --filter @componode/backend docs:api:check`, and
      `pnpm --filter @componode/backend docs:importers:check`
- [ ] T067 Run the repository Playwright workload from `playwright/quickstart.md`
      for collection setup, profile navigation, and disabled/check status behavior

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no code dependencies; inspect the existing importer and
  URL Check contracts.
- **Foundational (Phase 2)**: tests define the Source/check ownership and API
  read-only contracts; blocks all implementation stories.
- **US1 (Phase 3)**: can begin after foundational schemas/tests.
- **US2 (Phase 4)**: depends on stable profile/instance keys from US1.
- **US3 (Phase 5)**: depends on US1 definitions and US2 core asset mapping.
- **US4 (Phase 6)**: depends on US1 stable keys and US3 check mappings.
- **US5 (Phase 7)**: depends on the Source/check membership model from US3.
- **API/docs (Phase 8)**: depends on accepted read/write contracts from
  Phases 3–7.
- **Polish (Phase 9)**: depends on all user stories and generated docs.

### User Story Dependencies

- **US1**: establishes profile and instance identity; independently testable
  through a saved config.
- **US2**: depends on US1; validates inventory sync and completed-run
  reconciliation.
- **US3**: depends on US1/US2; validates managed Check materialization,
  status, and read-only detail.
- **US4**: depends on the stable keys and Check mapping from US1/US3.
- **US5**: depends on Source/check membership ownership from US3.

### Parallel Opportunities

- T008, T009, and T010 can be written in parallel because they touch separate
  importer/frontend test files.
- T018, T019, and T020 can be written in parallel after foundational tests.
- T028, T029, and T031 can be written in parallel; avoid concurrent edits to
  `url-checks-monitoring.test.ts` by assigning separate test blocks or
  sequencing T028 and T029.
- Importer guide updates and API contract updates can proceed in parallel
  after the final field contract is stable.

## Implementation Strategy

1. Establish failing Source identity, importer scope, and URL Check ownership
   tests before changing behavior.
2. Deliver the collection builder and stable-key schemas as the MVP.
3. Add one-asset-per-profile importer output and core per-row synchronization.
4. Add managed URL Check materialization, shared Source ownership, and
   ComponentInstance status propagation.
5. Migrate existing one-URL configs and preserve unambiguous check history.
6. Complete lifecycle, deprecated-write, docs, flags, and end-to-end coverage.

## Complexity Tracking

No new project/package boundary or third-party dependency is planned. The new
typed Source-to-URL-Check membership and status propagation are justified by
the ratified ADR-126 decision and preserve Source-scoped ownership without
introducing a polymorphic relationship store.
