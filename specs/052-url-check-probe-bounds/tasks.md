# Tasks: URL Check Agent-Vantage Probe Bounds

**Input**: Design documents from `/specs/052-url-check-probe-bounds/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test-first is non-negotiable (Constitution VI) — every story phase
writes failing tests before implementation.

**Organization**: Phases 3–5 map to spec user stories US1–US3.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup — core contract surfaces

- [x] T00X [P] Add `SATURATED` to `URL_CHECK_ERROR_TYPES` in `packages/core/src/constants/url-check.ts` (comment: slot unexecuted because probe work exceeded a configured bound — recorded on MISSED observations), and add defaults `URL_CHECK_AGENT_CONCURRENCY_DEFAULT = 4`, `URL_CHECK_AGENT_RATE_LIMIT_DEFAULT = 20`, `URL_CHECK_AGENT_QUEUE_MAX_DEFAULT = 100`, `URL_CHECK_MAX_PROBES_DEFAULT = 8`
- [x] T00X [P] Add `urlCheckProbeCancelPayloadSchema` (`{probeId: z.string().uuid()}` strict) and `"url_check.probe.cancel": envelope(urlCheckProbeCancelPayloadSchema)` to `agentMessageSchemas` in `packages/core/src/contracts/agent-protocol.ts` per contracts/agent-frames.md; export `UrlCheckProbeCancelPayload`; bump `AGENT_PROTOCOL_VERSION` 4 → 5 in `packages/core/src/constants/import-agent.ts`
- [x] T00X Write migration `packages/backend/src/db/migrations/026_url_check_saturated.ts` altering `url_check_obs_error_type_check` to admit `SATURATED` — drop and re-add the CHECK via the same `inList("errorType", URL_CHECK_ERROR_TYPES)` helper pattern as migration 025 (down: restore the previous list)

## Phase 2: Foundational — shared plumbing

- [x] T00X [P] Write failing core tests `packages/core/test/` asserting `"url_check.probe.cancel"` parses through `agentMessageSchemas`/`parseAgentMessage` with a uuid `probeId` and rejects malformed payloads
- [x] T00X Add `URL_CHECK_MAX_PROBES` (integer ≥ 1, default `URL_CHECK_MAX_PROBES_DEFAULT`) to the agent env schema and `AgentConfig.urlCheckMaxProbes` in `packages/agent/src/config.ts`

## Phase 3: US1 — Agent-vantage probes respect system bounds (P1)

**Goal**: per-agent bounded in-flight + rate + bounded deferral on the hub;
overflow → MISSED(SATURATED); agent-side defensive cap with explicit refusal.
**Independent test**: force more due checks than the bound on one agent —
in-flight never exceeds the bound, deferral drains, overflow records
MISSED(SATURATED), a second agent and hub-vantage work are unaffected.

- [x] T00X [US1] Write failing integration tests `packages/backend/test/integration/url-checks-bounds.test.ts` using `setUrlCheckAgentDispatch` stubs: (a) >bound due checks on one agent never exceed `URL_CHECK_AGENT_CONCURRENCY` in-flight calls; (b) excess slots wait and complete with one observation each; (c) `queue.size ≥ URL_CHECK_AGENT_QUEUE_MAX` → `MISSED` row with `errorType='SATURATED'` and no dispatch; (d) saturation on agent A does not delay agent B or HUB-vantage dispatches; (e) dispatch rate stays within `URL_CHECK_AGENT_RATE_LIMIT` per sweep interval. (Tests read env before module import or use a test seam to shrink bounds.)
- [x] T00X [US1] Implement per-agent bounded dispatch pools in `packages/backend/src/services/probe-dispatcher.ts`: `Map<agentId, PQueue>` created lazily with `{concurrency: envInt("URL_CHECK_AGENT_CONCURRENCY", 4), intervalCap: envInt("URL_CHECK_AGENT_RATE_LIMIT", 20), interval: envInt("URL_CHECK_SWEEP_INTERVAL_MS", 15000)}`; `dispatchAgentProbe` checks `queue.size >= envInt("URL_CHECK_AGENT_QUEUE_MAX", 100)` → `recordObservation(MISSED, SATURATED)` without enqueueing, else wraps the dispatch body in `agentQueue(agentId).add(...)`; export a `resetAgentProbePoolsForTests()` seam
- [x] T00X [P] [US1] Write failing agent tests `packages/agent/test/url-check-probe.test.ts`: (a) more probe frames than the cap run only `URL_CHECK_MAX_PROBES` fetches and each overflow frame immediately replies `url_check.probe.result{outcome:"FAILURE", errorType:"SATURATED"}`; (b) freed capacity admits a later probe normally
- [x] T00X [US1] Implement the agent probe runner in `packages/agent/src/probe.ts` — `createProbeRunner(cap)` holding `Map<probeId, AbortController>` + in-flight count; `handleUrlCheckProbe` refuses at cap with the `SATURATED` result and registers/removes controllers around `executeHttpProbe`; wire the runner (per session, from `cfg.urlCheckMaxProbes`) in `packages/agent/src/client.ts`
- [x] T01X [US1] Map an agent `url_check.probe.result` with `errorType:"SATURATED"` to a `MISSED(SATURATED)` observation in `dispatchAgentProbe` (`packages/backend/src/services/probe-dispatcher.ts`) — an unexecuted refusal is never recorded as an endpoint FAILURE; add a test in `url-checks-bounds.test.ts`

## Phase 4: US2 — Cancellation and finalize integrity (P1)

**Goal**: hub signals cancellation on dispatch deadline; agent aborts
in-flight fetches on cancel and on session close; exactly one observation
per slot under every finalize path.
**Independent test**: stubbed slow endpoint → deadline fires → cancel frame
sent, slot MISSED(TIMEOUT) once, late result ignored; disconnect aborts
agent-side work.

- [x] T01X [US2] Write failing backend tests `packages/backend/test/unit/agent-session-service.test.ts` additions: (a) `dispatchUrlCheckProbe` deadline → `url_check.probe.cancel` frame written to the socket (when open) before the `AGENT_PROBE_TIMEOUT` rejection; (b) a `url_check.probe.result` arriving after pending-entry deletion is ignored — no resolve, no session error; (c) session close still rejects pending probes `AGENT_OFFLINE` (existing behavior, explicit regression)
- [x] T01X [US2] Implement the cancel send in `packages/backend/src/services/agent-session-service.ts`: on the dispatch deadline, `send(socket, "url_check.probe.cancel", {probeId})` guarded by `readyState === OPEN`, then delete the pending entry and reject `AGENT_PROBE_TIMEOUT` as today
- [x] T01X [P] [US2] Write failing agent tests `packages/agent/test/url-check-probe.test.ts` + `session.test.ts` additions: (a) `url_check.probe.cancel` for an in-flight probe aborts its fetch (result carries `errorType:"ABORTED"` or no reply if socket dead); (b) cancel for unknown/completed `probeId` is a no-op; (c) socket close aborts all in-flight probe controllers and `send` is never called on a dead socket
- [x] T01X [US2] Route `url_check.probe.cancel` in `packages/agent/src/client.ts` → runner `cancel(probeId)`; on socket `close`, `runner.abortAll()` alongside `executor.abortAll()`; the runner passes its per-probe `AbortSignal` into `executeHttpProbe` and swallows reply sends on a dead socket
- [x] T01X [US2] Write failing integration test in `url-checks-bounds.test.ts` (or `url-checks-monitoring.test.ts`): agent session loss mid-probe records exactly one `MISSED`/`AGENT_OFFLINE` observation for the slot and a post-reconnect stale result adds no second row
- [x] T01X [US2] Verify disabled/deleted check mid-flight yields at most one observation (US2 scenario 4) — extend the disable test in `url-checks-monitoring.test.ts` to assert observation count ≤ 1 for the in-flight slot and `nextProbeAt` cleared

## Phase 5: US3 — Documented, observable bounds (P2)

**Goal**: env-tunable bounds documented for hub and agent; bounded-label
telemetry exposes saturation at both ends.
**Independent test**: docs list every new var with default/range; saturation
appears in `url_check_probes_total{errorType="SATURATED"}` on the hub and
`agent_url_check_probes_total{result="saturated"}` on the agent.

- [x] T01X [P] [US3] Add label-free gauges `url_check_agent_probes_in_flight` and `url_check_agent_probe_queue_depth` (sums across agents — no agentId label, ADR-069) in `packages/backend/src/plugins/metrics.ts`; update them in the dispatcher's pool-admission path with a test asserting `SATURATED` shows under `url_check_probes_total{vantage,errorType}`
- [x] T01X [P] [US3] Add `agent_url_check_probes_in_flight` gauge and `agent_url_check_probes_total{result}` counter (`result` ∈ success|failure|saturated|aborted) in `packages/agent/src/metrics.ts`; increment/set in the probe runner; cover in `packages/agent/test/` metrics assertions
- [x] T01X [P] [US3] Update `docs/url-checks.md`: env table gains `URL_CHECK_AGENT_CONCURRENCY` (4), `URL_CHECK_AGENT_RATE_LIMIT` (20), `URL_CHECK_AGENT_QUEUE_MAX` (100); new section documents per-agent bounds, bounded deferral → MISSED(SATURATED), cancellation on deadline/disconnect, and late-result discarding
- [x] T02X [P] [US3] Update `docs/import-agents.md`: env table gains `URL_CHECK_MAX_PROBES` (8); metrics table gains the two new series; capacity note explains the agent cap vs. the hub per-agent bound
- [x] T02X [P] [US3] Add a "Protocol v5 — URL check probe bounds" section to `docs/agent-protocol.md` documenting `url_check.probe.cancel`, `SATURATED` results, and the v5 bump
- [x] T02X [P] [US3] Amend `researches/adrs/ADR-124-url-check-execution-surfaces.md` (item 1 + cancel frame & protocol 5; item 4 + `SATURATED`; item 5 + SATURATED→MISSED mapping; item 7 + three new env tunables; item 8 + new metrics) and append an amendment back-pointer to `researches/adrs/ADR-116-*.md` (frame enumeration + `url_check.probe.cancel`, `AGENT_PROTOCOL_VERSION` = 5)

## Phase 6: Polish & cross-cutting

- [x] T02X Run `pnpm docs:oracle:check` and `pnpm prettier --check` on touched docs; fix any drift (env-var documentation completeness, generated regions untouched)
- [x] T02X Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in `packages/core`, `packages/backend`, `packages/agent` and root `pnpm build`; confirm feature-051 monitoring tests still pass unchanged (spec SC-005)
- [x] T02X Update `docs/roadmap.md` — mark `052-url-check-probe-bounds` shipped and revise the Next entry per AGENTS.md roadmap sync

## Dependencies

- Phase 1 (T001–T003) blocks everything — constants, frame schema, migration.
- Phase 2 (T004–T005) blocks Phases 3–4.
- US1 (Phase 3) and US2 (Phase 4) share `probe-dispatcher.ts`,
  `agent-session-service.ts`, and `probe.ts`/`client.ts` — execute US1 first;
  US2's cancel send depends on T012's pending-entry lifecycle.
- US3 (Phase 5) is independent of 3–4 except T017/T018 metric wiring touches
  the same files (run after US1/US2 code lands).
- Phase 6 last.

## Parallel execution

- T001 ∥ T002 (different files; T003 after T001)
- T004 ∥ T005 (core tests ∥ agent config)
- T006 ∥ T008 (backend integration tests ∥ agent unit tests)
- T007 ∥ T009 (dispatcher ∥ agent runner — different packages)
- T011 ∥ T013 (session-service tests ∥ agent tests)
- T017 ∥ T018 ∥ T019 ∥ T020 ∥ T021 ∥ T022 (metrics + docs — disjoint files)

## Implementation strategy

MVP = Phases 1–3 (US1): bounded, saturation-visible agent-vantage dispatch.
US2 then layers prompt cancellation on the same surfaces. US3 is docs +
telemetry and can land incrementally. Each phase is independently testable
per the quickstart scenarios.

## Phase 7: Review

- [x] T02X [Review] code-review: spec+standards — head-of-line blocking: agent-vantage `dispatchProbe` awaits deferred pool work and `sweepOnce` awaits all dispatches, so a saturated agent stalls later sweeps (FR-005/FR-013). Fix: per-check in-flight claim set (`agentSlotClaims`), enqueue-and-return admission, `waitForAgentProbePoolsIdle()` test seam; deferred task logs failures and releases the claim.
- [x] T02X [Review] code-review: spec — duplicate observations possible on re-dispatch (FR-010): add UNIQUE `(urlCheckId, scheduledAt)` to migration 026 and a `scheduledAt` dedupe check in `dispatchProbe` so an already-observed slot is a no-op (prevents constraint-retry loops).
- [x] T02X [Review] code-review: spec+standards — duplicate `probeId` frames overwrite the runner's controller map (cap bypass + lost cancel handle): ignore duplicate `probeId` silently (log warn) before the cap check.
- [x] T02X [Review] code-review: spec — env bounds accept floats/≤0 which p-queue rejects unpredictably (FR-014): clamp via `Math.max(1, Math.floor(envInt(...)))` and document valid ranges in `docs/url-checks.md` + `docs/import-agents.md`.
- [x] T03X [Review] code-review: standards — hoist the duplicated dispatch-arg literal in `dispatchProbe`; drop the redundant `readyState===OPEN` guard around `this.send` in `agent-session-service.ts` (send already guards); `resetAgentProbePoolsForTests` also clears claims and refreshes the gauges.
- [x] T03X [Review] Update test call sites for admission-return semantics: `url-checks-bounds.test.ts` and `url-checks-monitoring.test.ts` AGENT tests must `await waitForAgentProbePoolsIdle()` before observation assertions.

## Phase 8: Review round 2

- [x] T032 [Review] code-review: spec — offline agents must bypass admission control (FR-004): `setUrlCheckAgentOnlineChecker` seam wired to `isConnected`; offline misses write `AGENT_OFFLINE` immediately, never deferred or mislabeled `SATURATED`.
- [x] T033 [Review] code-review: spec+standards — in-flight slot tombstone: `writeMissedSlots` skips claimed checks so a deferred slot can't be marked MISSED while its probe still runs (`isAgentSlotClaimed`).
- [x] T034 [Review] code-review: spec+standards — claim leak on synchronous `pool.add` throw: try/catch releases the claim.
- [x] T035 [Review] code-review: spec — `nextProbeAt` rewind: both advance sites use `GREATEST` so backlog advances are never overwritten backward.
- [x] T036 [Review] code-review: spec+standards — runner `.catch` on the probe task (rejection hygiene); `URL_CHECK_*` vars added to `docs/deployment.md` and `.env.example` (FR-017).
