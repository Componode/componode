# Tasks: ImporterSource Core

**Input**: Design documents from `/specs/044-importer-source-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — test-first is non-negotiable (constitution VI); write
failing tests before each implementation task.

**Organization**: Grouped by user story; each phase is independently
testable per spec acceptance scenarios.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Persistence layer + core vocabulary every story builds on.

- [X] T001 Create migration `packages/backend/src/db/migrations/022_importer_sources.ts` per data-model.md: `importer_sources` (`UNIQUE(importerName, externalIdentity)`, `boundConfigId → importer_configs ON DELETE SET NULL`, `status` CHECK from `IMPORTER_SOURCE_STATUSES`), `source_component_memberships` + `source_instance_memberships` (`UNIQUE(sourceId, entityId)`, `ON DELETE CASCADE` FKs, `details jsonb`, seen-in-run columns `ON DELETE SET NULL`), `import_runs.sourceId uuid NULL → importer_sources ON DELETE RESTRICT` + `import_runs_source_idx`, `import_runs.configId` NOT NULL→NULL with FK rebuilt `ON DELETE SET NULL` (`pg_constraint` DO-block precedent, migration `008`), `import_runs_config_idx`; reversible `down()`.
- [X] T002 [P] Add `ImporterSourceRow`, `SourceComponentMembershipRow`, `SourceInstanceMembershipRow` to `packages/backend/src/db/types.ts` + `DB` map; change `ImportRunRow.configId` to `string | null` and add `sourceId: string | null`.
- [X] T003 [P] Create `packages/core/src/constants/importer-source.ts` exporting `IMPORTER_SOURCE_STATUSES = ["ACTIVE","UNMONITORED","RETIRED"]`, `ImporterSourceStatus` type, and `SOURCE_AUDIT_ACTIONS` (`created|bound|unmonitored|retired|reactivated`); export from `packages/core/src/index.ts`.
- [X] T004 [P] Create `packages/core/src/contracts/importer-source.ts` (`ImporterSource`, `SourceIdentityInput`, `BoundConfigSummary` read types) and `canonicalizeSourceIdentity(identity)` util (strip userinfo/auth query params/fragment for URL identities); export from index.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract deltas every story consumes.

- [X] T005 Update `packages/core/src/contracts/importer.ts` — add required `reportSourceIdentity(identity)` and `resolveTarget(targetId)` per contracts/importer-contract.md; update `packages/core/src/importer-registry.ts` `ImporterManifest` with optional `targetRefKey` + `reportsSourceIdentity`; update `packages/core/src/contracts/import-run.ts` (`configId: string | null`, `sourceId: string | null`); update every `makeContext`-style test helper across `packages/importer-*/test/`, `packages/backend/test/`, `packages/agent/test/` to the new required shape.
- [X] T006 Update `packages/core/src/contracts/agent-protocol.ts` — add `source.identity` job-stream frame (`{runId, externalIdentity≤512, label?≤200}` strict), register in `agentMessageSchemas`; bump `AGENT_PROTOCOL_VERSION` 2→3 in `packages/core/src/constants/import-agent.ts` and add `AGENT_NACK_TARGET_RESOLUTION_PREFIX = "TARGET_RESOLUTION_FAILED"`; add `"source.identity"` to `JOB_STREAM_TYPES` and route it to `runHandler.onSourceIdentity` in `packages/backend/src/services/agent-session-service.ts` (add method to the `RemoteRunHandler` interface).

**Checkpoint**: Core contracts compile; green `pnpm typecheck` in core/backend/agent before story work.

---

## Phase 3: User Story 1 — Every run attributed to a durable Source (P1) 🎯 MVP

**Goal**: Runs register-or-match an `ImporterSource` by provider identity
before first asset yield; empty inventories still register.

**Independent Test**: `test/integration/importer-sources.test.ts` — run
double reports identity → source row + `run.sourceId` + `boundConfigId`;
rerun matches; empty inventory registers.

### Tests for User Story 1

- [X] T007 [US1] Write failing integration test `packages/backend/test/integration/importer-sources.test.ts` covering: report→register, rerun→match (no duplicate), empty inventory registers, rebind-on-report from a second config, and runs carrying `sourceId`.
- [X] T008 [P] [US1] Write failing unit test for `canonicalizeSourceIdentity` in `packages/core/src/utils/` (userinfo, auth query params, fragment stripped; non-URL identities untouched).
- [X] T009 [P] [US1] Write failing agent test in `packages/agent/test/executor.test.ts`: `reportsSourceIdentity` manifest → `source.identity` frame emitted before `asset.batch`; yield-before-report fails job `CONTRACT_VIOLATION`; unflagged manifest emits no frame.
- [X] T010 [P] [US1] Write failing hub test in `packages/backend/test/unit/remote-run-service.test.ts`: `onSourceIdentity` registers-or-matches, binds config, stamps `import_runs.sourceId`, reactivates `UNMONITORED`/`RETIRED` source to `ACTIVE`.

### Implementation for User Story 1

- [X] T011 [US1] Create `packages/backend/src/services/importer-source-service.ts`: `registerOrMatchSource(trx, importerName, identity)` (canonicalize → select-or-insert → `ACTIVE` + bind config + `importer_source` audit `created`/`bound`), `stampRunSource(trx, runId, sourceId)`, `deactivateSourceForConfig(trx, configId)` (→ `UNMONITORED` + audit).
- [X] T012 [US1] In `packages/backend/src/services/import-run-service.ts` worker: real `reportSourceIdentity` on context (calls T011 inside transaction), plus `resolveTarget` stub that throws (in-process runs); enforce `CONTRACT_VIOLATION` when `manifest.reportsSourceIdentity` and first asset arrives with no report (fail run `FAILED`).
- [X] T013 [US1] In `packages/agent/src/executor.ts`: `reportSourceIdentity` sends `source.identity` frame via `send()`; ordering enforcement — flag `reportsSourceIdentity` jobs and fail `CONTRACT_VIOLATION` on yield-before-report (surfaced as `run.complete{FAILED}`); `resolveTarget` placeholder wired in T027.
- [X] T014 [US1] In `packages/backend/src/services/remote-run-service.ts`: implement `onSourceIdentity(runId, payload)` → `registerOrMatchSource` + `stampRunSource` via the store seam; persist `sourceId` on the in-flight entry for reconciliation.

**Checkpoint**: US1 acceptance scenarios green end-to-end (in-process + remote).

---

## Phase 4: User Story 2 — Source-scoped reconciliation (P1)

**Goal**: Memberships become the reconciliation unit for adopting runs;
shared entities stay alive while any source reports them.

**Independent Test**: `test/integration/source-reconciliation.test.ts` —
two sources share a component; retire-one vs retire-last; incomplete run
retires nothing; empty adopting inventory deactivates all memberships.

### Tests for User Story 2

- [X] T015 [US2] Write failing integration test `packages/backend/test/integration/source-reconciliation.test.ts`: (a) two-source shared component — A's omitting run deactivates only A's memberships; (b) last source drops → `RETIRED`/`GONE`; (c) failed run → zero deactivations; (d) empty adopting inventory deactivates all its memberships; (e) manual/no-membership entities untouched; (f) instance-level sharing across sources.

### Implementation for User Story 2

- [X] T016 [US2] In `import-run-service.ts` `processAsset`: when `run.sourceId` set, upsert `source_component_memberships` + `source_instance_memberships` (`active=true`, `lastSeenInRunId`) in the same transaction; replace the per-component orphan sweep for adopting runs — deactivate this source's absent instance memberships on the touched component, then recompute `GONE` over the effective-active union (`active AND source.status != 'RETIRED'`); legacy path (sourceId NULL) unchanged.
- [X] T017 [US2] In `reconcileRetiredComponents` (`import-run-service.ts`): add source-scoped branch — on `COMPLETED` adopting run deactivate the source's absent component+instance memberships, evaluate `RETIRED`/`GONE` over the union, skip the empty-yield early-return for adopting runs; legacy `configId` path byte-identical.
- [X] T018 [US2] In `remote-run-service.ts`: thread `sourceId` through `RemoteJobContext`/`loadJob` and the `store.reconcile`/`store.processAsset` seam so remote runs get identical source-scoped behavior.

**Checkpoint**: US2 scenarios green; existing `import-reconciliation.test.ts` still passes verbatim (legacy path).

---

## Phase 5: User Story 3 — Config lifecycle decoupled from provenance (P2)

**Goal**: Config delete → `UNMONITORED` with history preserved; reattach →
`ACTIVE`; explicit reversible retire via API.

**Independent Test**: `importer-sources.test.ts` — delete config →
`UNMONITORED`, `/importer-sources/:id/runs` still lists runs with
`configId:null`; reattach → `ACTIVE`; retire/reactivate + 409/404.

### Tests for User Story 3

- [X] T019 [US3] Write failing integration tests in `importer-sources.test.ts`: config-delete cascade contract (source `UNMONITORED`, run `configId` NULL `sourceId` intact); reattach; `GET /importer-sources*` list/detail/runs; `POST retire/reactivate` happy paths + `409 SOURCE_STATE_CONFLICT` + `404 SOURCE_NOT_FOUND`; retire-side entity evaluation; RBAC (VIEWER 403 on mutations).

### Implementation for User Story 3

- [X] T020 [US3] In `importer-config-service.ts` `deleteImporterConfig`: add `deactivateSourceForConfig` to the same transaction (source → `UNMONITORED`, audit `unmonitored`).
- [X] T021 [US3] Extend `importer-source-service.ts`: `listSources`, `getSource` (boundConfig summary, `lastCompletedRunAt`, active membership counts), `listSourceRuns`, `retireSource` (status + retire-side entity evaluation per research D4, audit `retired`), `reactivateSource` (→ `ACTIVE`/`UNMONITORED`, audit `reactivated`).
- [X] T022 [US3] Create `packages/backend/src/routes/importer-sources.ts` (per contracts/source-api.md); register in `app.ts` AND `api-docs-contract.test.ts` import block + register loop; add `importer:source:retire`/`importer:source:reactivate` (ADMIN) to `plugins/rbac.ts`; add `SOURCE_NOT_FOUND`(404)/`SOURCE_STATE_CONFLICT`(409) to `ERROR_CODES`/`ERROR_TYPES` + `CODE_MEANINGS` in `generate-api-doc.ts`; add `namesFor` `"importer_source"` case in `audit-query-service.ts`; update `docs/openapi.yaml` and run `pnpm docs:api`.
- [X] T023 [P] [US3] Left-join fixes: `agent-service.ts` `listAgentRuns` config join + `dashboard-service.ts` FAILED_RUN join → `leftJoin` with null-tolerant labels; `ImportRun.configId: string | null` in `packages/frontend/src/api/types.ts`.

**Checkpoint**: US3 acceptance scenarios green; openapi contract test passes.

---

## Phase 6: User Story 4 — Generic agent target resolution (P2)

**Goal**: `targetRefKey` manifests get agent-local registry preflight —
fail-before-network on unknown/malformed/disallowed targets.

**Independent Test**: `packages/agent/test/executor.test.ts` — NACK
`TARGET_RESOLUTION_FAILED` for missing/corrupt registry, absent
`targetId`, missing scope key; resolved profile reaches `resolveTarget`.

### Tests for User Story 4

- [X] T024 [US4] Write failing agent tests in `executor.test.ts`: all NACK cases + happy path (profile resolved, `resolveTarget` returns it) + inert stray `targetId` on non-declaring manifest + agent stays ready post-NACK.
- [X] T025 [P] [US4] Write failing hub test in `remote-run-service.test.ts`: NACK prefix → run `FAILED/TARGET_RESOLUTION_FAILED` (not `AGENT_INCOMPATIBLE`); `jobGate` fails malformed `scope[targetRefKey]` before enqueue.

### Implementation for User Story 4

- [X] T026 [US4] Create `packages/core/src/utils/target-registry.ts` — Zod envelope schema (`{version:1, targets: Record<string, {transport: string, ...}>}`) + `parseTargetRegistry`; expose via node-only export path (precedent `@componode/core/secrets`).
- [X] T027 [US4] Create `packages/agent/src/target-registry.ts` — `loadTargetRegistry(secretsDir, importerName)` reads `{importerName}-targets.json` fresh per job, fail-closed on missing/corrupt; wire into `JobExecutor` deps (`client.ts` construction site); `resolveAndRun` preflight after `getImporter`: manifest `targetRefKey` → scope key must be non-empty string → registry lookup → NACK `TARGET_RESOLUTION_FAILED: <non-secret>` on any failure; real `resolveTarget` on job context returning the resolved profile.
- [X] T028 [US4] In `remote-run-service.ts`: add `TARGET_RESOLUTION_FAILED` branch to the `onJobAck` NACK mapping → run `FAILED`; add `jobGate`/`loadJob` check — `targetRefKey` declared but `scope[targetRefKey]` missing/non-string → fail `TARGET_RESOLUTION_FAILED` before enqueue.

**Checkpoint**: US4 acceptance scenarios green; protocol/docs consistent.

---

## Phase 7: User Story 5 — Legacy data untouched (P3)

**Goal**: Zero drift for non-adopting importers and pre-feature data.

**Independent Test**: existing suites pass verbatim; new assertions cover
`sourceId NULL` provenance.

- [X] T029 [US5] Extend `test/helpers/api.ts` `truncateImportTables` with the three new tables; add explicit assertions in `import-reconciliation.test.ts`/`import-runs.test.ts` that unattributed runs keep `sourceId NULL` and legacy config-scoped retirement is unchanged; render null-source runs as legacy/unattributed in `getRun`/`listSourceRuns` DTO surface.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: Ratification + docs + final verification.

- [X] T030 ADR amendments per research.md map: `## Amendment 1` on ADR-119 (API surface, effective-membership/retire semantics, `LEGACY_UNATTRIBUTED = sourceId NULL`); `## Amendment 6` on ADR-116 (protocol v3, `source.identity` frame, `TARGET_RESOLUTION_FAILED`, `<importerName>-targets.json` convention); `## Amendment 2` on ADR-056 (`targetRefKey` + `reportsSourceIdentity` manifest fields, in-process `resolveTarget` stub); `## Amendment 2` on ADR-054 (`importer:source:retire`/`importer:source:reactivate`); `**Amended by ADR-XXX**` back-pointers and `researches/architecture-decisions.md` index updates.
- [X] T031 [P] Docs sync: `docs/agent-protocol.md` (new frame + v3 + NACK), `docs/agents.md` + `docs/deployment.md` (`SECRETS_DIR` target-registry provisioning), `docs/importer-development.md` (`reportSourceIdentity`/`targetRefKey`/`reportsSourceIdentity` contract), `docs/roadmap.md` (044 under Shipped + Next revision).
- [X] T032 Final verification per quickstart.md: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in packages/{core,backend,agent,frontend}; `pnpm docs:api:check`; `pnpm audit --prod --audit-level=high`.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** sequential; both block all stories.
- **US1 → US2** sequential (membership writes need `run.sourceId`).
- **US3** after US2 (retire evaluation uses the effective-active union);
  T020 (config-delete hook) only needs US1's service — can be pulled
  forward if convenient.
- **US4** independent of US1–US3 except shared executor/protocol files —
  do after US1 to avoid same-file churn.
- **US5** verification layer — after US2.
- **Phase 8** last.

## Parallel Examples

```bash
# Phase 1 (different files):
T002 types.ts | T003 constants | T004 contracts

# US1 tests (all failing-first, different files):
T007 integration | T008 core unit | T009 agent executor | T010 remote-run unit

# Docs/polish:
T031 docs set can run while T030 ADR text is drafted
```

## Implementation Strategy

MVP = Phases 1–3 (source registration + attribution). US2 adds the
reconciliation payoff; US3/US4 are independent increments; US5 + Phase 8
close guarantees and governance. Commit per phase; keep `main`-green
behavior for legacy paths at every checkpoint.

## Phase 9: Convergence

- [X] T033 Restore the original `prevent_import_runs_terminal_modification` trigger function in migration 022 `down()` so rollback is symmetric per FR-005 (partial)
- [X] T034 Widen `packages/frontend/src/ux/lib/view-types.ts` `ImportRun.configId` to `string | null` for the nullable-FK contract per FR-005 (partial)
- [X] T035 Fold `source_instance_memberships`, `source_component_memberships`, `importer_sources` into `truncateImportTables`' `TRUNCATE ... CASCADE` so the `RESTRICT` FK on `import_runs.sourceId` can't break setup per US3/AC1 (partial)

## Phase 10: Review

- [X] T036 Fail remote `COMPLETED` runs from adopting importers that never sent `source.identity` as `CONTRACT_VIOLATION` instead of silently running legacy reconciliation per FR-002 (code-review: spec)
- [X] T037 Reject/ignore `source.identity` frames on jobs whose manifest does not declare `reportsSourceIdentity` so non-adopting importers stay config-scoped per FR-013 (code-review: spec)
- [X] T038 Fail agent-bound PENDING runs whose config was deleted while queued instead of leaving them stuck forever per FR-005 (code-review: spec + standards)
- [X] T039 Emit `bound`/`reactivated` entity changes from `registerOrMatchSource` on the re-match path per T011/SOURCE_AUDIT_ACTIONS (code-review: standards + spec)
- [X] T040 Break the circular dependency between `importer-source-service` and `import-run-service` by extracting the effective-active membership helpers to a shared module (code-review: standards)
- [X] T041 Route `onSourceIdentity` persistence through the injected `RemoteRunStore` seam per T014 (code-review: standards)
- [X] T042 Replace the hardcoded `"TARGET_RESOLUTION_FAILED:"` strings in `packages/agent/src/executor.ts` with `AGENT_NACK_TARGET_RESOLUTION_PREFIX` (code-review: standards)
- [X] T043 Update stale `protocolVersion: 2` text in `docs/agent-protocol.md` and `docs/architecture.md` for the v3 bump per T031 (code-review: standards)
- [X] T044 Make `registerOrMatchSource` insert race-safe (`ON CONFLICT DO NOTHING` + re-select) against concurrent reports on `UNIQUE(importerName, externalIdentity)` (code-review: standards)
- [X] T045 Fix `getSource` to query a single row without rollup work and without leaking the `boundConfigIdJoined` join column (code-review: standards + spec)
- [X] T046 Move the importer-source list query schema into `packages/core/src/schemas/importer-source.ts` per the route-boundary convention and plan (code-review: standards)
- [X] T047 Guard `registerOrMatchSource` against binding a config deleted between job-load and the identity frame (check existence or swallow FK violation gracefully) per FR-005 (code-review: spec)

## Phase 11: Review (round 2)

- [X] T048 Gate the in-process `reportSourceIdentity` on `manifest.reportsSourceIdentity` so non-adopting importers stay config-scoped per FR-013 (code-review: spec + standards)
- [X] T049 Guard `onSourceIdentity` against duplicate `source.identity` frames so a second report can't re-stamp `import_runs.sourceId` mid-run (code-review: spec + standards)
- [X] T050 Strip the `boundConfigLabel` join alias from the `getSource` API response (code-review: standards + spec)
- [X] T051 Track the in-flight source-identity report promise and await it before CONTRACT_VIOLATION checks so unawaited importer reports aren't falsely flagged (code-review: spec)
- [X] T052 Make source status follow the binding — a Source reported by a just-deleted config is `UNMONITORED`, not `ACTIVE` (code-review: spec)
- [X] T053 Extract shared `recordRunSourceIdentity` and compute `bound`/`reactivated` transitions from guarded UPDATEs to prevent concurrent double-audit (code-review: standards)

## Phase 12: Review (round 3)

- [X] T054 Finalize the committed run row FAILED before throwing `AGENT_UNAVAILABLE` on a missing remote dispatcher so no PENDING orphan blocks future runs (code-review: standards)
- [X] T055 Emit `unmonitored` audit on any status transition to `UNMONITORED` during re-match so RETIRED→UNMONITORED isn't unaudited (code-review: standards)
- [X] T056 Add the `entry.state === "RUNNING"` guard to `onSourceIdentity` matching sibling stream handlers (code-review: standards + spec)
- [X] T057 Attach a handled-rejection log branch to `sourceReportPromise` so abort-before-check can't produce an unobserved rejection (code-review: standards)
- [X] T058 Extract `markOrphanedInstancesGone` shared by per-asset phase-1, run reconciliation, and retire-side evaluation (code-review: standards)
- [X] T059 Enforce the wire identity bounds (`min(1).max(512)` externalIdentity, `max(200)` label) in `registerOrMatchSource` so in-process reports can't persist invalid identities; report CONTRACT_VIOLATION (code-review: spec)
- [X] T060 Skip the `bound` audit event when the transition clears the binding to null — the `unmonitored` status event covers it (code-review: spec)
- [X] T061 Record the FR-006 per-source `details` Wave B follow-up in the tracking doc so the deferral doesn't silently become permanent (code-review: spec)
