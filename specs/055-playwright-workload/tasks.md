# Tasks: Componode Playwright User Testing

**Input**: Design documents in `specs/055-playwright-workload/` and the Playwright-specific plan under `playwright/`.

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`.

**Tests**: Required. Write the failing assertion first, confirm it fails for the intended reason, implement the smallest passing harness behavior, then refactor.

**Tracking rule**: This file is the sole implementation status tracker. Mark a task `[x]` only after its described verification passes. Add discovered work here and update the related coverage matrix in the same change.

## Phase 1: Setup

**Purpose**: Establish the standalone project and protect the active 054 work.

- [x] T001 Confirm that the 054 onboarding commit is integrated into branch `055-playwright-workload`; record its commit hash and the integration state in `playwright/README.md`. If it is unavailable, leave dependent tasks blocked and do not copy uncommitted files.
- [x] T002 Create the nested standalone workspace declaration in `playwright/pnpm-workspace.yaml` without changing the root `pnpm-workspace.yaml`.
- [x] T003 Create `playwright/package.json` with private package metadata and the agreed normal-run, debug-run, cleanup, and test scripts.
- [x] T004 Add pinned Playwright Test and accessibility dependencies from the `playwright/` workspace and commit the resulting `playwright/pnpm-lock.yaml`; verify release age and Node/browser compatibility before selecting versions.
- [x] T005 Create `playwright/.gitignore` for `node_modules`, `.env.test`, `.env-private`, `.auth`, reports, traces, videos, and generated coverage.
- [x] T006 Create `playwright/playwright.config.ts` with one worker, the approved browser projects/viewports, HTML and JUnit reporters, and failure-only trace/screenshot/video settings.
- [x] T007 Add `playwright/tests/README.md` documenting the test directory layout and naming/coverage conventions.

## Phase 2: Foundational Isolation and Runtime

**Purpose**: Complete these blocking tasks before any application journey runs.

- [x] T008 [P] Write failing preflight tests in `playwright/tests/infra/preflight.spec.ts` for missing Docker, conflicting host ports, unsafe project names, and env values that point at the normal project stack.
- [x] T009 Implement fail-closed preflight checks in `playwright/scripts/preflight.ts` and require the explicit test Compose project name.
- [x] T010 [P] Write failing runtime network-isolation tests in `playwright/tests/infra/network-isolation.spec.ts` proving provider hostnames resolve to local mocks and external requests cannot leave the test network.
- [x] T011 Implement the internal-only service network, project-scoped PostgreSQL volume, distinct host ports, health checks, and root Dockerfile reuse in `playwright/compose.test.yml`.
- [x] T012 [P] Write failing local HTTPS trust tests in `playwright/tests/infra/tls-trust.spec.ts` for the browser/app CA bundles without a global certificate-verification bypass.
- [x] T013 Implement the local TLS routing and internal CA issuance in `playwright/Caddyfile`; document the Caddy root trust path in `playwright/research/repository-facts.md`.
- [x] T014 Write failing secret-path tests in `playwright/tests/infra/private-material.spec.ts` that assert generated credentials/certificates are under `playwright/.env-private/` and excluded from tracked files/build context.
- [x] T015 Implement per-run secret and certificate generation in `playwright/scripts/private-material.ts`, keeping generated values out of stdout, logs, and reports.
- [x] T016 Write failing orchestration lifecycle tests in `playwright/tests/infra/stack-lifecycle.spec.ts` for healthy startup, normal teardown, failure teardown, and debug retention.
- [x] T017 Implement scoped Compose startup, health waits, teardown, and debug retention in `playwright/scripts/compose.ts`.
- [x] T018 Add the cross-platform one-command runner in `playwright/scripts/run.ts` and wire its package scripts in `playwright/package.json`.
- [x] T019 Verify that private env/cert paths are excluded by the existing root `.dockerignore` and record the observed build-context result in `playwright/README.md`; do not change root ignore configuration unless a real failure proves it is required.

**Checkpoint**: A clean test stack starts and stops without importing application data, touching the normal stack, or reaching external networks.

## Phase 3: User Story 1 - Run a Safe Disposable Workload (Priority: P1)

**Goal**: Complete an isolated local run and produce its basic reports.

**Independent Test**: Keep the normal Componode stack running while a minimal test run starts, authenticates, writes only to its own database, generates reports, and cleans up.

### Tests for User Story 1

- [x] T020 [P] [US1] Add the minimal authenticated smoke journey in `playwright/tests/infra/stack-smoke.spec.ts` and verify it fails before the app test service is wired.
- [x] T021 [P] [US1] Add a normal-stack sentinel assertion in `playwright/tests/infra/stack-isolation.spec.ts` that compares normal app health and seeded state before/after the workload.
- [x] T022 [US1] Add a bounded startup/teardown failure assertion in `playwright/tests/infra/stack-lifecycle.spec.ts` so a failed health check never leaves a partially owned project running.

### Implementation for User Story 1

- [x] T023 [US1] Add the app, PostgreSQL, Caddy, and runner services to `playwright/compose.test.yml`, with health-gated dependencies and distinct configurable host ports.
- [x] T024 [US1] Implement unique per-run environment generation and normal-stack sentinel checks in `playwright/scripts/run.ts`.
- [x] T025 [US1] Implement explicit cleanup by Compose project name in `playwright/scripts/compose.ts`; verify it never calls global Docker prune commands.
- [x] T026 [US1] Add the debug-retain path and explicit debug cleanup command in `playwright/scripts/compose.ts` and `playwright/package.json`.
- [x] T027 [US1] Verify the minimal smoke journey and normal-stack sentinel in `playwright/tests/infra/stack-smoke.spec.ts` and `playwright/tests/infra/stack-isolation.spec.ts`.

**Checkpoint**: A normal run and a debug run are independently usable; normal cleanup affects only the named disposable project.

## Phase 4: User Story 2 - Exercise Synthetic Data and Pagination (Priority: P1)

**Goal**: Cover application-owned data lifecycles with deterministic fixtures and realistic list boundaries.

**Independent Test**: From a fresh database, seed the fixture set, verify the table matrix, exercise supported UI mutations, and check all server-side pagination boundaries.

### Tests for User Story 2

- [x] T028 [P] [US2] Add a fixture-coverage test in `playwright/tests/data/table-coverage.spec.ts` requiring an entry for all 35 application-owned tables and explicit exclusion of the two migration bookkeeping tables.
- [x] T029 [P] [US2] Add request-context pagination tests in `playwright/tests/api/pagination.spec.ts` for Components page/pageSize, activity limit/offset, and Suggestions limit/offset; verify two full pages and a partial page.
- [x] T030 [P] [US2] Add a browser assertion in `playwright/tests/journeys/components-list.spec.ts` that 201 synthetic Components are all loaded by the UI's automatic page fetch.
- [x] T031 [US2] Add failing role-aware CRUD and lifecycle journeys in `playwright/tests/journeys/catalog.spec.ts` and `playwright/tests/journeys/organization.spec.ts` before implementing their seed/setup helpers.

### Implementation for User Story 2

- [x] T032 [US2] Implement the bulk deterministic baseline generator in `playwright/data/seed-bulk.ts`, respecting DB constraints, FK order, UUID v7 IDs, and unique slugs.
- [x] T033 [US2] Implement the supported-flow seeder for actors, Credentials, OIDC settings, Import Agents, runs, and monitoring records in `playwright/data/seed-app-flows.ts`.
- [x] T034 [US2] Implement the table-to-fixture coverage registry in `playwright/data/table-coverage.ts` and validate it against `playwright/data/fixture-matrix.md`.
- [x] T035 [US2] Implement pagination fixture volumes and request-context setup in `playwright/data/pagination-fixtures.ts` with 201 Components and 101 activity/Suggestions records.
- [x] T036 [US2] Complete supported catalog, relationship, organization, settings, and retirement journeys in `playwright/tests/journeys/catalog.spec.ts`, `playwright/tests/journeys/organization.spec.ts`, and `playwright/tests/journeys/admin.spec.ts`.
- [x] T037 [US2] Verify that generated audit/history, session, Source, ImporterRun, AgentSession, and observation data comes from supported lifecycles in `playwright/tests/data/table-coverage.spec.ts`.

**Checkpoint**: Every application table has a documented fixture/lifecycle source; pagination behavior matches the API/UI contract without adding nonexistent page controls.

## Phase 5: User Story 3 - Mock Implemented Importers (Priority: P1)

**Goal**: Test all currently implemented provider adapters and source-scoped reconciliation without live provider access.

**Independent Test**: Run each implemented importer against its local mock, compare mapped output and run status, then change the GitHub fixture across runs to verify reconciliation.

### Tests for User Story 3

- [x] T038 [P] [US3] Add contract tests for web/API URL response mapping in `playwright/tests/importers/url-importers.spec.ts` before creating their mock handlers.
- [x] T039 [P] [US3] Add GitHub mock contract tests in `playwright/tests/importers/github-mock.spec.ts` for REST paths, Link pagination, response envelopes, and 403/404/5xx behavior.
- [x] T040 [P] [US3] Add Alibaba RPC mock contract tests in `playwright/tests/importers/alibaba-mock.spec.ts` for Action, Version, request shape, auth-field presence, NextToken, and error responses.
- [x] T041 [P] [US3] Add Docker mTLS mock contract tests in `playwright/tests/importers/docker-mock.spec.ts` for certificate rejection, API v1.41, and each importer-used Engine API path.
- [x] T042 [US3] Add a failing importer source-reconciliation journey in `playwright/tests/importers/github-reconciliation.spec.ts` covering add, update, omission/retirement, and shared-Source preservation.
- [x] T043 [US3] Add an importer registry coverage test in `playwright/tests/importers/registry-coverage.spec.ts` that fails when an implemented importer has no mock/mapping entry.

### Implementation for User Story 3

- [x] T044 [US3] Implement internal scenario reset/select behavior in `playwright/mocks/control/server.ts` and restrict its route to the internal test network.
- [x] T045 [P] [US3] Implement web/API URL response fixtures in `playwright/mocks/url-importers/server.ts` and profiles in `playwright/fixtures/url-importers/`.
- [x] T046 [P] [US3] Implement GitHub REST endpoints and Link-header pagination in `playwright/mocks/github/server.ts` with profiles in `playwright/fixtures/github/`.
- [x] T047 [P] [US3] Implement Alibaba STS, Resource Center, and BSS RPC handlers in `playwright/mocks/alibaba/server.ts` with local hostname routing and profiles in `playwright/fixtures/alibaba/`.
- [x] T048 [P] [US3] Implement the read-only Docker Engine v1.41+ mTLS fake in `playwright/mocks/docker-engine/server.ts` with certificates and profiles generated under `playwright/.env-private/`.
- [x] T049 [US3] Wire the five importer mocks into `playwright/compose.test.yml` and `playwright/Caddyfile`, including aliases for fixed Alibaba hosts and configurable GitHub/Resource Center endpoints.
- [x] T050 [US3] Implement importer UI setup/run/detail journeys in `playwright/tests/importers/importer-flows.spec.ts` for Alibaba Cloud, GitHub, Docker, web URL, and API URL.
- [x] T051 [US3] Complete the multi-run GitHub source-reconciliation scenario in `playwright/tests/importers/github-reconciliation.spec.ts` and assert Source-scoped membership/retirement outcomes.
- [x] T052 [US3] Complete the importer manifest/coverage guard in `playwright/tests/importers/registry-coverage.spec.ts` and update `playwright/coverage-matrix.md` whenever implementation status changes.

**Checkpoint**: All five implemented importers have mock-backed mapping coverage; no scaffold receives a fake external contract; shared reconciliation is proven through GitHub.

## Phase 6: User Story 4 - Verify Authentication, Roles, and Application Journeys (Priority: P1)

**Goal**: Validate supported login, administration, catalog, importer, and permission journeys across Viewer, Editor, and Admin.

**Independent Test**: Authenticate separate test actors, exercise representative permitted/forbidden flows, and verify persisted state and safe user feedback.

### Tests for User Story 4

- [x] T053 [P] [US4] Add failing login/logout/session/registration/reset journeys in `playwright/tests/auth/password-auth.spec.ts` for registration disabled/enabled and Admin-generated reset.
- [x] T054 [P] [US4] Add failing OIDC success and error journeys in `playwright/tests/auth/oidc.spec.ts` for discovery, callback, token verification, and JIT user provisioning.
- [x] T055 [P] [US4] Add role matrix assertions in `playwright/tests/auth/role-matrix.spec.ts` for Viewer, Editor, and Admin navigation/read/write boundaries.
- [x] T056 [US4] Add failing product, relationship, Components, Component Groups, Suggestions, Sources, and organization journeys in the corresponding `playwright/tests/journeys/*.spec.ts` files.

### Implementation for User Story 4

- [x] T057 [US4] Configure local Dex static users and OAuth client in `playwright/dex/config.yaml` and add the Dex service and health checks to `playwright/compose.test.yml`.
- [x] T058 [US4] Implement role-scoped browser fixtures and one-login-per-role storage state in `playwright/tests/fixtures/auth.ts`, ensuring state files are ignored under `playwright/.auth/`.
- [x] T059 [US4] Complete password, registration, reset, session, and OIDC journeys in `playwright/tests/auth/password-auth.spec.ts` and `playwright/tests/auth/oidc.spec.ts`.
- [x] T060 [US4] Complete route-group journeys and role assertions in `playwright/tests/auth/role-matrix.spec.ts`, `playwright/tests/journeys/catalog.spec.ts`, `playwright/tests/journeys/organization.spec.ts`, and `playwright/tests/journeys/admin.spec.ts`.
- [x] T061 [US4] Add secret-redaction assertions in `playwright/tests/security/no-secret-output.spec.ts` for browser views, mock diagnostics, application logs available to the test harness, reports, and trace policy for tests that handle passwords/reset/enrollment tokens.

**Checkpoint**: Each route group has a user journey, role-sensitive actions match the documented matrix, and no secret values appear in ordinary UI/output.

### Monitoring and probe coverage for User Story 4

**Goal**: Validate first-instance recovery, URL Check auth behavior, Hub probes, and real Import Agent execution.

**Independent Test**: Create/configure an API Component and check, observe each Hub auth mode at the local target, then verify an Agent-vantage success and disconnected-Agent missed outcome.

### Tests for User Story 4

- [x] T062 [P] [US4] Add failing first-instance recovery journeys in `playwright/tests/monitoring/first-instance-recovery.spec.ts` for active zero-instance success, invalid input, unauthenticated 401, missing 404, inactive/retired denial, Viewer denial, and duplicate 409.
- [x] T063 [P] [US4] Add failing URL Check form and role tests in `playwright/tests/monitoring/url-check-setup.spec.ts` for NONE/BASIC/BEARER/CUSTOM_HEADERS, target/window/enabled fields, API-only controls, and Credential/Agent preserve-versus-reconfigure rules.
- [x] T064 [P] [US4] Add failing Hub probe tests in `playwright/tests/monitoring/hub-probes.spec.ts` asserting expected local request matches and resulting observations for all four auth modes.
- [x] T065 [US4] Add failing real Agent success/offline tests in `playwright/tests/monitoring/agent-probes.spec.ts` for WSS enrollment, successful probe, disconnected Agent, and MISSED observation.

### Implementation for User Story 4

- [x] T066 [US4] Implement an internal URL Check target mock in `playwright/mocks/url-check-target/server.ts` that records only safe header names and credential-match booleans.
- [x] T067 [US4] Configure `.test` Compose aliases and a 1000ms scheduler sweep in `playwright/compose.test.yml` for prompt, egress-free Hub probe execution.
- [x] T068 [US4] Implement Admin-seeded Agent enrollment in `playwright/scripts/enroll-agent.ts`, storing the one-use token only under `playwright/.env-private/`.
- [x] T069 [US4] Add the real Agent service, CA bundle, health/readiness checks, and WSS connection configuration in `playwright/compose.test.yml`.
- [x] T070 [US4] Complete Hub mode probe assertions and observation checks in `playwright/tests/monitoring/hub-probes.spec.ts`.
- [x] T071 [US4] Complete first-instance recovery and role-preservation assertions in `playwright/tests/monitoring/first-instance-recovery.spec.ts` and `playwright/tests/monitoring/url-check-setup.spec.ts`.
- [x] T072 [US4] Complete real Agent success and disconnected/missed assertions in `playwright/tests/monitoring/agent-probes.spec.ts`.

**Checkpoint**: User Story 4 passes password/OIDC, role, catalog, first-instance, Hub-probe, and Agent-probe journeys; no test requires host Docker control or external target access.

## Phase 7: User Story 5 - Diagnose Failures and Maintain Coverage (Priority: P2)

**Goal**: Provide useful failure evidence, accessibility feedback, cross-browser smoke, and future coverage guardrails.

**Independent Test**: Force a controlled failure, inspect sanitized reports/evidence, run accessibility checks, and verify an uncovered implemented importer is rejected by the coverage guard.

### Tests for User Story 5

- [x] T073 [P] [US5] Add failing accessibility scans in `playwright/tests/accessibility/key-routes.spec.ts` for login, catalog, dialogs/forms, URL Checks, and admin routes.
- [x] T074 [P] [US5] Add reporter/evidence tests in `playwright/tests/infra/reporting.spec.ts` proving HTML/JUnit outputs exist and traces/screenshots/videos are failure-only.
- [x] T075 [US5] Add an importer coverage regression test in `playwright/tests/infra/coverage-governance.spec.ts` and document the same-feature manual update gate for new route groups in `playwright/coverage-matrix.md`.

### Implementation for User Story 5

- [x] T076 [US5] Add focused axe scans and keyboard assertions in `playwright/tests/accessibility/key-routes.spec.ts` without introducing screenshot-diff baselines.
- [x] T077 [US5] Configure HTML/JUnit reporters and failure-only artifacts in `playwright/playwright.config.ts` and `playwright/package.json`.
- [x] T078 [US5] Implement route/importer coverage governance in `playwright/scripts/validate-coverage.ts` and record new product modules in `playwright/coverage-matrix.md`.
- [x] T079 [US5] Finalize `playwright/README.md`, `playwright/quickstart.md`, `playwright/HANDOFF.md`, and `playwright/templates/session-handoff.md` against the implemented commands and actual coverage.

**Checkpoint**: Reports are actionable and sanitized; future implemented routes/importers cannot silently escape the coverage process.

## Phase 8: Polish and Cross-Cutting Verification

- [x] T080 [P] Add full Chromium desktop/narrow-desktop and Firefox/WebKit smoke projects in `playwright/playwright.config.ts`.
- [x] T081 Verify the clean-run, debug-run, and cleanup commands from `playwright/quickstart.md` against a fresh isolated Compose project.
- [x] T082 Verify failure teardown, report retention, and no-secret output using controlled failures in `playwright/tests/infra/reporting.spec.ts`.
- [x] T083 Run `pnpm install --frozen-lockfile` and the complete Playwright suite from the standalone `playwright/` workspace; record results in `playwright/README.md`.
- [x] T084 Verify 054 integration is present, the original 054 worktree remains untouched, and only `playwright/` plus required `specs/055-playwright-workload/` files changed.
- [x] T085 Review official reference links and regenerate/update `playwright/research/official-references.md` and `playwright/contracts/mock-api-contracts.md` for any endpoint drift.
- [x] T086 Run final diff, task-format, coverage, secret-path, Docker-network, and report checks; update completed checkboxes in `specs/055-playwright-workload/tasks.md`.

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 Setup**: can start immediately; T001 is a hard gate for feature-dependent E2E work.
- **Phase 2 Foundational**: depends on the standalone package skeleton and blocks all service and user journeys.
- **US1 isolated run**: depends on the foundation and provides the health/cleanup proof needed by every story.
- **US2 data**: depends on fresh DB/migrations from US1.
- **US3 importers**: depends on the internal network, scenario controller, and seed foundation.
- **US4 auth/journeys**: depends on app health, synthetic users, and Dex; monitoring subphase additionally depends on 054 being integrated.
- **US5 diagnostics**: can start after the runner/config skeleton; final coverage guard depends on the importer and route matrices.
- **Polish**: depends on all desired stories and on the 054 integration gate.

### User Story Dependencies

- **US1 (P1)**: No product journey dependency; establishes safe execution.
- **US2 (P1)**: Depends on US1 and DB migrations.
- **US3 (P1)**: Depends on US1 and the mock scenario controller; GitHub reconciliation depends on importer run setup.
- **US4 (P1)**: Auth/catalog journeys depend on US1 and seed support. URL Check recovery and Agent journeys additionally depend on 054 integration.
- **US5 (P2)**: Reporter/accessibility tests depend on test config; future coverage guard depends on the route/importer inventory.

### Parallel Opportunities

- After the workspace skeleton exists, `playwright/mocks/url-importers/`, `playwright/mocks/github/`, `playwright/mocks/alibaba/`, and `playwright/mocks/docker-engine/` can be developed in separate files after their contracts are agreed.
- `playwright/data/fixture-matrix.md` validation and `playwright/tests/accessibility/` setup can proceed independently of provider mock implementation.
- Dex configuration can proceed in parallel with URL Check target mock development after the shared Caddy CA plan is implemented.
- Test execution remains serial because mutable database and scenario state are shared.

### Parallel Execution Examples

These are authoring opportunities only; the running E2E suite remains single-worker.

- **US1**: Draft `T020` (`playwright/tests/infra/stack-smoke.spec.ts`) and `T021` (`playwright/tests/infra/stack-isolation.spec.ts`) in parallel after the base Compose service names and health contract are fixed.
- **US2**: Draft `T028` (`playwright/tests/data/table-coverage.spec.ts`) and `T029` (`playwright/tests/api/pagination.spec.ts`) in parallel. Implement the bulk fixture in `T032` only after their expected table and page boundaries are explicit.
- **US3**: Draft `T038`-`T041` in their distinct importer mock contract files in parallel. Implement `T045`-`T048` in separate mock service directories after `T044` defines the shared scenario-control contract.
- **US4**: Draft `T053`-`T055` in their separate auth test files in parallel after the role fixture contract is agreed. Draft `T062`-`T064` in their separate monitoring test files in parallel; `T065` follows the real Agent service contract.
- **US5**: Draft `T073` (`playwright/tests/accessibility/key-routes.spec.ts`) and `T074` (`playwright/tests/infra/reporting.spec.ts`) in parallel because they target separate test concerns.

## MVP and Delivery Strategy

### MVP

Deliver US1 first: standalone workspace, isolated app/PostgreSQL/Caddy, no-egress proof, one authenticated smoke journey, one-command cleanup, and sanitized reports. This provides a safe base before broad fixture and importer work.

### Incremental Delivery

1. US1: prove isolation and repeatable run lifecycle.
2. US2: seed deterministic data and validate actual pagination contracts.
3. US3: test the five implemented importer adapters and GitHub source reconciliation.
4. US4: add auth/roles and complete the 054-dependent URL Check/Agent journeys once 054 is integrated.
5. US5 and polish: accessibility, cross-browser smoke, future coverage guard, and final handoff runbook.

Each increment must pass its own tests and preserve the no-egress/secret-isolation gates.

## Complexity Tracking

No constitution violations require justification. All test tooling, mock services, fixture code, references, and user documentation remain within `playwright/`; only required spec-kit artifacts are stored under `specs/055-playwright-workload/`.
