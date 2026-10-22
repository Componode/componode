# Tasks: Agent Operations Observability

**Input**: Design documents from `/specs/028-agent-operations-observability/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — constitution VI is non-negotiable: failing test →
implement → refactor. Test tasks precede implementation in each phase.

**Organization**: Tasks grouped by user story; US1/US2 both P1 per spec.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Add `prom-client` to `packages/agent` via `pnpm --filter @componode/agent add prom-client@^15` (match backend's version family; commit `pnpm-lock.yaml` together)

---

## Phase 2: Foundational (Blocking Prerequisites)

Shared contract/schema/counter registry that US1 and US2 both build on.

- [x] T002 Add strict `ops` object (optional) to `heartbeatPayloadSchema` in `packages/core/src/contracts/agent-protocol.ts` — fields per data-model.md (`reportedAt` ISO `.datetime()`, `uptimeSeconds`/`activeJobs`/`assetsStreamed`/`secretResolutionFailures`/`reconnects` int≥0, `jobs.{assigned,completed,failed,cancelled}` int≥0, `credentialTests.{dispatched,succeeded,failed}` int≥0); export `AgentOpsSnapshot` inferred type from `packages/core/src/index.ts`
- [x] T003 Bump `AGENT_PROTOCOL_VERSION` in `packages/core/src/constants/import-agent.ts` (additive wire change — research D4)
- [x] T004 [P] Add `AgentReportedStatus` contract type in `packages/core/src/contracts/import-agent.ts` (mirrors stored snapshot incl. hub-stamped `receivedAt`) and add `reportedStatus`, `lastHeartbeatAt`, `lastDisconnectReason` fields to the `ImportAgent` API contract; export from index
- [x] T005 Create migration `packages/backend/src/db/migrations/019_agent_ops_observability.ts` — `import_agents` gains nullable `"reportedStatus" jsonb`; register in the migrations index and add the field to `ImportAgentRow` in `packages/backend/src/db/types.ts`
- [x] T006 Create `packages/agent/src/metrics.ts` — prom-client registry with the agent-local series (research D7): `agent_stream_connected` gauge, `agent_sessions_total{reason}`, `agent_reconnects_total`, `agent_jobs_received_total`, `agent_jobs_completed_total{result}`, `agent_jobs_active` gauge, `agent_assets_streamed_total{importer}`, `agent_credential_tests_total{result}`, `agent_secret_resolution_failures_total`, `collectDefaultMetrics()`; expose a `snapshot()` helper producing the `ops` object

**Checkpoint**: contract + schema + counter registry ready — story work begins

---

## Phase 3: User Story 1 — Operator observes the agent process locally (P1) 🎯 MVP

**Goal**: Agent exposes `/healthz`, `/readyz`, `/metrics` on a configurable
listener; container image healthchecks itself.

**Independent Test**: run the agent → `curl :9464/healthz|readyz|metrics`;
disable via `AGENT_OPS_DISABLED=true` → agent still enrolls/streams.

### Tests for User Story 1 (write FIRST, must FAIL)

- [x] T007 [P] [US1] Unit test `packages/agent/test/ops-server.test.ts` — `/healthz` 200 with `{status:"ok"}`, `/readyz` 503 before connect / 200 when established, `/metrics` exposes `agent_*` series, unknown path 404, non-GET 405
- [x] T008 [P] [US1] Unit test `packages/agent/test/ops-config.test.ts` — `AGENT_OPS_HOST`/`AGENT_OPS_PORT`/`AGENT_OPS_DISABLED` parsing incl. defaults (`0.0.0.0`, `9464`, enabled) in `loadConfig`
- [x] T009 [P] [US1] Unit test for non-fatal listener failure — bind conflict logs a warning and `runAgent` continues enrolling/streaming (extend or add `packages/agent/test/main.test.ts` case)

### Implementation for User Story 1

- [x] T010 [US1] Parse `AGENT_OPS_HOST`/`AGENT_OPS_PORT`/`AGENT_OPS_DISABLED` in `packages/agent/src/config.ts` (`AgentConfig.ops` block)
- [x] T011 [US1] Create `packages/agent/src/ops-server.ts` — `node:http` server serving the three GET surfaces per `contracts/agent-ops-endpoints.md`, wired to the T006 registry and a `getReadiness()` callback; `start()`/`stop()`; bind failure → warn + resolve `null`
- [x] T012 [US1] Wire ops server lifecycle in `packages/agent/src/main.ts` — start after config load, `getReadiness()` fed by session state (connecting/backoff/connected/no-credential), stop on exit; count reconnects in the session loop
- [x] T013 [US1] Emit session/job/asset counters in `packages/agent/src/client.ts` and `packages/agent/src/executor.ts` — connected gauge on hello.ok, session-end reason counter, jobs received/completed-by-result, active gauge, assets streamed by importer, credential-test results, secret-resolution failures
- [x] T014 [US1] Add `HEALTHCHECK` to `Dockerfile.agent` per contracts (30s interval, 15s start-period, node fetch on `AGENT_OPS_PORT` or 9464)

**Checkpoint**: US1 independently testable — endpoints live, counters tick, healthcheck works

---

## Phase 4: User Story 2 — Hub admin sees agent-reported operational state (P1)

**Goal**: `ops` snapshot rides the heartbeat → hub persists latest → agent
read surfaces + detail page display it labeled agent-reported.

**Independent Test**: connect agent → `GET /api/v1/agents/{id}` shows
`reportedStatus` + `lastHeartbeatAt`; detail page shows the block and the
"not reported" empty state.

### Tests for User Story 2 (write FIRST, must FAIL)

- [x] T015 [P] [US2] Agent unit test — heartbeat payload includes the `ops` snapshot populated from the counter registry (`packages/agent/test/client.test.ts` or new)
- [x] T016 [P] [US2] Backend integration test `packages/backend/test/integration/agent-ops-reporting.test.ts` — heartbeat with `ops` persists `"reportedStatus"`; `GET /agents/{id}` returns `reportedStatus`, `lastHeartbeatAt`, `lastDisconnectReason`; `GET /agents` returns `lastDisconnectReason`; absent snapshot → `null`
- [x] T017 [P] [US2] Frontend unit test — agent detail renders the agent-reported block and the "not reported" empty state (`packages/frontend/src/test/unit/`)

### Implementation for User Story 2

- [x] T018 [US2] Send `ops` snapshot in the heartbeat from `packages/agent/src/client.ts` using the T006 `snapshot()` helper
- [x] T019 [US2] Persist `ops` to `import_agents."reportedStatus"` (with hub-stamped `receivedAt`) on heartbeat in `packages/backend/src/services/agent-session-service.ts`; add `lastContactFor(agentId)` reader
- [x] T020 [US2] Extend `toApi`/`getAgent`/`listAgents` in `packages/backend/src/services/agent-service.ts` — `reportedStatus`, `lastHeartbeatAt` (live session via injected session reader), `lastDisconnectReason` (latest closed session; single grouped query for the list)
- [x] T021 [US2] Update `packages/frontend/src/api/types.ts` + `api/hooks/agents.ts` for the new fields
- [x] T022 [US2] Render "Last heartbeat" freshness + "Agent-reported" counters block (uptime, jobs, assets, credential tests, reconnects) + latest disconnect reason on `packages/frontend/src/pages/agent-detail.tsx`; "not reported by this agent" empty state
- [x] T023 [US2] Add last-disconnect-reason column to `packages/frontend/src/pages/agents.tsx`

**Checkpoint**: US2 independently testable — reported state visible hub-side

---

## Phase 5: User Story 3 — Hub metrics answer remote-execution questions (P2)

**Goal**: Four new hub series answer queue-wait, job-duration,
session-duration, and staleness questions.

**Independent Test**: drive a dispatch→complete cycle → `GET /metrics`
shows the new series with per-agent labels.

### Tests for User Story 3 (write FIRST, must FAIL)

- [x] T024 [P] [US3] Backend integration test — remote run cycle emits `agent_dispatch_wait_seconds`, `agent_remote_job_duration_seconds`, `agent_session_duration_seconds`, `agent_last_contact_timestamp_seconds` with correct labels (`packages/backend/test/integration/`)

### Implementation for User Story 3

- [x] T025 [US3] Declare the four series in `packages/backend/src/plugins/metrics.ts` per `contracts/api-deltas.md` (label discipline + buckets)
- [x] T026 [US3] Instrument `packages/backend/src/services/remote-run-service.ts` — dispatch wait at `job.assign` send, job duration at `run.complete` finalization
- [x] T027 [US3] Instrument `packages/backend/src/services/agent-session-service.ts` — session duration on close, last-contact gauge per accepted frame

**Checkpoint**: US3 independently testable — metrics answer the ops questions

---

## Phase 6: User Story 4 — Operator runs monitoring end-to-end from the docs (P3)

**Goal**: docs describe every surface, config field, and scraping pattern.

**Independent Test**: follow docs on a fresh deploy — every surface behaves
as written.

- [x] T028 [P] [US4] Add operations-observability section to `docs/agents.md` — endpoints, `AGENT_OPS_*` env table, metric catalog, healthcheck wiring, disabled-listener trade-off, restricted-network scraping patterns
- [x] T029 [P] [US4] Document the heartbeat `ops` payload + cadence + degradation rule in `docs/agent-protocol.md`
- [x] T030 [P] [US4] Update `docs/openapi.yaml` for the `GET /agents` and `GET /agents/{id}` response deltas (ADR-104)

**Checkpoint**: all four stories independently functional

---

## Phase 7: Polish & Cross-Cutting

- [x] T031 Append "Amendment 3 — Agent operations observability surfaces (spec 028)" to `researches/adrs/ADR-116-remote-import-agents.md` covering: new `AGENT_OPS_*` envs, heartbeat `ops` + protocol bump, `"reportedStatus"` column, new hub series, agent-local unauthenticated ops listener; add `**Amended by**` context and update `researches/architecture-decisions.md` index
- [x] T032 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green
- [x] T033 Execute `quickstart.md` validation end-to-end

---

## Phase 8: Review

Findings from code-review against `main` (round 1).

- [x] T034 Add a persistent post-listen `error` handler to the ops HTTP server in `packages/agent/src/ops-server.ts` so a runtime listener error logs a warning and never crashes the agent — FR-005 (code-review: spec, HIGH)
- [x] T035 Render `reportedStatus.activeJobs` on `packages/frontend/src/pages/agent-detail.tsx` and give "Last heartbeat" a fresh-vs-stale signal against the expected ~30s cadence — US2-AS1/AS2 (code-review: spec, HIGH)
- [x] T036 Count `secretResolutionFailed()` on the `SecretResolutionError`/`SecretRefError` path of `handleCredentialTest` in `packages/agent/src/client.ts` — FR-003 (code-review: spec, HIGH)
- [x] T037 Rework job counters in `packages/agent/src/metrics.ts` + `executor.ts` so `ops.activeJobs`/`agent_jobs_active` mirror the executor's `activeJobs` map exactly (increment at registration, decrement in the `finally`), and `jobs.assigned` counts registered (accepted-into-queue) assigns per data-model.md (code-review: spec, HIGH)
- [x] T038 Update `docs/ux.md` for the new agent-reported block, heartbeat-freshness/disconnect rows, and list disconnect column — ADR-116 item 11 requires ux.md in the same change (code-review: standards, HIGH)
- [x] T039 Observe `agent_remote_job_duration_seconds` only on `run.complete` finalization, not on lost/unavailable/ack-timeout finalizes, in `packages/backend/src/services/remote-run-service.ts` — contracts/api-deltas.md (code-review: spec, MEDIUM)
- [x] T040 Normalize agent-local `result` label values to lowercase (`completed|failed|cancelled`, `ok|failed`) to match hub label discipline — US3-AS4 (code-review: spec, MEDIUM)
- [x] T041 Make the `Dockerfile.agent` HEALTHCHECK honor a non-wildcard `AGENT_OPS_HOST` (fall back to 127.0.0.1 for `0.0.0.0`/unset) — FR-006 (code-review: spec, MEDIUM)
- [x] T042 Add recommended alerting signals to the operations-observability section of `docs/agents.md` — US4 (code-review: spec, MEDIUM)
- [x] T043 Ratify `lastHeartbeatAt` on the `GET /agents` list response in `contracts/api-deltas.md` and the ADR-116 Amendment 3 read-surface bullet (implementation already ships it) (code-review: spec, MEDIUM)
- [x] T044 Pass a session-end reason to `markDisconnected` only for established sessions in `packages/agent/src/client.ts` — pre-handshake closes must not inflate `agent_sessions_total` (code-review: standards, LOW)
- [x] T045 Deduplicate types: `AgentReportedStatus` = `AgentOpsSnapshot & { receivedAt: string }` in core; `JobResult` = `RunCompletePayload["result"]` in `packages/agent/src/metrics.ts` (code-review: standards, LOW)
- [x] T046 Rename the `receivedAt` row label "Reported" → "Received (hub)" in `packages/frontend/src/pages/agent-detail.tsx` so it is not confused with the agent's own `reportedAt` (code-review: standards, LOW)

---

## Phase 9: Review (round 2)

Findings from code-review against `main` (round 2, after T034–T046).

- [x] T047 Ratify `reportedStatus` on the `GET /agents` list response — `toApi` ships it unconditionally; ratified in `contracts/api-deltas.md`, `data-model.md`, and the ADR-116 Amendment 3 read-surface bullet (code-review: standards+spec, HIGH)
- [x] T048 Fix `reported_status` → `"reportedStatus"` naming drift across spec artifacts (data-model.md, api-deltas.md, research.md, plan.md, quickstart.md, tasks.md) and the `agent-ops-reporting.test.ts` comment — column is quoted camelCase per repo convention (code-review: standards, HIGH)
- [x] T049 Add `lastHeartbeatAt` (+ `reportedStatus` per T047) to the `GET /agents` section of `data-model.md` — internal spec-folder consistency (code-review: standards, HIGH)
- [x] T050 Sync `contracts/agent-ops-endpoints.md` healthcheck snippet with the AGENT_OPS_HOST-aware `Dockerfile.agent` HEALTHCHECK (code-review: standards, HIGH)
- [x] T051 Add `outcome` label (`established`|`failed`) to `agent_reconnects_total` — FR-003 requires reconnects by outcome; attempt counter for `ops.reconnects` stays at retry-decision time, outcome recorded when the next connect settles (code-review: spec, MEDIUM)
- [x] T052 Bracket IPv6 `AGENT_OPS_HOST` values in the HEALTHCHECK URL so `::1` binds produce a valid fetch URL (code-review: spec, MEDIUM)
- [x] T053 Order `lastDisconnectReasons` by `disconnectedAt` desc — "latest closed session" semantics, not `connectedAt` (code-review: spec, LOW)
- [x] T054 Rename hub-side `JobResult` → `JobOutcome` in `remote-run-service.ts` — the union includes non-wire outcomes (lost/unavailable/incompatible) and collided with the agent's wire-result alias (code-review: standards, LOW)
- [x] T055 `server.closeAllConnections()` in ops-server `close()` so keep-alive scraper connections cannot hang shutdown; dedupe the double `activeRunsForAgent` call in `getAgent` (code-review: standards, LOW)

Accepted as designed (documented, no change): `ops.reconnects`
counts retry attempts (includes never-established retries — FR-007
wording); heartbeat `ops` persistence is unconditional last-write-wins
(self-heals next beat — FR-009 is recency, not ordering); agent-local
`agent_credential_tests_total{result}` uses `ok|failed` vs the hub's
dispatch-outcome vocabulary — different scrape targets and semantic
spaces (execution vs dispatch).

---

## Dependencies & Execution Order

- Phase 1–2 block everything (contract + schema + registry).
- US1 (Phase 3) and US2 (Phase 4) both need T006 counters; US2 also needs
  T002/T005. They can proceed in parallel by different hands; sequentially
  do US1 → US2 since the snapshot producer ships in US1's executor wiring.
- US3 (Phase 5) depends on Phase 2 only (hub-side instrumentation).
- US4 (Phase 6) documents settled behavior — after US1–US3.
- Phase 7 after all stories.

### Parallel opportunities

- T004 ∥ T005 (contract vs migration/types)
- T007 ∥ T008 ∥ T009 (three test files)
- T015 ∥ T016 ∥ T017 (three test files)
- T028 ∥ T029 ∥ T030 (three doc files)

## Implementation Strategy

MVP = Phases 1–3 (agent-local ops surface + healthcheck). Then US2 (hub
visibility), US3 (metrics depth), US4 (docs), then polish/ADR/ship checks.
