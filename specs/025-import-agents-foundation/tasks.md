---
description: "Task list for Import Agents Foundation (spec 025)"
---

# Tasks: Import Agents Foundation

**Input**: Design documents from `/specs/025-import-agents-foundation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/agents-api.md, contracts/agent-protocol.md, quickstart.md

**Tests**: Constitution VI makes test-first non-negotiable — every story
phase writes failing tests before implementation.

**Organization**: Tasks are grouped by user story. Backend stories share
`agent-service.ts` / `routes/agents.ts`, so US2–US4 extend files created
in earlier phases — see Dependencies.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on incomplete tasks
- **[Story]**: US1–US5 per spec.md

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Add `@fastify/websocket` to backend: `pnpm add @fastify/websocket@^11.3.4 --filter @componode/backend`; commit `pnpm-lock.yaml` with the manifest change
- [x] T002 [P] Scaffold `packages/agent` workspace package `@componode/agent`: package.json (deps: `@componode/core` workspace:_, `ws` ^8.22.0, `pino`, `zod`, all 8 `@componode/importer-*` workspace:_), tsconfig.json mirroring `packages/backend/tsconfig.json`, empty `src/` + `test/` dirs

---

## Phase 2: Foundational (Blocking Prerequisites)

**CRITICAL**: No user story work begins until this phase completes.

- [x] T003 Create `packages/core/src/constants/import-agent.ts` — verbatim from data-model.md: `AGENT_STATUSES = ["NEVER_CONNECTED","CONNECTED","OFFLINE"]`, `AGENT_DISCONNECT_REASONS = ["client_close","heartbeat_timeout","revoked","shutdown","superseded"]`, `AGENT_AUDIT_ACTIONS`, `AGENT_PROTOCOL_VERSION = 1`, `AGENT_HEARTBEAT_INTERVAL_MS = 30_000`, `AGENT_STALE_AFTER_MS = 90_000`, `AGENT_SESSION_SWEEP_MS = 15_000`, `AGENT_ENROLLMENT_TTL_MS = 86_400_000`; add `AGENT_NOT_FOUND`, `AGENT_NAME_TAKEN`, `AGENT_IN_USE`, `AGENT_ENROLLMENT_INVALID`, `AGENT_CREDENTIAL_INVALID`, `AGENT_VERSION_MISMATCH` to `packages/core/src/constants/error-codes.ts`; export both via `constants/index.ts`
- [x] T004 Create `packages/core/src/contracts/import-agent.ts` per data-model.md — `ImportAgent`/`AgentSession` DTOs (never serialize `credentialHash`/`enrollmentTokenHash`; expose `hasCredential`/`pendingEnrollment`/`boundConfigCount`), `createImportAgentSchema` (`{name, allowedImporters?}`, strict), `updateImportAgentSchema`, `enrollRequestSchema`; export via `contracts/index.ts`
- [x] T005 Create `packages/core/src/contracts/agent-protocol.ts` per contracts/agent-protocol.md — envelope `{type, runId?, payload}`, schemas for `hello`/`hello.ok`/`heartbeat`/`close`/`error` plus reserved 026/027 types (`job.assign`, `job.ack`, `asset.batch`, `phase`, `run.complete`, `run.error`, `cancel`, `credential.test`, `credential.test.result`) with parse/discriminated-union helpers
- [x] T006 Move importer registry to core (ADR-065 amendment, research R6): create `packages/core/src/importer-registry.ts` exporting `createImporterRegistry(packageNames: string[], load: ModuleLoader)`; update backend call sites (`routes/importers.ts`, `services/importer-config-service.ts`, `services/import-run-service.ts`) to use a backend-owned instance; reduce `packages/backend/src/services/importer-registry.ts` to a thin facade over the core factory (existing test mocks import that path — `import()` must resolve importers in the caller's package context since core is a leaf)
- [x] T007 Create migration `packages/backend/src/db/migrations/016_import_agents.ts` per data-model.md — `import_agents` (status CHECK from `AGENT_STATUSES`; indexes on `credentialHash`, `enrollmentTokenHash`, `status`), `agent_sessions` (`disconnectReason` CHECK from `AGENT_DISCONNECT_REASONS`; `ON DELETE CASCADE` to `import_agents`; `(agentId, connectedAt DESC)` index + partial open-session index), `importer_configs.agentId` nullable FK `ON DELETE RESTRICT` + index; matching `down()`
- [x] T008 Update `packages/backend/src/db/types.ts` — `ImportAgentRow`, `AgentSessionRow`, `agentId` on `ImporterConfigRow`
- [x] T009 [P] Add `agent:read`, `agent:create`, `agent:update`, `agent:delete` → `ADMIN` in `PERMISSIONS` map in `packages/backend/src/plugins/rbac.ts`
- [x] T010 [P] Add path-prefix exemption for `/api/v1/agent/` in `packages/backend/src/plugins/csrf.ts` (ADR-087 Amendment 2 — bearer-authed routes, no cookie session)
- [x] T011 [P] Add agent metric series to `packages/backend/src/plugins/metrics.ts`: `import_agents_connected` gauge, `agent_sessions_total{agent,reason}` counter, `agent_stream_rejected_total{reason}` counter

**Checkpoint**: contracts, schema, and plumbing ready — story phases can start.

---

## Phase 3: User Story 1 — Register an agent and get enrollment material (P1) — MVP

**Goal**: Admin creates a named agent and receives a show-once enrollment
token + copy-ready install command.

**Independent Test**: create an agent via the admin UI; confirm the token
appears once and is never returned by any list/detail endpoint; duplicate
name and bad `allowedImporters` rejected.

### Tests for User Story 1

- [x] T012 [US1] Write failing integration tests in `packages/backend/test/integration/agents.test.ts`: `POST /agents` → 201 `{agent, enrollment:{token, expiresAt}}`; `GET /agents` + `GET /agents/{id}` never expose token/hash (only `hasCredential`, `pendingEnrollment`); duplicate name → `409 AGENT_NAME_TAKEN`; name violating `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` (1–63) → `400 VALIDATION_FAILED`; unknown `allowedImporters` entry → `400 VALIDATION_FAILED`; unauthenticated → 401; non-admin → `403 AUTH_FORBIDDEN`. Verify all fail.

### Implementation for User Story 1

- [x] T013 [US1] Implement create/list/get in `packages/backend/src/services/agent-service.ts`: `createAgent` (uuidv7 id; unique `name` → `AGENT_NAME_TAKEN`; `allowedImporters` validated against manifest names → `VALIDATION_FAILED`; 32-byte random enrollment token stored as `hashToken` + `enrollmentTokenExpiresAt` = now + `AGENT_ENROLLMENT_TTL_MS`; `writeEntityChange` action `created`, `entityType: "import_agent"`, admin actor — same transaction); `listAgents` (incl. `boundConfigCount` = COUNT of `importer_configs.agentId`); `getAgent` — all return DTOs that never include hashes
- [x] T014 [US1] Create `packages/backend/src/routes/agents.ts` — `GET /agents` (`agent:read`), `POST /agents` (`agent:create`), `GET /agents/:id` (`agent:read`) with Zod boundary validation per routes/credentials.ts pattern; register in `packages/backend/src/app.ts` under `/api/v1`
- [x] T015 [US1] Add `Agents` tag + `POST/GET /agents`, `GET /agents/{id}` to `docs/openapi.yaml` with `x-permission` entries; run `pnpm --filter @componode/backend docs:api`; confirm `api-docs-contract` test passes
- [x] T016 [P] [US1] Add `ImportAgent` types to `packages/frontend/src/api/types.ts` and `useAgents`/`useCreateAgent` hooks in `packages/frontend/src/api/hooks/agents.ts` (`refetchInterval: 15_000` on the list query)
- [x] T017 [US1] Create `packages/frontend/src/pages/agents.tsx` — standard list template: name, status badge (`Connected`/`Offline`/`Never connected` per existing color map), version, bound config count, last seen; register `/agents` route (`ADMIN`) in `routes.tsx` and add item under Administration in `nav-sections.ts`
- [x] T018 [US1] Create `packages/frontend/src/components/agent-enrollment-dialog.tsx` — show-once dialog: token, **editable** hub-URL field prefilled from `window.location.origin` (spec clarification), generated `docker run` snippet (`HUB_URL`, `AGENT_ENROLLMENT_TOKEN`, `AGENT_STATE_DIR` volume mount), link to `docs/agents.md`; wire into the agents page's Add flow

**Checkpoint**: US1 independently testable — create → token once → never retrievable.

---

## Phase 4: User Story 2 — Remote agent connects, authenticates, stays visible (P1)

**Goal**: `POST /agent/enroll` exchange + authenticated `GET /agent/stream`
WS channel with lockstep handshake, heartbeat liveness, supersede, and
offline detection.

**Independent Test**: real WS client connects with a durable credential →
`hello.ok` + `CONNECTED`; kill it → `OFFLINE` within the stale window;
bad/revoked credential and version mismatches rejected pre-upgrade or at
hello.

### Tests for User Story 2

- [x] T019 [US2] Write failing integration tests in `packages/backend/test/integration/agent-channel.test.ts` (real `ws` client vs test server): enroll happy path → `{agentToken}` + `enrollmentTokenUsedAt` set + audit `enrolled` (actor `agent:<name>`); used/expired/unknown token → `401 AGENT_ENROLLMENT_INVALID`; stream upgrade without/with bad credential and with credential on a `revokedAt`-set row → `401 AGENT_CREDENTIAL_INVALID` pre-upgrade; valid `hello` → `hello.ok` + `agent_sessions` row + `status=CONNECTED`; mismatched `protocolVersion` or importer set → `error` frame + close; second connect same credential → prior session closed `superseded`; silence > `AGENT_STALE_AFTER_MS` → `heartbeat_timeout` + `OFFLINE`; every rejected attempt → logged + metric, **zero** audit rows
- [x] T020 [P] [US2] Write failing unit tests in `packages/backend/test/unit/agent-session-service.test.ts`: handshake version-match validator (protocol diff, importer name/version diff, missing/extra importer entries → reject reasons); registry supersede bookkeeping; sweep closes only stale sessions

### Implementation for User Story 2

- [x] T021 [US2] Extend `packages/backend/src/services/agent-service.ts` — `exchangeEnrollmentToken(token)`: hash lookup → unused, unexpired, agent not revoked → generate durable credential (`randomBytes(32).base64url`), store `credentialHash` + `credentialIssuedAt`, stamp `enrollmentTokenUsedAt`, clear `enrollmentTokenHash`, audit `enrolled` with actor `{id:null, name:"agent:<name>"}` — single transaction; else throw `AGENT_ENROLLMENT_INVALID`
- [x] T022 [US2] Create `packages/backend/src/plugins/agent-auth.ts` — `verifyAgentCredential` preHandler: `Authorization: Bearer` → `hashToken` → `import_agents.credentialHash` lookup → `revokedAt` check → attach `req.agent`; failures → `401 AGENT_CREDENTIAL_INVALID` + warn log + `agent_stream_rejected_total{reason="credential"}`
- [x] T023 [US2] Create `packages/backend/src/services/agent-session-service.ts` — in-memory registry `Map<agentId,{socket,sessionId,lastContactAt}>`; hello wait w/ ~5 s timeout; handshake validation vs `AGENT_PROTOCOL_VERSION` + hub manifest set; `agent_sessions` INSERT on accept; any accepted frame updates `lastContactAt` + throttled `lastSeenAt`; 15 s sweep → close silent sessions `heartbeat_timeout`; supersede existing socket on new connect (`superseded`); close paths set `disconnectedAt` + reason (`client_close`/`heartbeat_timeout`/`revoked`/`shutdown`/`superseded`) + `status=OFFLINE`; `import_agents_connected` gauge + `agent_sessions_total` updates
- [x] T024 [US2] Create `packages/backend/src/routes/agent-channel.ts` — `POST /agent/enroll` (public; Zod-validated) and `GET /agent/stream` via `{websocket:true}` + `verifyAgentCredential` preHandler; register `@fastify/websocket` and the route in `packages/backend/src/app.ts`; wire session close on server shutdown (`shutdown` reason)
- [x] T025 [US2] Add `/agent/enroll` + `/agent/stream` to `docs/openapi.yaml` with `security: []` and prose describing bearer/enrollment-token auth (research R9); `pnpm docs:api` regen; contract test green

**Checkpoint**: US2 independently testable — connect, hello, heartbeat, offline, supersede all verified over real sockets.

---

## Phase 5: User Story 3 — Admin manages the agent fleet (P2)

**Goal**: rotate, revoke, update, delete + detail page.

**Independent Test**: rotate issues a new token under the same identity and
clears revocation; revoke drops the live session and rejects reconnects;
delete is blocked while `importer_configs.agentId` references the agent.

### Tests for User Story 3

- [x] T026 [US3] Write failing integration tests in `packages/backend/test/integration/agents-lifecycle.test.ts`: `POST /agents/{id}/enroll` → fresh single-use token, prior pending token superseded, `revokedAt` cleared (spec clarification), **old credential still valid until exchange** (graceful overlap), audit `token_rotated`; subsequent enroll exchange → old credential dead + old session dropped `superseded`; `POST /agents/{id}/revoke` → live session dropped w/ `revoked` + reconnects `401`; `DELETE` unbound → 204 + audit `deleted`; `DELETE` with `importer_configs.agentId` set (insert directly in test) → `409 AGENT_IN_USE` and FK holds; `DELETE` of a connected unbound agent → session closed, session rows cascade (spec clarification); `PATCH` name/`allowedImporters` → 200, name conflict → `409`, unknown importer → `400`; list reflects status/version/lastSeen/boundConfigCount

### Implementation for User Story 3

- [x] T027 [US3] Extend `packages/backend/src/services/agent-service.ts` — `updateAgent`, `rotateAgentCredential` (new enrollment token per T013 issuance; clears `revokedAt`; **keeps `credentialHash` live** — overlap until exchange, per spec clarification; audit `token_rotated`), `revokeAgent` (`revokedAt` + drop live session via session-service w/ `revoked` + audit `revoked`), `deleteAgent` (in-use check → `AGENT_IN_USE`; audit `deleted`); `exchangeEnrollmentToken` (T021) drops the incumbent session `superseded` when it replaces `credentialHash`
- [x] T028 [US3] Extend `packages/backend/src/routes/agents.ts` — `PATCH /agents/:id` (`agent:update`), `DELETE /agents/:id` (`agent:delete`), `POST /agents/:id/enroll` (`agent:update`), `POST /agents/:id/revoke` (`agent:update`)
- [x] T029 [US3] Add the four routes to `docs/openapi.yaml` + `pnpm docs:api`; contract test green
- [x] T030 [P] [US3] Extend `packages/frontend/src/api/hooks/agents.ts` — `useAgent`, `useUpdateAgent`, `useRotateAgent`, `useRevokeAgent`, `useDeleteAgent` mutations w/ query invalidation
- [x] T031 [US3] Create `packages/frontend/src/pages/agent-detail.tsx` — Overview tab (reported agent/protocol/importer versions labeled agent-reported, editable `allowedImporters`, `maxConcurrentJobs`, last seen, bound config count) + lifecycle actions (Rotate → reuse enrollment dialog; Revoke → confirm dialog; Delete → blocked state on `AGENT_IN_USE`); register `/agents/:id` (`ADMIN`) and link rows from `pages/agents.tsx`

**Checkpoint**: full lifecycle — rotate/revoke/delete — verified incl. delete-block.

---

## Phase 6: User Story 4 — Audit agent lifecycle and connection history (P2)

**Goal**: every consequential event traceable in `entity_changes` +
`agent_sessions`; rejected traffic writes none.

**Independent Test**: perform each lifecycle action + connect/disconnect
cycles; activity feed shows entries with actors; connection history shows
sessions w/ reasons and remote addresses; rejected attempts absent.

### Tests for User Story 4

- [x] T032 [US4] Write failing integration tests in `packages/backend/test/integration/agent-audit.test.ts`: `entity_changes` rows for `created`/`enrolled`/`token_rotated`/`revoked`/`deleted` w/ `entityType: "import_agent"` and correct actors (admin name; `agent:<name>` for `enrolled`); `GET /agents/{id}/sessions` returns sessions newest-first w/ timestamps, `disconnectReason`, `remoteAddress`, versions; rejected upgrades/enrolls leave **zero** audit rows

### Implementation for User Story 4

- [x] T033 [US4] Extend `packages/backend/src/routes/agents.ts` + `services/agent-service.ts` — `GET /agents/{id}/sessions` (`agent:read`, `?limit` default 50 max 200) + `listAgentSessions` query
- [x] T034 [US4] Add `/agents/{id}/sessions` to `docs/openapi.yaml` + `pnpm docs:api`; contract test green
- [x] T035 [US4] Extend `packages/frontend/src/pages/agent-detail.tsx` — Connection history tab (sessions table: connected/disconnected times, reason, remote address, versions); add `useAgentSessions` hook
- [x] T036 [US4] Verify `import_agent` entityType renders correctly in `pages/activity.tsx`/`audit-query-service.ts` (label/actor display incl. `agent:<name>` actor without a person link); add mapping if missing

**Checkpoint**: audit + history surfaces verified; zero-audit-on-reject proven.

---

## Phase 7: User Story 5 — Operator deploys the agent package (P2)

**Goal**: `packages/agent` — env-configured process that enrolls, persists
its credential, connects, heartbeats, and reconnects with backoff.

**Independent Test**: run the agent against a dev hub w/ enrollment token →
enrolls + connects; restart w/ same state dir → reconnects on persisted
credential; `ws://` non-localhost → refuses; `revoked`/`superseded` close →
no retry/exit; `shutdown`/drop → backoff retry.

### Tests for User Story 5

- [x] T037 [US5] Write failing unit tests in `packages/agent/test/config.test.ts`: required `HUB_URL`; `AGENT_TOKEN_FILE` preferred over `AGENT_TOKEN`; `AGENT_STATE_DIR` default; `ws://` non-loopback refused, `wss://` + `CA_BUNDLE` accepted; `MAX_JOBS` default 1; proxy vars parsed
- [x] T038 [P] [US5] Write failing unit tests in `packages/agent/test/backoff.test.ts`: exponential schedule w/ jitter + cap; reset after success
- [x] T039 [P] [US5] Write failing unit tests in `packages/agent/test/session.test.ts` (mocked `ws`): enroll → `agent-token` written 0600 under `AGENT_STATE_DIR` → connect → `hello` → heartbeat ticks; unwritable state dir → hard startup error; close `revoked` → no retry; `401` at connect (e.g. deleted agent) → terminal, no retry; close `superseded` → exit (spec clarification); `shutdown`/drop → backoff reconnect; restart loads persisted token (no re-enroll)

### Implementation for User Story 5

- [x] T040 [US5] Create `packages/agent/src/config.ts` — Zod env schema: `HUB_URL`, `AGENT_TOKEN`/`AGENT_TOKEN_FILE`, `AGENT_ENROLLMENT_TOKEN`/`AGENT_ENROLLMENT_TOKEN_FILE`, `AGENT_STATE_DIR`, `SECRETS_DIR`, `CA_BUNDLE`, `MAX_JOBS`, `HTTPS_PROXY`/`NO_PROXY`; refuse `ws://` to non-loopback (fail closed, no skip-verify)
- [x] T041 [US5] Create `packages/agent/src/backoff.ts` — exponential backoff w/ jitter + cap + reset
- [x] T042 [US5] Create `packages/agent/src/enroll.ts` — `POST /api/v1/agent/enroll` w/ enrollment token → persist credential to `<AGENT_STATE_DIR>/agent-token` (0600); unwritable → fatal
- [x] T043 [US5] Create `packages/agent/src/client.ts` — `ws` connect w/ CA bundle + proxy + `Authorization: Bearer`; send `hello` (`AGENT_PROTOCOL_VERSION`, package `agentVersion`, importer manifests via core `createImporterRegistry`, `MAX_JOBS`); heartbeat loop at `AGENT_HEARTBEAT_INTERVAL_MS`; close-reason handling (revoked → stop, superseded → exit, shutdown/network → backoff retry)
- [x] T044 [US5] Create `packages/agent/src/main.ts` — entrypoint: load config → resolve credential (file > env > persisted state > enrollment token → enroll) → connect loop w/ pino logging (no secrets in logs, ADR-090/117)
- [x] T045 [US5] Create `Dockerfile.agent` (mirror root Dockerfile layout; `CMD ["node","packages/agent/dist/main.js"]` → `componode-agent` image) and `docs/agents.md` — deployment + hardening guide: enrollment flow, token-file preference, `AGENT_STATE_DIR` volume, CA bundle/internal CAs, proxy vars, TLS requirement

**Checkpoint**: real agent container connects to a dev hub end-to-end (quickstart §manual smoke).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T046 [P] Write `docs/agent-protocol.md` — full message-level protocol spec per contracts/agent-protocol.md, incl. reserved types marked as landing in 026/027 (FR-021)
- [x] T047 [P] Update `docs/ux.md` (nav diagram, `/agents` routes, status badges, enrollment dialog) and `CONTEXT.md` (add **Enrollment Token**, **Agent Session** terms per Key Entities; **Import Agent** already present) — FR-022
- [x] T048 Run full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `pnpm --filter @componode/backend docs:api:check` — all green
- [x] T049 Execute `quickstart.md` manual smoke (dev loopback docker run, connect/revoke/delete cycle, `/activity` verification, negative `ws://` non-localhost)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup** → **Phase 2 Foundational** (blocks all stories)
- **US1 (Phase 3)** needs Foundational only
- **US2 (Phase 4)** needs Foundational + T013 (`agent-service.ts` exists; enrollment token issuance live)
- **US3 (Phase 5)** needs US1 (extends `agent-service.ts`, `routes/agents.ts`, `hooks/agents.ts`)
- **US4 (Phase 6)** needs US2 (sessions exist) + US3 (detail page exists)
- **US5 (Phase 7)** needs Foundational (protocol contracts); unit-testable alone — end-to-end smoke needs US2
- **Phase 8** needs all stories

### Parallel Opportunities

- Setup: T001 ∥ T002
- Foundational: T003→{T004,T005,T007,T008} then T006/T009/T010/T011 all [P]
- US1: T013–T015 (backend) ∥ T016 (frontend hooks)
- US2: T019 ∥ T020 test-writing
- US3: T027–T029 (backend) ∥ T030 (frontend hooks)
- US5: T037 ∥ T038 ∥ T039 test-writing; T040–T045 mostly sequential (config → enroll → client → main)

### Within Each Story

- Tests written and confirmed FAILING before implementation tasks
- Services before routes; routes + openapi.yaml land in the same phase (contract test enforces)
- Story checkpoint before advancing

---

## Implementation Strategy

### MVP First

Setup → Foundational → US1 (enrollment material end-to-end) → validate →
US2 (channel live). After US1+US2 an operator can enroll and hold a live
authenticated session — the spec's P1 spine.

### Incremental Delivery

US3 adds day-2 ops, US4 adds traceability, US5 ships the real agent
package — each independently testable at its checkpoint.

### File-Sharing Note

`agent-service.ts` and `routes/agents.ts` are built in US1 and _extended_
in US2–US4 — sequential ordering across those stories avoids merge
conflicts; frontend hooks file similarly extended in US3.

---

## Phase 9: Convergence

- [x] T050 Make the `docs/agents.md` reference in `agent-enrollment-dialog.tsx` a real clickable link (currently inline `<code>` text) per FR-019 (partial)
- [x] T051 Resolve admin visibility of version-mismatch rejections per US2/AC2 — either amend the acceptance wording (logs + `agent_stream_rejected_total` satisfy it) or surface rejected handshakes on an admin-readable surface (partial)
- [x] T052 Exit with a distinct status on `superseded`/`replaced` close reasons (e.g. `3`) so a displaced agent is distinguishable from both clean exits and credential failures, per the spec supersede clarification (partial)

---

## Phase 10: Review Remediation

- [x] T053 Send a terminal `close` frame on malformed/non-hello first frames and add `invalid_hello` to `closePayloadSchema` (core), agent `TERMINAL_CLOSE_REASONS` + exit-code map (2), and contract/docs enums — a rejected agent must exit, not retry forever (spec: protocol contract close-paths; Standards/Spec review)
- [x] T054 Make `exchangeEnrollmentToken` single-use update atomic: conditional `WHERE enrollmentTokenHash=hash AND enrollmentTokenUsedAt IS NULL AND not expired AND not revoked` inside the transaction; 0 rows → reject (ADR-116 single-use; TOCTOU)
- [x] T055 Zod-validate `?limit` on `GET /agents/:id/sessions` (coerce int 1-200, default 50; invalid → 400 `VALIDATION_FAILED`) per ADR-095
- [x] T056 Close on malformed/unknown/reserved frames per contract: `error` frame then `socket.close(1008)`; parsed-but-unhandled types (`job.*`, `credential.*`, etc.) → `UNSUPPORTED_FRAME` + close (drift signal)
- [x] T057 Reconcile orphaned sessions on hub boot: `start()` closes `agent_sessions.disconnectedAt IS NULL` rows (reason `shutdown`) and resets `status=CONNECTED` → `OFFLINE` (US2/FR-009 bounded offline)
- [x] T058 Prefill the agent name in the install command (`--name componode-agent-<name>`) per FR-019/US1 AS1
- [x] T059 Align metric labels and contract docs: `agent_stream_rejected_total` reasons → `enroll_invalid` / `version_mismatch` (contract); update `contracts/agents-api.md` enroll response `{agentToken, agent}` + rotate `200` to match shipped behavior
- [x] T060 Update contract/docs lifecycle ordering: supersede happens after hello validation (don't displace a live session for a bad hello) in `contracts/agent-protocol.md` + `docs/agent-protocol.md`
- [x] T061 Move `IMPORTER_PACKAGES` constant into core (`importer-registry.ts`); backend facade and agent client import it (lockstep single source)
- [x] T062 Remove `console.*` from production paths: `createImporterRegistry` accepts optional `onError(pkg, err)` callback; `AgentSessionService` default log → no-op (constitution VII)
- [x] T063 Audit `updateAgent` (`updated` action in `AGENT_AUDIT_ACTIONS` + `entity_changes` row — `allowedImporters` is security policy); use `trx` for `boundConfigCounts` inside transactions; drop local `HelloPayload`/`AgentSessionDto` duplicates for core types; spec FR-013 gains `updated`
- [x] T064 Document the `AGENT_STALE_AFTER_MS`/`AGENT_SESSION_SWEEP_MS`/`AGENT_HELLO_TIMEOUT_MS` overrides (test seams) in `docs/agents.md`
- [x] T065 Run gates: agent + backend + frontend tests, typecheck, lint, `docs:api:check`

---

## Phase 11: Convergence

- [x] T066 Add the `updated` event row to the audit-mapping table in `data-model.md` (`PATCH` name/`allowedImporters` → `updated` → admin actor) — constants + FR-013 already include it (partial)

---

## Phase 12: Convergence

- [x] T067 Agent-side drift signal: on unparseable or unhandled/reserved inbound frames send `error` + close socket and terminate (protocol_mismatch, exit 2) — contract is direction-agnostic (partial)
- [x] T068 Only bump `lastSeenAt`/`lastContactAt` for _accepted_ frames — move the update after frame validation in `onFrame` (data-model "last accepted frame") (partial)
- [x] T069 Use a hello-specific error code (`INVALID_HELLO`) instead of `AGENT_VERSION_MISMATCH` for invalid_hello rejections in `awaitHello`; keep version code scoped to parity mismatches (partial)
- [x] T070 Deduplicate terminal-close-reason enumeration: single `TERMINAL_CLOSE_EXIT_CODES` map in agent; derive terminal check from its keys (standards: Duplicated Code)
- [x] T071 Export `AgentEnrollment`/`EnrollAgentRequest` (and reuse `CreateImportAgentInput`/`UpdateImportAgentInput`) from core; drop frontend re-declarations in `api/types.ts` + `hooks/agents.ts` (standards: Duplicated Code)
- [x] T072 Extract jsonb cast helper for `JSON.stringify(x) as unknown as T` (3 sites) and rename `require2` (standards: Duplicated Code / Mysterious Name)

---

## Phase 13: Convergence

- [x] T073 Honor `CA_BUNDLE`/proxy env vars in `enroll.ts` via an undici dispatcher (US5/AS3 — internal-CA hub enrollment fails on first boot) (partial)
- [x] T074 Add `refetchInterval: 15_000` to `useAgent`/`useAgentSessions` (spec: ~15s UI polling) (partial)
- [x] T075 Update `docs/importer-development.md` registration section — `IMPORTER_PACKAGES` lives in core; new importers need `agent/package.json` too (contradicts)
- [x] T076 Add a changeset for spec 025 per `.changeset` convention (missing)
- [x] T077 Construct pino before `loadConfig` in `agent/src/main.ts`; drop the `console.error` (constitution VII) (partial)
- [x] T078 Centralize wire error codes (`BAD_FRAME`/`UNSUPPORTED_FRAME`/`INVALID_HELLO`/`AGENT_VERSION_MISMATCH`) as `AGENT_ERROR_CODES` in core constants (Duplicated Code)
- [x] T079 Fix `assertNameFree` check-then-insert race → catch unique violation → `AGENT_NAME_TAKEN` 409 (partial)
- [x] T080 `awaitHello`: resolve null on socket `close`/`error` pre-handshake (no hang/unhandled error) (partial)
- [x] T081 Use `toJsonb` for the raw `JSON.stringify` at `agent-service.ts` update path (partial)
- [x] T082 Model agent bearer auth in OpenAPI (`agentBearer` securityScheme on `/agent/*` routes) so generated api.md doesn't render "Public" (partial)
- [x] T083 Run gates: tests, typecheck, lint, docs:api:check, prettier

## Phase 14: Convergence

- [x] T084 Render `NEVER_CONNECTED` in the warning (yellow) tone per `docs/ux.md` status-color rule — currently `bg-muted` in `status-badge.tsx` (contradicts)
- [x] T085 Add `replaced` to the `disconnectReason` enum in `docs/openapi.yaml` and the session-record reason list in `docs/agent-protocol.md` (ADR-104 sync) (partial)
- [x] T086 Amend ADR-116: rotation exchange drops the old-credential session as `replaced` (Amendment 1 says `superseded`); `superseded` is reserved for same-credential second connect (contradicts)
- [x] T087 Apply the 23505→`AGENT_NAME_TAKEN` race fix to `updateAgent`'s PATCH path too (same check-then-write race as create) (partial)
- [x] T088 `Dockerfile.agent`: `RUN mkdir /state && chown componode:componode /state` before `USER` so the documented named-volume deploy doesn't EACCES on `persistToken`; fix `AGENT_ENROLLMENT_TOKEN_FILE` examples to include the secret/file mount (contradicts)
- [x] T089 Log `warn` on `awaitHello` rejections (timeout/malformed/non-hello first frame) — FR-014 requires logged AND counted, only the metric fires today (partial)
- [x] T090 Agent operator visibility (US2-AS2): log the `error` frame's `message` and the `close` frame's `detail`, not just `code`/`reason` (partial)
- [x] T091 Honor `hello.ok`'s `heartbeatIntervalMs` on the agent (fall back to the constant); the field is currently dead client-side (partial)
- [x] T092 `deleteAgent` should drop the live session with `revoked`, not `shutdown` — the contract reserves `shutdown` for reconnect-able drops; a deleted agent's reconnect is terminal (contradicts)
- [x] T093 Make the supersede claim atomic in `attach()` — `live.set` before the async work so two concurrent handshakes can't both pass `live.get` (FR-010 race) (partial)
- [x] T094 Hygiene sweep (standards judgement calls): remove uncalled `isLive()`; merge `resolveAgentToken`/`resolveEnrollmentToken` via a shared helper; extract shared proxy-resolution helper for enroll/ws legs; `AGENT_POLL_INTERVAL_MS` constant for the three `refetchInterval`s; shared `parseImporterCsv` for the two pages; typed `Updateable<ImportAgentRow>` instead of `Record<string, unknown>` in `updateAgent`; drop the redundant limit re-clamp in `listAgentSessions`; add `EnrollmentGrant` type for the `{agentName, enrollment}` clump; fix stale injected-package-list wording in `research.md`/`plan.md` (R6 vs T061)
- [x] T095 Run gates: tests, typecheck, lint, docs:api:check
