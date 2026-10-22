---
description: "Task list for Remote Import Execution (spec 027)"
---

# Tasks: Remote Import Execution

**Input**: Design documents from `/specs/027-remote-import-execution/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — constitution VI (test-first) is non-negotiable. Write
each test task BEFORE the implementation task that satisfies it.

**Organization**: Phases 1–2 are shared infrastructure; each story phase is
an independently testable slice.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: migration, constants, contracts — the surfaces every story
reads from.

- [X] T001 [P] Create migration `packages/backend/src/db/migrations/018_remote_run_agent.ts`: `import_runs.agentId` `uuid` NULLABLE (**no FK** — run rows are history, per data-model.md) + index `import_runs_agent_idx`; register in the migrator; add `agentId: string | null` to `ImportRunRow` in `packages/backend/src/db/types.ts`
- [X] T002 [P] Add `AGENT_LOST`, `AGENT_UNAVAILABLE`, `AGENT_INCOMPATIBLE`, `ASSET_TOO_LARGE` to `ERROR_CODES` in `packages/core/src/constants/error-codes.ts`; add `AGENT_DISPATCH_TIMEOUT_MS = 600_000` and `AGENT_JOB_ACK_TIMEOUT_MS = 15_000` to `packages/core/src/constants/import-agent.ts`
- [X] T003 [P] Promote the seven job frames from `FUTURE_AGENT_MESSAGE_TYPES` to strict Zod schemas in `packages/core/src/contracts/agent-protocol.ts` per `contracts/agent-protocol.md`: `job.assign{importerName,scope,secretRefMap?}`, `job.ack{accepted,reason?}`, `asset.batch{assets[]}`, `phase{name≤200}`, `run.error{assetExternalId?,errorType,errorMessage}`, `run.complete{result:"COMPLETED"|"CANCELLED"|"FAILED",errorType?,errorMessage?}`, `cancel{runId}`
- [X] T004 [P] Extend core contracts in `packages/core/src/contracts/`: `import-run.ts` +`agentId`,`agentName`; `importer-config.ts` +`agentId`,`agent`,`agentIncompatible`; `import-agent.ts` +`runningJobs`,`activeRuns[]` + bound-config/run row types; `dashboard` attention kind union +`OFFLINE_AGENT`; mirror in `packages/frontend/src/api/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the dispatch seam + shared run internals every remote-run
story needs. No story work begins until this phase is complete.

- [X] T005 [P] Write failing unit test `packages/backend/test/unit/remote-run-service.test.ts`: `enqueue` on offline agent leaves run queued; `onSessionLost` fails in-flight runs `AGENT_LOST` while queued runs survive
- [X] T006 Create `packages/backend/src/services/remote-run-service.ts`: `RemoteRunService` class owning `pendingByAgent`/`inFlight`/`dispatchDeadline` maps (data-model.md), `RemoteRunHandler` interface (research R1), `enqueue`/`tryDispatch`/`cancelRemoteRun`/`activeRunsForAgent`/`runningJobCounts`, `envInt` parsing for `AGENT_DISPATCH_TIMEOUT_MS`/`AGENT_JOB_ACK_TIMEOUT_MS`; frame methods stubbed for story phases
- [X] T007 Extend `packages/backend/src/services/agent-session-service.ts`: `setRunHandler(RemoteRunHandler)`; route `job.ack`/`asset.batch`/`phase`/`run.complete`/`run.error` to the handler (envelope `runId` required — missing → BAD_FRAME + close); `closeSession` calls `onSessionLost`; expose narrow `sendToAgent(agentId,type,payload)` + `getSession(agentId)`; keep `credential.test` path untouched; wire `remoteRuns` + `setRunHandler` in `packages/backend/src/app.ts` and decorate `app.remoteRuns`
- [X] T008 In `packages/backend/src/services/import-run-service.ts`: export shared helpers (`processAsset`,`insertRunError`,`updateRun`,`reconcileRetiredComponents`,`runActor`,`createRunLogger`); `startRun` loads the config, stamps `import_runs.agentId`, branches bound→`remoteRuns.enqueue(runId)` vs unbound→existing `queue.add`; inject the dispatcher via a module seam `setRemoteRunDispatcher()` wired in `app.ts`; `cancelRun` branches to `remoteRuns.cancelRemoteRun(runId)` when `run.agentId` is set
- [X] T009 [P] Write failing unit test + implement `packages/backend/src/services/recovery-service.ts` branch: non-terminal runs with `agentId IS NOT NULL` → `FAILED`/`errorType:"AGENT_LOST"` (cancel-requested → `CANCELLED`); in-process rows keep `INTERRUPTED`

**Checkpoint**: dispatch seam exists; binding (US1) can start independently.

---

## Phase 3: User Story 1 — Bind a config to an agent (Priority: P1) 🎯 MVP

**Goal**: Execution selector persists `importer_configs.agentId` with
save-time rejection of every invalid binding.

**Independent Test**: `pnpm --filter @componode/backend test` —
`config-agent-binding.test.ts` green; UI selector round-trips a binding.

### Tests for User Story 1

> Write FIRST, confirm they FAIL before implementation.

- [X] T010 [P] [US1] Integration test `packages/backend/test/integration/config-agent-binding.test.ts`: bind→save→`agent` summary on response; unknown agentId→`404 AGENT_NOT_FOUND`; revoked agent→`400 AGENT_INCOMPATIBLE`; `allowedImporters` missing importer→`400 AGENT_INCOMPATIBLE` (empty set = all pass); STORED cred on agent-bound config→`CREDENTIAL_KIND_MISMATCH`; AGENT_MANAGED cred on hub config→`CREDENTIAL_KIND_MISMATCH`; switch executor→credential revalidation uses effective pair; unbind (`agentId:null`)→in-process restored
- [X] T011 [P] [US1] Unit test `packages/backend/test/unit/agent-assignable.test.ts` for `assertAgentAssignable` decision table

### Implementation for User Story 1

- [X] T012 [US1] Add `agentId: z.string().uuid().nullable().optional()` to `createImporterConfigSchema`/`updateImporterConfigSchema` in `packages/core/src/schemas/importer-config.ts`
- [X] T013 [US1] In `packages/backend/src/services/importer-config-service.ts`: `assertAgentAssignable(trx,agentId,importerName)` (exists→`AGENT_NOT_FOUND` 404; `revokedAt`→`AGENT_INCOMPATIBLE` 400; non-empty `allowedImporters` missing importer→`AGENT_INCOMPATIBLE` 400; messages name agent+importer); call on create/update when `agentId` set; re-run `validateSecretSources` with the **effective** agentId when `agentId` OR junction changed; join `import_agents` → `agent:{id,name,status}|null` + derived `agentIncompatible` (`revokedAt != null || (allowedImporters.length>0 && !includes(importerName))`) on list/detail responses
- [X] T014 [US1] Frontend `packages/frontend/src/components/importer-config-form.tsx`: framework-level **Execution** select (`This hub (in-process)` default | `Agent: <name>`) above the credential selector; agents fetched via `useAgents`; options disabled when `allowedImporters` misses the importer or agent revoked; inline warn when selected agent offline; agent option disabled + `/agents` hint when zero agents; selecting agent filters credential list to `AGENT_MANAGED` + helper copy "Resolved on the agent"; payload sends `agentId`

**Checkpoint**: `config-agent-binding.test.ts` green; form binds/unbinds.

---

## Phase 4: User Story 2 — Remote run executes (Priority: P1)

**Goal**: bound config → PENDING+agentId → `job.assign` → `job.ack` →
RUNNING → `asset.batch` → identical upsert/reconcile/suggestions →
`run.complete` → COMPLETED.

**Independent Test**: integration `remote-run.test.ts` — real `ws` fake
agent acks and streams fixture assets; catalog outcome = in-process parity.

### Tests for User Story 2

- [X] T015 [P] [US2] Integration test `packages/backend/test/integration/remote-run.test.ts` (extend the `connectAgent` ws pattern from `credential-test-remote.test.ts`): bound config trigger→`job.assign` received w/ runId+importerName+scope+`secretRefMap`(names only); fake agent `job.ack{accepted:true}`→RUNNING; `asset.batch`→assets upserted+counts; invalid asset→`VALIDATION_FAILED` error row; `phase`→`currentPhase`; `run.complete{COMPLETED}`→reconciliation+suggestions identical to in-process; `agentId`/`agentName` on run payload; `credentialIds`+`lastUsedAt` stamped
- [X] T016 [P] [US2] Integration test `packages/backend/test/integration/remote-run-capacity.test.ts`: `maxConcurrentJobs=1` agent gets a 2nd queued run's `job.assign` only after the 1st completes; scheduled-bound path calls the same branch (invoke `startRun` as scheduler does)
- [X] T017 [P] [US2] Agent unit test `packages/agent/test/executor.test.ts`: resolve ref map→run generator→batches flushed at 100-asset boundary; `reportPhase`→`phase` frames; end→`run.complete{COMPLETED}`; resolved values never in any sent frame
- [X] T018 [P] [US2] Agent unit test `packages/agent/test/job-assign.test.ts`: `job.assign` handling — capacity-full NACK; unknown-importer NACK `AGENT_INCOMPATIBLE` reason; ok→`job.ack{accepted:true}`+job starts

### Implementation for User Story 2

- [X] T019 [US2] `remote-run-service.ts` dispatch path: `enqueue` stamps dispatch deadline (`AGENT_DISPATCH_TIMEOUT_MS`); `tryDispatch` shifts FIFO→`job.assign`→`ASSIGNED`+ack timer (`AGENT_JOB_ACK_TIMEOUT_MS`); `handleJobAck`→`RUNNING`(startedAt,`currentPhase`)/NACK→`FAILED AGENT_INCOMPATIBLE` w/ echoed reason (`SECRET_RESOLUTION_FAILED` reason → `FAILED` w/ that errorType, research R11); `handleAssetBatch`→shared `validateDiscoveredAssetDetailed`+`processAsset`+counters+`agent_assets_received_total{agent,importer}`; `handlePhase`→`currentPhase`; `handleRunError`→`insertRunError`; `handleRunComplete`→finalize (reconcile+suggestions on COMPLETED; counters; `agent_jobs_total{agent,result}`); stamp `credentialIds`+`lastUsedAt` from linked `AGENT_MANAGED` creds; frames for unknown/dead runId → warn+ignore; frames for unassigned run on that session → BAD_FRAME+close
- [X] T020 [US2] Create `packages/agent/src/executor.ts`: `JobExecutor` w/ `activeJobs: Map<runId,{controller,importerName}>`; `handleJobAssign` — capacity+compiled check→NACK, else `job.ack`→resolve `secretRefMap` via `resolveRefMap`→run `importer.run(scope,secrets,ctx)` (`ctx.runId`, `signal`=job AbortController, `reportPhase`→`phase` frame, `logger`=runId-bound); batch flush at 100 assets or ~1 MB serialized; single asset >1 MB→`run.error{ASSET_TOO_LARGE}`+continue; generator end→`run.complete{COMPLETED}`; throw→`run.complete{FAILED}` w/ `maskSecretValues`; abort→`run.complete{CANCELLED}`; resolution failure pre-ack→`job.ack{accepted:false,reason:"SECRET_RESOLUTION_FAILED: <key+source>"}`; real `currentJobs`/`activeRunIds` in heartbeat
- [X] T021 [US2] Wire `job.assign`/`cancel` handling into `packages/agent/src/client.ts` `runSession` (delegate to `JobExecutor`; session close→abort all jobs); update `docs/agent-protocol.md` is deferred to polish

**Checkpoint**: `remote-run.test.ts` green — a remote run is indistinguishable
from in-process in outcome.

---

## Phase 5: User Story 3 — Named, bounded failures (Priority: P1)

**Goal**: offline/timeout → `AGENT_UNAVAILABLE`; NACK → `AGENT_INCOMPATIBLE`;
disconnect/hub-restart → `AGENT_LOST`; oversized asset → `ASSET_TOO_LARGE`;
nothing hangs.

**Independent Test**: `remote-run-failures.test.ts` — each matrix row reaches
the named terminal state in bounded time.

### Tests for User Story 3

- [X] T022 [P] [US3] Integration test `packages/backend/test/integration/remote-run-failures.test.ts`: offline-agent run→`FAILED`/`AGENT_UNAVAILABLE` after `AGENT_DISPATCH_TIMEOUT_MS` (env-shrunk); agent NACK→`AGENT_INCOMPATIBLE`+echoed reason; `SECRET_RESOLUTION_FAILED` NACK→`FAILED` w/ that type not `AGENT_INCOMPATIBLE`; no-ack→`AGENT_UNAVAILABLE`; ws close mid-run→`AGENT_LOST`+in-flight count drains; `run.error{ASSET_TOO_LARGE}`→run-error row+run continues; late batch after terminal→ignored; frame for unassigned runId→BAD_FRAME close; app restart w/ RUNNING remote run→`FAILED`/`AGENT_LOST` on boot
- [X] T023 [P] [US3] Agent unit test `packages/agent/test/executor-failures.test.ts`: resolution failure→NACK `SECRET_RESOLUTION_FAILED` naming key+source (never value); oversize single asset→`run.error`+continue; generator throw→`run.complete{FAILED}` masked

### Implementation for User Story 3

- [X] T024 [US3] Complete `remote-run-service.ts` failure paths: dispatch-deadline expiry→`FAILED`/`AGENT_UNAVAILABLE`; ack-timer expiry→same; `onSessionLost`→in-flight `FAILED`/`AGENT_LOST`+metrics (queued runs survive); terminal-cleanup helper (clear timers, drop maps, `agent_jobs_total` inc exactly once); revoked-agent fast-fail in `enqueue` (`revokedAt`→immediate `AGENT_UNAVAILABLE`, no wait)
- [X] T025 [US3] Agent-side failure emission in `executor.ts`/`client.ts` (mostly landed with T020 — verify matrix coverage; add `ASSET_TOO_LARGE` pre-send size check)

**Checkpoint**: full failure matrix green; SC-003/SC-005 provable.

---

## Phase 6: User Story 4 — Cancel a remote run (Priority: P2)

**Goal**: cancel → `cancelRequestedAt` + `cancel` frame → agent abort →
`run.complete{CANCELLED}`; pending-remote cancels instantly.

**Independent Test**: cancel integration cases green.

### Tests for User Story 4

- [X] T026 [P] [US4] Integration test `packages/backend/test/integration/remote-run-cancel.test.ts`: queued-remote cancel→`CANCELLED`+never dispatched; running cancel→`cancel` frame received by agent→`run.complete{CANCELLED}`→`CANCELLED`; post-cancel `asset.batch`→discarded; agent dies before confirming→`AGENT_LOST` (not limbo)
- [X] T027 [P] [US4] Agent unit test (extend `executor.test.ts`): `cancel` frame→job AbortController aborts→`run.complete{CANCELLED}` sent before session teardown

### Implementation for User Story 4

- [X] T028 [US4] `remote-run-service.cancelRemoteRun(runId)`: queued→dequeue+`CANCELLED`; `ASSIGNED`/`ACKED`→`cancel` frame via `sendToAgent` (cancelRequestedAt already stamped by `cancelRun`); dead-run frames→discard path verified; disconnect-before-confirm→`AGENT_LOST` via `onSessionLost`
- [X] T029 [US4] `executor.ts`/`client.ts`: `cancel` frame→`activeJobs.get(runId).controller.abort()`; unknown runId→ignore

**Checkpoint**: cancel matrix green.

---

## Phase 7: User Story 5 — Executor visibility (Priority: P2)

**Goal**: "Ran on agent X" / "Waiting for agent X" / "Runs on: X" /
in-flight jobs / `OFFLINE_AGENT` attention item.

**Independent Test**: endpoint integration tests + manual page pass.

### Tests for User Story 5

- [X] T030 [P] [US5] Integration test `packages/backend/test/integration/agent-runs-surface.test.ts`: `GET /agents/:id/configs` bound list w/ `agentIncompatible`; `GET /agents/:id/runs` recent runs; `GET /agents/:id`→`activeRuns` from in-flight map; `GET /agents`→`runningJobs`; dashboard `attention[]` gains `OFFLINE_AGENT` for offline+bound agent
- [X] T031 [P] [US5] Integration test `packages/backend/test/integration/run-executor-fields.test.ts`: run payload carries `agentId`+`agentName`; `agentName` survives agent deletion (name join tolerates missing row → null)

### Implementation for User Story 5

- [X] T032 [US5] `packages/backend/src/services/agent-service.ts`: `listAgentConfigs(id)` (bound configs + `agentIncompatible`), `listAgentRuns(id,limit=50)`; `getAgent` +`activeRuns` (via injected dispatcher — extend the `AgentSessionDropper`-style seam or read `app.remoteRuns` at route layer); `listAgents` +`runningJobs`
- [X] T033 [US5] `packages/backend/src/routes/agents.ts`: `GET /agents/:id/configs`, `GET /agents/:id/runs` (`agent:read`); `import-run-service`/`dashboard-service`: run payload `agentId`+`agentName` join; `OFFLINE_AGENT` attention item (status OFFLINE + `boundConfigCount>0`, label name, href `/agents/{id}`)
- [X] T034 [US5] Frontend `packages/frontend/src/api/hooks/agents.ts` +`useAgentConfigs`,`useAgentRuns`; `pages/agent-detail.tsx` tabs `overview|configs|runs|history` (history = sessions) + in-flight jobs block on overview; `pages/agents.tsx` running-jobs column
- [X] T035 [US5] Frontend `pages/importer-run.tsx` executor line ("Ran on agent `<name>`" link w/ `agent:read`, plain text otherwise / "In-process"; PENDING+agentId→"Waiting for agent `<name>`"); `pages/importers.tsx` config card "Runs on: `<agent>`" + offline/incompatible warning badge; `pages/dashboard.tsx` `OFFLINE_AGENT` attention rendering

**Checkpoint**: executor is answerable from UI surfaces alone (SC-006).

---

## Phase 8: User Story 6 — Capability policy drift (Priority: P3)

**Goal**: `allowedImporters` edits/version drift → bound configs flagged;
next runs fail fast; revoked-agent configs fail fast.

**Independent Test**: `config-drift.test.ts` green.

### Tests for User Story 6

- [X] T036 [P] [US6] Integration test `packages/backend/test/integration/config-drift.test.ts`: narrow `allowedImporters` post-binding→config `agentIncompatible:true`+next run fails fast `AGENT_INCOMPATIBLE`; in-flight run unaffected by mid-flight edit; revoked-agent bound config run→immediate `AGENT_UNAVAILABLE` (no dispatch wait)

### Implementation for User Story 6

- [X] T037 [US6] `remote-run-service.enqueue`/`tryDispatch` hard gate: importer ∉ non-empty `allowedImporters`→fail fast `AGENT_INCOMPATIBLE`; `revokedAt`→fail fast `AGENT_UNAVAILABLE`; `updateAgent` in `agent-service.ts`—after `allowedImporters` update, no extra persistence needed (flag is read-time derived) but ensure the flag join covers `GET /agents/:id/configs` + config list/detail

**Checkpoint**: drift matrix green.

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: contracts/docs ratified surfaces + repo gates.

- [X] T038 [P] `docs/agent-protocol.md`: replace "Reserved types (027)" with the full job section (payloads, ordering, bounds, failure matrix, timeout constants) per `contracts/agent-protocol.md`
- [X] T039 [P] `docs/agents.md`: remote-execution section — `job.assign` contents, capacity/`MAX_JOBS`, `AGENT_DISPATCH_TIMEOUT_MS`/`AGENT_JOB_ACK_TIMEOUT_MS` hub overrides, failure table, "no resume" + cancel semantics; `docs/ux.md` Execution selector + badges + attention item; verify `CONTEXT.md` needs no new terms
- [X] T040 [P] `docs/openapi.yaml`: config `agentId`/`agent`/`agentIncompatible` fields, `GET /agents/:id/configs` + `/agents/:id/runs`, agent `activeRuns`/`runningJobs`, run `agentId`/`agentName`, `OFFLINE_AGENT` kind, new error codes; regen `docs/api.md` via `pnpm docs:api`
- [X] T041 ADR-116 **Amendment 2**: job frame payloads (R3), `AGENT_DISPATCH_TIMEOUT_MS`/`AGENT_JOB_ACK_TIMEOUT_MS` env vars (R4), NACK reason→errorType mapping (R7/R11), new agent endpoints + response fields (R10), `OFFLINE_AGENT` attention kind; add `**Amended by**` back-pointers where touched + update `researches/architecture-decisions.md` amends list
- [X] T042 [P] Metrics assertions in tests: `agent_jobs_total{agent,result}`, `agent_assets_received_total{agent,importer}` (prom-client registry read in integration test)
- [ ] T043 Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; run `quickstart.md` validation; update `docs/roadmap.md` (mark 027 shipped, revise Next)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — all [P]
- **Foundational (Phase 2)**: depends on T001–T004 — BLOCKS all stories
- **US1 (Phase 3)**: depends on Phase 1 only — can parallel with Phase 2 if staffed
- **US2 (Phase 4)**: depends on Phase 2 — the dispatch spine
- **US3 (Phase 5)**: builds on US2's dispatcher; failure paths can't precede the happy path
- **US4 (Phase 6)**: needs US2's running-run state
- **US5 (Phase 7)**: needs US2's in-flight map; endpoints/frontend mostly parallel-safe
- **US6 (Phase 8)**: needs US1 binding + US2 dispatch gate
- **Polish (Phase 9)**: after all stories

### Parallel Opportunities

- T001–T004 all parallel (different files)
- T010/T011, T015–T018, T022/T023, T026/T027, T030/T031, T036 test batches
- T034/T035 (agent pages vs run/config/dashboard pages — different files)
- T038–T040, T042 docs/metrics tasks

## Implementation Strategy

### MVP First

Phase 1 → Phase 2 → US1 + US2 = a config binds and executes remotely. US3
is the same P1 slice's failure half — MVP-complete only after it lands.

### Incremental Delivery

US1+US2+US3 (P1 core) → US4/US5 (P2 ops) → US6 (P3 drift) → polish.

---

## Phase 10: Convergence

- [X] T044 [US5] Gate agent-name links on `agent:read` (ADMIN) per FR-023, US5/AC1, edge-case "non-admin views a run or config with an executor → plain text": `pages/importer-run.tsx` executor line (`Waiting for agent`/`Ran on agent`), `pages/importers.tsx` config card `Runs on:`, and `pages/dashboard.tsx` `OFFLINE_AGENT` attention href — link only when `useSession().user.role === "ADMIN"`, plain text otherwise (missing)

---

## Phase 11: Review

- [X] T045 [US3] Zombie-job cascade (`code-review: spec`): `onAckTimeout` (and any hub-side finalize of a live job) must best-effort `sendToAgent(agentId,"cancel")` so the agent aborts work the hub abandoned; add a bounded dead-run registry (`deadRuns: Map<runId,agentId>`, ~512-entry FIFO eviction, populated in `finalize`/`failQueuedRun` paths that had dispatched) — `RemoteRunHandler` gains `isDeadRun(agentId,runId)` and `agent-session-service` ignores (warn-log) job frames for dead runs instead of BAD_FRAME+close, keeping strict-close only for never-assigned runIds (edge case "late batches after cancel or disconnect → discarded, never resurrected")
- [X] T046 [US2] Revoked credentials parity (`code-review: standards`): `loadJob` selects `cred.status` but never filters — a linked `AGENT_MANAGED` credential revoked after binding must fail the run fast at dispatch with `errorType CREDENTIAL_REVOKED` (parity with in-process `resolveImportSecrets` → `CREDENTIAL_REVOKED`), not merge its `secretRefMap` and stamp `lastUsedAt`
- [X] T047 [US1] Legacy secretRefs on bound configs (`code-review: spec` + `code-review: standards`): `validateSecretSources` counts env/file `secretRefs` toward coverage for bound configs but `loadJob` only ships credential `secretRefMap`s — reject non-empty `secretRefs` when `agentId` set (`CREDENTIAL_KIND_MISMATCH`); fix `convertLegacySecrets` for bound configs to create an `AGENT_MANAGED` credential carrying the refs verbatim (no resolution — values resolve on the agent) instead of a `STORED` credential that bypasses kind rules
- [X] T048 [US4] Cancel lost in pre-ack window + completed-after-cancel (`code-review: spec`): `JobExecutor.handleJobAssign` registers `activeJobs` only after `getImporter`/`resolveRefMap` — register the job (with its AbortController) before awaiting so `handleCancel` finds it; after resolution, if the signal is already aborted, ack + immediately `run.complete{CANCELLED}` without running. Hub-side: track `cancelRequested` on the in-flight entry (set in `cancelRemoteRun`) and finalize `COMPLETED`-after-cancel as `CANCELLED` (in-process parity — `import-run-service` maps `cancelRequestedAt` → `CANCELLED`)
- [X] T049 [US4] Bound the cancel confirmation (`code-review: spec` + `code-review: standards`): `cancelRemoteRun` ignores `sendToAgent`'s return and waits unbounded for `run.complete{CANCELLED}` — log a failed send, and arm a confirm deadline (reuse `AGENT_JOB_ACK_TIMEOUT_MS`) on in-flight entries whose expiry finalizes `AGENT_LOST` (SC-003/SC-007)
- [X] T050 [US2] Manifest required-secret coverage on the remote path (`code-review: standards`): `loadJob` must check merged `secretRefMap` keys cover `manifest.secrets` required declarations (same `assertSecretCoverage` the in-process worker runs) — fail the run fast with `errorType CREDENTIAL_MISSING_KEY` instead of letting a missing key surface as a mid-run importer failure
- [X] T051 [US6] De-duplicate the dispatch gate (`code-review: standards`): extract the identical revoked→`AGENT_UNAVAILABLE` / `allowedImporters`→`AGENT_INCOMPATIBLE` block copied in `enqueue` and `tryDispatch` into one `gateJob` helper; hoist the identical `envInt` (also in `agent-session-service.ts`) into a shared util
- [X] T052 [US3] Tighten frame state gates (`code-review: spec`): `onRunError`/`onRunComplete` accept `ASSIGNED`-state entries though the contract restricts job frames to "only while ACKED" — require `state==="RUNNING"` (well-behaved agents always ack first; serial ordering guarantees the transition)
- [X] T053 [US4] Stale-dispatch race (`code-review: spec`): a cancel interleaving after `loadJob` in `tryDispatch` still sends `job.assign`; the ack's `updateRun` then hits the terminal-immutability trigger → make the `PENDING→RUNNING` update conditional (`where status='PENDING'`, check affected rows — 0 → treat as dead run: cancel + ignore)
- [X] T054 [US5] Run-list waiting label (`code-review: spec`): FR-018/US5-2 require "Waiting for agent `<name>`" in run *lists* too — `importers.tsx` runs table Phase cell shows `run.currentPhase` only; render the waiting label for `PENDING`+`agentId` rows (plain text name for non-ADMIN per T044)
- [X] T055 Cleanup cluster (`code-review: standards` + `code-review: spec`): fail closed in `import-run-service.startRun`/`cancelRun` when `config.agentId` is set but `remoteDispatcher` is null (currently stamps `agentId` then runs in-process, which cannot resolve `AGENT_MANAGED` creds); remove dead `isQueued()` and the `uuidv7` re-export from `remote-run-service.ts`; fix `runLogger` severity map (`error→error`, `debug→debug` — check `AgentLog` levels) and drop unused `ActiveJob.importerName`; map agent capacity NACK (`reason` prefix `AGENT_UNAVAILABLE`) to `AGENT_UNAVAILABLE` not `AGENT_INCOMPATIBLE`; drop redundant `state === "RUNNING" ? "RUNNING" : "ASSIGNED"` ternary in `activeRunsForAgent`; align `listAgentRuns` `createdAt` serialization with siblings

---

## Phase 12: Review (round 2)

- [X] T056 [US4] Pre-enqueue cancel dropped (`code-review: spec` + `code-review: standards`): a cancel landing between `startRun`'s row-commit and `enqueue`'s `queuedJobs.set` was lost — `loadJob` now selects `cancelRequestedAt` and `enqueue`/`tryDispatch` finalize CANCELLED before any dispatch (in-process parity — the worker honors `cancelRequestedAt`)
- [X] T057 [US2] Mid-batch finalization holes (`code-review: spec` + `code-review: standards`): `onAssetBatch` liveness check moved inside the per-asset loop (up to ~100 upserts could land on a terminal row); post-`reconcile` guard added in `onRunComplete`; post-`markRunRunning` guard added before the `currentPhase` write in `onJobAck`
- [X] T058 [US3] `onSessionLost` fault isolation (`code-review: spec`): each entry's `finalize` wrapped in try/catch — a terminal-write race on one run must not leave the agent's other in-flight runs RUNNING forever (SC-003)
- [X] T059 [US1] `convertLegacySecrets` collision gap (`code-review: standards`): bound-config conversion now runs `checkKeyCollisions` against existing linked credentials before creating the AGENT_MANAGED credential and junction row
- [X] T060 Cleanup cluster (`code-review: standards` + `code-review: spec`): `AGENT_NACK_UNAVAILABLE_PREFIX` hoisted to `constants/import-agent.ts` (shared by executor emit + hub parse); capacity NACK records `agent_jobs_total{result:"unavailable"}` (was "failed"); executor cancel-wins ordering in importer-lookup/secret-resolution failure paths (ack+CANCELLED instead of NACK when aborted); warn-log ignored `job.ack` from a non-owning session; `onDispatchTimeout` message reworded; `resolveRefMap` doc comment generalized; `failQueuedRun`/`finalizeQueuedCancelled` tolerate concurrent terminal writes; session.test heartbeat flake fixed via configurable `autoEndDelayMs`

---

## Phase 13: Review (round 3)

- [X] T061 [US4] NACK-after-cancel asymmetry (`code-review: spec` + `code-review: standards`): a refusal (`job.ack{accepted:false}`) landing after a cancel request finalized FAILED/AGENT_INCOMPATIBLE — `onJobAck` now checks `entry.cancelRequested` first and finalizes CANCELLED, matching the completed-after-cancel mapping and US4-1 (unit test added)
- [X] T062 [US1] `convertLegacySecrets` asymmetric collision check (`code-review: standards`): the STORED (unbound) branch never ran `checkKeyCollisions` — linked-credential query + check hoisted above the `agentId` branch so both conversion paths enforce the collision rule
- [X] T063 [US4] Cancel-mid-reconcile + TOCTOU tail writes (`code-review: standards` + `code-review: spec`): `onRunComplete` re-checks `entry.cancelRequested` after the post-reconcile liveness guard (cancel landing during reconcile finalizes CANCELLED per ADR-116 Amend-2); `onAssetBatch` counter write, `onPhase` write, and `onJobAck` phase write wrapped in try/catch — an off-queue finalize racing the UPDATE is tolerated, not surfaced as an unhandled error
- [X] T064 Cleanup cluster (`code-review: standards` + `code-review: spec`): `dequeue(agentId,runId)` now owns both queue maps (splice `pendingByAgent` + delete `queuedJobs` + clear deadline — was Mysterious Name with callers splicing separately); empty queue entries removed after dispatch; duplicate `job.ack` on an owned RUNNING run returns handled + accurate "duplicate" warn instead of the session layer's misleading "not owned" warn; `enqueue` early-outs on `runStatus !== "PENDING"`
