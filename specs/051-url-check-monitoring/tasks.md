# Tasks: URL Check Monitoring

**Input**: Design documents from `/specs/051-url-check-monitoring/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test-first is non-negotiable (Constitution VI) — every story phase
writes failing tests before implementation.

**Organization**: Phases 3–8 map to spec user stories US1–US6.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup — core contracts and vocabulary

- [x] T001 [P] Create `packages/core/src/constants/url-check.ts` with enums `URL_CHECK_METHODS` (`GET`,`HEAD`), `URL_CHECK_AUTH_MODES` (`NONE`,`BASIC`,`BEARER`,`CUSTOM_HEADERS`), `URL_CHECK_VANTAGES` (`HUB`,`AGENT`), `URL_CHECK_OUTCOMES` (`SUCCESS`,`FAILURE`,`MISSED`), `URL_CHECK_ERROR_TYPES` (`DNS`,`CONNECT`,`TLS`,`TIMEOUT`,`HTTP_STATUS`,`POLICY_BLOCKED`,`AGENT_OFFLINE`,`ABORTED`,`OTHER`), `URL_CHECK_TARGET_WINDOWS`/`URL_CHECK_WINDOWS` (`24H`,`7D`,`30D`), defaults (`URL_CHECK_DEFAULT_CADENCE_SECONDS=300`, min 60, max 86400, `URL_CHECK_RETENTION_DAYS=30`, `URL_CHECK_DEFAULT_TIMEOUT_MS=30000`) — export via `constants/index.ts` and `src/index.ts`
- [x] T002 [P] Create `packages/core/src/contracts/url-check.ts` with `MonitoringSetup`, `UrlCheck`, `UrlCheckListItem` (incl. `latest` observation summary), `UrlCheckObservation`, `UrlCheckMetrics` (availability, errorRate, coverageGap, p50/p95/p99, counts, window, vantage), `SuccessPolicy` (`{codes:number[], ranges:{min,max}[]}`), `AuthConfig` union — export via `src/index.ts`
- [x] T003 [P] Create `packages/core/src/schemas/url-check.ts` — strict Zod: `updateMonitoringSetupSchema` (`cadenceSeconds` 60..86400, `vantage`, `agentId`), `createUrlCheckSchema`/`updateUrlCheckSchema` (name 1..120, `url`, `componentInstanceId` uuid, `method`, `enabled`, `cadenceSeconds` 60..86400 nullable, `successPolicy`, `availabilityTarget` 0..100 + `targetWindow` paired, `authMode`, `credentialId` uuid nullable, `authConfig`), `urlCheckMetricsQuerySchema` (window `24h|7d|30d`), `urlCheckObservationsQuerySchema` (limit 1..200, `before` ISO); extend `createComponentSchema` (`packages/core/src/schemas/components.ts`) with optional `instance` + `monitoring` blocks per contracts/http-api.md
- [x] T004 [P] Add `URL_CHECK_NOT_FOUND` and `MONITORING_SETUP_NOT_FOUND` to `packages/core/src/constants/error-codes.ts`, matching `ERROR_TYPES` rows in `packages/core/src/constants/error-types.ts`, and `CODE_MEANINGS` entries in `packages/backend/scripts/generate-api-doc.ts`

## Phase 2: Foundational — schema, probe executor, protocol, plumbing

- [x] T005 [P] Write migration `packages/backend/src/db/migrations/024_url_checks.ts` creating `component_monitoring_setups`, `url_checks`, `url_check_observations` exactly per data-model.md (FKs: setup→components CASCADE UNIQUE, checks→setup CASCADE, checks→component_instances CASCADE, checks→credentials RESTRICT, setup→import_agents RESTRICT; CHECK constraints from core constants via `check-constraint-helper.ts`; indexes `(setupId)`, `(componentInstanceId)`, partial `(enabled,nextProbeAt)`, `(urlCheckId,scheduledAt DESC)`, `(scheduledAt)`)
- [x] T006 [P] Add `ComponentMonitoringSetupRow`, `UrlCheckRow`, `UrlCheckObservationRow` and `DB` entries (`component_monitoring_setups`, `url_checks`, `url_check_observations`) in `packages/backend/src/db/types.ts`
- [x] T007 [P] Add `urlCheck:create`, `urlCheck:update`, `urlCheck:delete`, `monitoringSetup:update` → `EDITOR` to `PERMISSIONS` in `packages/backend/src/plugins/rbac.ts`
- [x] T008 [P] Write failing unit tests for the probe executor in `packages/core/test/` covering: GET/HEAD via fetch with `redirect:"manual"`, 3xx returned as-received, body cancelled after headers, timeout→`TIMEOUT`, DNS/connect/TLS error → normalized `errorType`, `urlSafetyError` rejection → `POLICY_BLOCKED`, header-boundary `durationMs`
- [x] T009 [P] Implement `packages/core/src/monitoring/probe.ts` — `executeHttpProbe({url,method,timeoutMs,headers,signal}): Promise<ProbeResult>` per research R1; export via `src/index.ts`
- [x] T010 [P] Add `url_check_probes_total{vantage,outcome,errorType}` counter and `url_check_probe_duration_seconds{vantage}` histogram in `packages/backend/src/plugins/metrics.ts` (bounded enum labels only — FR-018)
- [x] T011 [P] Add `"url_check"` and `"monitoring_setup"` cases to `namesFor` in `packages/backend/src/services/audit-query-service.ts` (join `url_checks → component_instances → components` for display names)
- [x] T012 [P] Add `urlCheckProbeSchema` and `urlCheckProbeResultSchema` frames to `agentMessageSchemas` in `packages/core/src/contracts/agent-protocol.ts` per contracts/agent-frames.md; bump `AGENT_PROTOCOL_VERSION` 3→4 in `packages/core/src/constants/import-agent.ts`

## Phase 3: US1 — Configure URL checks on a Component (P1)

**Goal**: create/edit/enable/disable/delete checks attached to instances;
shared setup upsert. **Independent test**: check CRUD via API + card on
Component detail; invalid URL rejected; RBAC gates writes.

- [x] T013 [US1] Write failing tests `packages/backend/test/` for monitoring services + routes: create auto-creates setup defaults (HUB/300), instance-belongs-to-component validation, `urlSafetyError` rejection → `VALIDATION_FAILED`, enable/disable sets/clears `nextProbeAt`, URL edit preserves identity/history, delete cascades observations, setup vantage `AGENT` requires `agentId` of active agent, RBAC EDITOR gate, audit `created|updated|enabled|disabled|deleted` events
- [x] T014 [US1] Implement `packages/backend/src/services/monitoring-setup-service.ts` (`getSetup`, `upsertSetup` with `assertAgentAssignable`-style agent validation, audit)
- [x] T015 [US1] Implement `packages/backend/src/services/url-check-service.ts` (`listChecks` incl. `latest`, `getCheck`, `createCheck` auto-creating setup, `updateCheck`, `deleteCheck`, validation rules per data-model.md, `writeEntityChange` audit in same transaction, `toActor`)
- [x] T016 [US1] Create `packages/backend/src/routes/url-checks.ts` — `GET|PUT /components/:componentId/monitoring-setup`, `GET|POST /components/:componentId/url-checks`, `GET|PATCH|DELETE /url-checks/:id` with `verifySession`/`requireRole` per contracts/http-api.md; register in `app.ts` AND `api-docs-contract.test.ts` lists
- [x] T017 [US1] Add the US1 paths to `docs/openapi.yaml` (paths, `x-permission`, tag `URL Checks`, `Problem.code` enum additions)
- [x] T018 [P] [US1] Write failing frontend tests `packages/frontend/src/test/unit/url-checks.test.tsx` — checks card renders rows/empty state, editor create/edit/disable/delete flows, permission gating
- [x] T019 [US1] Create `packages/frontend/src/api/hooks/url-checks.ts` + `packages/frontend/src/api/mappers/monitoring.ts` (`useMonitoringSetup`, `useUpdateMonitoringSetup`, `useUrlChecks`, `useUrlCheck`, `useCreateUrlCheck`, `useUpdateUrlCheck`, `useDeleteUrlCheck` + invalidations)
- [x] T020 [US1] Create `packages/frontend/src/ux/components/catalog/url-checks-card.tsx`, `url-check-editor.tsx`, `monitoring-setup-editor.tsx`; `CHECK_STATUS_META` + badge distinct from `HEALTH_META`; wire card into `component-detail.tsx` grid; EDITOR-gated actions

## Phase 4: US2 — Scheduled probes collect observations (P1)

**Goal**: hub + agent probe execution with MISSED bookkeeping and retention.
**Independent test**: enable check → observations accumulate; failing endpoint
records `FAILURE`; agent offline records `MISSED`/`AGENT_OFFLINE`.

- [x] T021 [US2] Write failing integration tests `packages/backend/test/` for scheduler + dispatcher: due-check sweep via `nextProbeAt`, advance after attempt, `MISSED` rows for skipped slots (agent offline, startup reconcile), disabled checks accrue nothing, sibling isolation under `p-queue`, 30-day retention purge deletes old rows, no `import_runs`/`ComponentInstance.status` writes
- [x] T022 [US2] Implement `packages/backend/src/services/probe-dispatcher.ts` — resolve setup+check+credential auth headers (STORED decrypt hub-side), run `executeHttpProbe` via `p-queue` (env `URL_CHECK_HUB_CONCURRENCY`, default 10), write observation (`vantage`, `agentId`), bump `url_check_probes_*` metrics, throttle credential `lastUsedAt` (>1h stale)
- [x] T023 [US2] Implement `packages/backend/src/services/url-check-scheduler.ts` — 15 s sweep (env `URL_CHECK_SWEEP_INTERVAL_MS`) selecting `enabled AND nextProbeAt <= now()`, MISSED rows for skipped slots, startup reconcile for hub downtime, nightly retention purge; init in `server.ts` after migrations; reschedule on check create/update/enable
- [x] T024 [US2] Add `dispatchUrlCheckProbe` to `packages/backend/src/services/agent-session-service.ts` (pending map keyed `probeId`, dispatch timeout → MISSED/`TIMEOUT`, offline → MISSED/`AGENT_OFFLINE`, pending rejection on session close) + result handler writing observations; route `url_check.probe.result` in `onFrame`
- [x] T025 [US2] Create `packages/agent/src/probe.ts` — resolve `secretRefMap` via `resolveRefMap`, build auth headers from `authKeyNames`, run `executeHttpProbe`, reply `url_check.probe.result`; route frame in `client.ts`; unit tests `packages/agent/test/`

## Phase 5: US3 — View per-check status and metric history (P1)

**Goal**: metrics + observation read paths and check detail UI.
**Independent test**: metrics endpoint returns availability/errorRate/p* for
24h/7d/30d; detail page renders counters, sparkline, observation table.

- [x] T026 [US3] Write failing tests for `getMetrics`/`listObservations`: availability `SUCCESS/(SUCCESS+FAILURE+MISSED)`, `coverageGap = MISSED/total`, `errorRate = FAILURE/(SUCCESS+FAILURE)`, `percentile_cont` p50/p95/p99 over SUCCESS `durationMs`, window filtering, `latest`, cursor pagination
- [x] T027 [US3] Implement `getMetrics` + `listObservations` in `url-check-service.ts` per data-model.md metric formulas
- [x] T028 [US3] Add `GET /url-checks/:id/metrics?window=` and `GET /url-checks/:id/observations` to `routes/url-checks.ts`; document both in `docs/openapi.yaml`
- [x] T029 [P] [US3] Write failing frontend tests for check detail: metric cards, coverage-gap display, observation table, "reachable from {vantage}" labels
- [x] T030 [US3] Create `packages/frontend/src/ux/components/catalog/url-check-detail.tsx` + route `ux/app/components/$slug.checks.$checkId.tsx` (register in `routes.tsx`, add `checks` to `SEGMENT_LABELS`); Counter-card metrics for 24h/7d/30d, sparkline strip, observation history table, edit/delete (ConfirmDialog)

## Phase 6: US4 — Authenticated checks for API Components (P2)

**Goal**: per-check auth via Credentials for `API`-category Components.
**Independent test**: Basic/Bearer/custom-header probes present correct
headers; `Authorization` custom header rejected; dependents protect
credential deletion.

- [x] T031 [US4] Write failing tests: authConfig validation (`Authorization` reserved, header-name token charset, authConfig keys exist in credential bundle, `authMode!=NONE` requires `credentialId`, `category==='API'` gate, AGENT vantage requires `AGENT_MANAGED` credential kind), header construction, credential dependents include `urlChecks`, deletion protection (`CREDENTIAL_IN_USE`), `lastUsedAt` throttle
- [x] T032 [US4] Implement auth resolution: build request headers from credential bundle in `probe-dispatcher.ts` (STORED path); validate credential-kind-vs-vantage rule + auth rules in `url-check-service.ts`; `CredentialDependents.urlChecks[]` in `packages/core/src/contracts/credential.ts` + `credential-service.ts` dependents/delete guard
- [x] T033 [P] [US4] Write failing frontend tests for auth section (API gate, mode select, credential picker, custom-header rows)
- [x] T034 [US4] Add auth section to `url-check-editor.tsx` (mode select, `useCredentials` picker, custom-header name/key rows); openapi.yaml authConfig schema documentation

## Phase 7: US5 — Create Component + first checks together (P2)

**Goal**: atomic create flow. **Independent test**: `/components/new` creates
component + instance + setup + checks in one transaction; validation failure
creates nothing.

- [x] T035 [US5] Write failing tests for composite create: atomic transaction (component + instance + setup + checks), `monitoring` requires `instance`, nothing persisted on check validation failure, permissions `component:create`+`urlCheck:create`
- [x] T036 [US5] Extend `POST /components` handler + component service for optional `instance`/`monitoring` blocks (single transaction); document in `docs/openapi.yaml`
- [x] T037 [P] [US5] Write failing frontend tests for `/components/new` page + repeated check rows
- [x] T038 [US5] Create `packages/frontend/src/ux/app/components/new.tsx` FormPage (component fields via spec-042 field set, instance env field, `forms/url-check-rows.tsx` repeated-row editor, setup defaults); register route + entry point from components index

## Phase 8: US6 — Optional availability target (P3)

**Goal**: per-check target + window displayed beside observed availability.
**Independent test**: set 99.5%/30d → summary shows target vs observed; unset
shows nothing.

- [x] T039 [US6] Write failing tests: target field validation (paired fields, 0..100), metrics response includes `target`, UI renders target separately from observed
- [x] T040 [US6] Include `target` in `getMetrics` response + render in `url-check-detail.tsx` and checks-card summary (Progress vs target, clearly labeled)

## Phase 9: Polish & cross-cutting

- [x] T041 Write `researches/adrs/ADR-124-url-check-execution-surfaces.md` ratifying: `url_check.probe`/`url_check.probe.result` + protocol v4, new permissions, new error codes, table columns, `MISSED` semantics, STORED/AGENT_MANAGED vantage rule, env vars (`URL_CHECK_SWEEP_INTERVAL_MS`, `URL_CHECK_PROBE_TIMEOUT_MS`, `URL_CHECK_HUB_CONCURRENCY`), metric-label policy; add amendment note + back-pointer to ADR-116 (new frames/protocol bump) and register both in `researches/architecture-decisions.md`
- [x] T042 Write `docs/url-checks.md` user guide (setup, checks, auth, metrics, vantage, retention); add sidebar entry in `docs-site/.vitepress/config.ts`; add note in `docs/ux.md` documenting the dedicated check editor; cross-link `docs/importers/web-url.md` + `api-url.md` clarifying importers remain discovery-only
- [x] T043 Run `pnpm docs:api` to regenerate `docs/api.md`; run `docs:api:check` + `api-docs-contract` test; verify `Problem.code` enum parity
- [x] T044 Update `docs/roadmap.md` — mark `051-url-check-monitoring` shipped and revise the Next entry
- [x] T045 Final verification: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for changed packages (`core`, `backend`, `agent`, `frontend`) + root build; `git diff --check`

## Dependencies

- Phase 1 → Phase 2 → stories. US1 (Phase 3) before US4 (needs checks) and
  US5 (needs check creation); US2 (Phase 4) and US3 (Phase 5) can proceed in
  parallel after US1; US6 (Phase 8) after US3.
- T012 (protocol) before T024/T025 (agent probe path).

## Parallel execution examples

- Phase 1: T001–T004 all parallel.
- Phase 2: T005–T012 all parallel.
- US1: T018/T019 (frontend tests + hooks) parallel with T014–T017 (backend).
- US4: T033 parallel with T031–T032.

## Implementation strategy

MVP = Phases 1–5 (US1–US3): configured checks probing on Hub with metrics.
US4–US6 are independently deliverable increments after the MVP.

## Phase 10: Convergence

- [x] T046 Write backend tests for `getMetrics`/`listObservations` (`packages/backend/test/`): availability `SUCCESS/(S+F+M)` with MISSED rows, `coverageGap`, `errorRate` over executed only, `percentile_cont` p50/p95/p99 over SUCCESS durations, window filtering, `target` echo, `nextBefore` cursor pagination (gap G1; also add one sibling-isolation probe test — G5)
- [x] T047 Write backend tests for auth validation + hub header construction: `Authorization` custom-header rejection, non-API authMode rejection, AGENT vantage + STORED credential → `CREDENTIAL_KIND_MISMATCH`, missing credential key → `CREDENTIAL_MISSING_KEY`, `dispatchProbe` sends `Authorization: Basic|Bearer` + custom headers to fetchImpl (gap G2)
- [x] T048 Enforce `urlCheck:create` in addition to `component:create` on `POST /components` when `monitoring` is present — `packages/backend/src/routes/components.ts` (gap G3)
- [x] T049 Include resolved setup `cadenceSeconds`/`vantage`/`agentName` in `GET /url-checks/:id` response per contracts/http-api.md — `packages/backend/src/services/url-check-service.ts` + contract types (gap G4)

## Phase 11: Review

- [x] T050 [code-review: spec] MISSED bookkeeping must not drop slots: in `url-check-scheduler.ts`, write MISSED rows for up to 50 slots per check per sweep starting from the oldest unrecorded slot and advance `nextProbeAt` only past covered slots — remaining slots carry to the next sweep so every missed slot eventually counts (clarified conservative SLI)
- [x] T051 [code-review: spec] Fix startup race: `setUrlCheckAgentDispatch` binding must happen before `startUrlCheckScheduler()` runs its first sweep (server.ts/app.ts ordering) so agent-vantage checks aren't spuriously marked MISSED/AGENT_OFFLINE on restart
- [x] T052 [code-review: spec] Add the `availabilityTarget`/`targetWindow` pairing refine to `updateUrlCheckSchema` in `packages/core/src/schemas/url-check.ts` (PATCH must 400, not hit the CHECK constraint)
- [x] T053 [code-review: spec] Update `docs/agent-protocol.md`, `docs/architecture.md`, `docs/AGENTS.md` for protocol v4 + `url_check.probe`/`url_check.probe.result` frames
- [x] T054 [code-review: spec] Render `dependents.urlChecks` in the credential detail page `packages/frontend/src/ux/app/credentials/$id.tsx` (FR-022 dependent listing)
- [x] T055 [code-review: spec] `CREDENTIAL_REVOKED` must be thrown with statusCode 409 (declared status) in `url-check-service.ts`
- [x] T056 [code-review: spec] Bound probe rate: add `intervalCap`/`interval` to the p-queue in `probe-dispatcher.ts` via env `URL_CHECK_PROBE_RATE_LIMIT` (default e.g. 20/sweep window) and clamp `URL_CHECK_PROBE_TIMEOUT_MS` to <= 60000 (FR-011)
- [x] T057 [code-review: standards] Fix N+1 in `listChecks` — one `DISTINCT ON (urlCheckId)` (or lateral join) query for latest observations instead of per-check queries (`url-check-service.ts`)
- [x] T058 [code-review: standards] Record `nextProbeAt` in the audit `changes` payload when cadence change reschedules (`url-check-service.ts`); make `getSetup` import static (remove dynamic `await import`)
