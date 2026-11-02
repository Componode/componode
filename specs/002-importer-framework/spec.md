# Feature Specification: Importer framework with GitHub importer

**Feature Branch**: `002-importer-framework`

**Created**: 2026-09-02

**Status**: Shipped

**Input**: User description: "Deliver the generic importer framework and the first concrete GitHub importer so an admin can configure and schedule a run, an editor/admin can trigger it, and every authenticated user can watch live run progress. The backend must upsert and reconcile components and instances per ADR-035/036/037/056/057/058/059/060/061/062/063."

---

## User Scenarios & Testing

### User Story 1 - Configure a GitHub importer (Priority: P1)

As an admin, I want to create and save a GitHub importer configuration (organization, optional repo filter, secret token reference, schedule, enable/disable) so the system knows which source to import and when.

**Why this priority**: Without a persisted configuration, no run can be scheduled or triggered. This is the minimum prerequisite for the entire milestone.

**Independent Test**: Call `POST /api/v1/importer-configs` as admin and verify the row in `importer_configs` with the supplied `importerName`, `label`, `scope`, `secretRefs`, `schedule`, and `enabled` flag. The registry endpoint `GET /api/v1/importers` must list `github` with its config schema.

**Acceptance Scenarios**:

1. **Given** the `github` importer is registered, **when** an admin posts a valid config with `importerName: "github"`, `label`, `scope: { org: "..." }`, and `secretRefs: [{ key: "token", env: "env:GITHUB_TOKEN" }]`, **then** the API returns `201` with the created config and stores it in `importer_configs`.
2. **Given** an existing config, **when** an admin patches the schedule, **then** the scheduler is rescheduled and the updated `schedule` is persisted.
3. **Given** an invalid config (unknown importer or missing required field), **when** an admin attempts to create it, **then** the API returns `400` `VALIDATION_FAILED` and no row is inserted.

---

### User Story 2 - Trigger and watch an import run (Priority: P2)

As an editor or admin, I want to trigger a run on demand and watch its live phase, status, and per-asset counts so I know when components have been imported.

**Why this priority**: This is the headline value of the milestone — "configure an importer and run it" — and produces the actual `Component`/`ComponentInstance` data.

**Acceptance Scenarios**:

1. **Given** a valid GitHub importer config, **when** an editor posts to `/api/v1/importer-configs/:id/trigger`, **then** the API returns `202 { runId }`, a `PENDING` run row is created, and the run is queued for execution.
2. **Given** a queued run, **when** it reaches the front of the queue, **then** its status becomes `RUNNING`, `startedAt` is set, and `currentPhase` is updated as the importer reports phases.
3. **Given** a `RUNNING` import, **when** the GitHub importer yields repositories, **then** each repo upserts a `Component` with `category = REPOSITORY`, `provider = GITHUB`, and a `ComponentInstance` in `PRODUCTION`, and the run counts (`assetsProcessed`, `assetsCreated`, `assetsUpdated`) are incremented.
4. **Given** an active run, **when** a client polls `GET /api/v1/importer-configs/:id/runs/:runId`, **then** it receives the current `status`, `currentPhase`, counts, and terminal `errorMessage` if failed.

---

### User Story 3 - Cancel, recover, and reconcile imports (Priority: P3)

As an admin, I want to cancel a running import, have interrupted runs recovered on restart, and trust that missing instances/components are properly reconciled so the catalog stays accurate.

**Why this priority**: Reliability and correctness of imported data. This story makes the framework production-ready even though it is not the first demo step.

**Acceptance Scenarios**:

1. **Given** a `RUNNING` import, **when** an editor/admin posts `/api/v1/importer-configs/:id/runs/:runId/cancel`, **then** `cancelRequestedAt` is set, the `AbortSignal` aborts the importer, and the run ends in `CANCELLED`.
2. **Given** the backend restarts while a run is `RUNNING` (or `PENDING`), **when** the recovery loop runs, **then** `RUNNING` rows without `cancelRequestedAt` become `INTERRUPTED`, `RUNNING` rows with `cancelRequestedAt` become `CANCELLED`, and `PENDING` rows become `INTERRUPTED`.
3. **Given** a previously imported component whose instances are not yielded in the current `COMPLETED` run, **when** phase-1 reconciliation runs, **then** the missing instance rows get `status = GONE`.
4. **Given** a previously imported component not yielded at all in a `COMPLETED` run, **when** phase-2 reconciliation runs, **then** its `Component.lifecycle` is set to `RETIRED`.

---

### Edge Cases

- What happens when two users trigger the same config while a run is already in flight? Return `409 Conflict`.
- How does the system handle a GitHub API rate limit or network error? The run transitions to `FAILED`, `errorType`/`errorMessage` are set, and details are written to `import_run_errors` for per-asset errors only.
- What if an importer yields a malformed `DiscoveredAsset`? The core validates it, writes a row to `import_run_errors`, increments `assetsProcessed`, and continues.
- What if a run is cancelled just before phase-2 reconciliation? Phase 2 is skipped unless the run reaches `COMPLETED`.

---

## Requirements

### Functional Requirements

- **FR-001**: The backend MUST expose a registry of available importers (`GET /api/v1/importers`) including name, label, description, and config schema.
- **FR-002**: Admins MUST be able to create, update, delete, and list `importer_configs` rows. Editors and viewers MAY list configs and runs; only admins edit configs.
- **FR-003**: Editors and admins MUST be able to trigger an on-demand import run (`POST /api/v1/importer-configs/:id/trigger`) and receive `202 { runId }`.
- **FR-004**: The run coordinator MUST enforce `IMPORTER_MAX_CONCURRENCY` (default 3) via a bounded in-process queue. A second run on the same config while one is `PENDING`/`RUNNING` MUST be rejected with `409 Conflict`.
- **FR-005**: Importer secrets MUST be pre-resolved from `secretRefs` before being passed to the importer; importers MUST NOT access `process.env`.
- **FR-006**: Each yielded `DiscoveredAsset` MUST be validated by `validateDiscoveredAsset`; invalid assets are logged to `import_run_errors` and skipped.
- **FR-007**: Each valid asset MUST be upserted in its own transaction: `Component` by `(category, provider, externalId)` and `ComponentInstance` by `(componentId, instanceExternalId)`.
- **FR-008**: Phase-1 reconciliation MUST orphan missing instances (`status = GONE`) during the run as each component is processed.
- **FR-009**: Phase-2 reconciliation MUST retire components (`lifecycle = RETIRED`) previously touched by the config but not yielded in a `COMPLETED` run.
- **FR-010**: Cancellation MUST use `AbortController` + `cancelRequestedAt` column for durability.
- **FR-011**: The scheduler MUST read enabled configs with `schedule` expressions, enqueue runs via cron, and reschedule on config changes.
- **FR-012**: A startup recovery loop MUST mark stale `RUNNING`/`PENDING` rows as `INTERRUPTED` or `CANCELLED`.
- **FR-013**: The frontend MUST show the importers list, config create/edit dialog, run list, and a live run detail view that polls status/phase.

### Key Entities

- **ImporterConfig**: Persisted importer setup (`importerName`, `label`, `scope`, `secretRefs` (array of `{key, env?}` refs), `schedule`, `enabled`).
- **ImportRun**: One execution of a config (`status`, `startedAt`, `completedAt`, `assetsProcessed`, `currentPhase`, `cancelRequestedAt`, `errorType`, `errorMessage`).
- **ImportRunError**: Per-asset or per-run non-terminal error log.
- **DiscoveredAsset**: In-memory contract yielded by importers (`category`, `provider`, `resourceType`, `name`, `externalId`, `slug`, `details`, `instances`).
- **Component / ComponentInstance**: Existing 001 entities updated by importer upserts and reconciliation.

---

## Success Criteria

- **SC-001**: An admin can create a GitHub importer config through the UI or API, and the persisted config appears in the list with a valid `201`/`200` response and no validation errors.
- **SC-002**: Triggering a run returns `202` and the run record reaches `COMPLETED` or `FAILED` with updated `assetsProcessed` for a test fixture of ≤ 50 repos (covered by `import-runs` integration tests).
- **SC-003**: The live run detail view updates `currentPhase` and `assetsProcessed` every 2 seconds while `RUNNING`.
- **SC-004**: `pnpm test:unit` and `pnpm test:integration` pass for core, backend, importer-github, and frontend packages.

---

## Assumptions

- The first concrete importer is GitHub only; AWS, Azure, Kubernetes, web/API, and MCP importers are deferred to milestone `003-component-catalog`.
- In-process scheduling and queue are acceptable for v1 single-instance Docker Compose deployments.
- Secret resolution supports `env:VAR_NAME` refs only; Vault/AWS Secrets Manager integrations are post-v1.
- The component taxonomy is reconciled with ADR-013 so `REPOSITORY` is a valid category (this was confirmed in the planning clarifications).
- The frontend config form is schema-driven for GitHub fields; future importers may reuse the same form renderer.
