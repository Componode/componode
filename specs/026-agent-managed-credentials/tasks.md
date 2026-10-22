---
description: "Task list for Agent-Managed Credentials (spec 026)"
---

# Tasks: Agent-Managed Credentials

**Input**: Design documents from `/specs/026-agent-managed-credentials/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/agent-protocol.md, contracts/credential-api.md, quickstart.md

**Tests**: Constitution VI makes test-first non-negotiable — every story
phase writes failing tests before implementation.

**Organization**: Tasks grouped by user story. US3 (hub dispatch) and US4
(agent handler) are the two halves of the same wire feature — either can
land first since each is tested against a fake peer; commit order below
keeps spec priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on incomplete tasks
- **[Story]**: US1–US5 per spec.md

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Confirm baseline: `pnpm lint && pnpm typecheck && pnpm test` green on `feature/026-agent-managed-credentials` before any change (no new packages or dependencies in this spec)

---

## Phase 2: Foundational (Blocking Prerequisites)

**CRITICAL**: No user story work begins until this phase completes.

- [X] T002 [P] Create `packages/core/src/constants/credential-kind.ts` — `CREDENTIAL_KINDS = ["STORED","AGENT_MANAGED"] as const` + `CredentialKind` type + `CREDENTIAL_KIND_META` labels (`STORED`: "Stored in Componode", `AGENT_MANAGED`: "Resolved on an Import Agent"); export via `packages/core/src/constants/index.ts`
- [X] T003 [P] Extend error vocabulary — add `AGENT_OFFLINE`, `AGENT_TEST_TIMEOUT`, `CREDENTIAL_NO_BOUND_AGENT`, `CREDENTIAL_KIND_MISMATCH` to the `ERROR_CODES` array in `packages/core/src/constants/error-codes.ts` (the `ErrorCode` union source) AND `ERROR_TYPES` in `packages/core/src/constants/error-types.ts` with statuses 503/504/400/400; extend `packages/core/src/constants/import-agent.ts` — add `"credential_test_dispatched"` to `AGENT_AUDIT_ACTIONS` and `AGENT_CREDENTIAL_TEST_TIMEOUT_MS = 30_000`
- [X] T004 Extend `packages/core/src/schemas/credential.ts` — `secretRefSchema` (`z.union`/`refine` enforcing exactly one of `{env: string.min(1)}` / `{file: string.min(1)}`), `secretRefMapSchema` (`z.record(secretKeyPattern, secretRefSchema)`, ≥1 entry, ≤64 KB serialized — mirror `secretsSchema` refinements); `createCredentialSchema` becomes kind-discriminated (e.g. `z.preprocess` defaulting absent `kind` to `"STORED"` before `z.discriminatedUnion`, or one object schema + `superRefine` on the `secrets`/`secretRefMap` pairing — a `.default()` on the discriminator itself does NOT fire inside `discriminatedUnion`); `updateCredentialSchema` gains optional `secretRefMap`; export `SecretRef`/`SecretRefMap` types
- [X] T005 Move shared secret resolution to core (research R6): create `packages/core/src/utils/secrets.ts` exporting `SecretRef` interface, `EnvSecretResolver` (env + `SECRETS_DIR`-confined file resolution, absolute-path/traversal rejection — port verbatim from `packages/backend/src/utils/secret-resolver.ts`), `redactSecrets`; re-export from `packages/backend/src/utils/secret-resolver.ts` so existing imports/tests keep passing; export via core `index.ts`
- [X] T006 Promote reserved frames in `packages/core/src/contracts/agent-protocol.ts`: `credentialTestPayloadSchema` `{testId: uuid, credentialId: uuid, importerName: string.min(1), scope?: record, secrets: secretRefMapSchema}` and `credentialTestResultPayloadSchema` `{testId: uuid, ok: boolean, error?: string}` into `agentMessageSchemas`; remove both from `FUTURE_AGENT_MESSAGE_TYPES`
- [X] T007 [P] Extend `packages/core/src/contracts/credential.ts` — `Credential` gains `kind: CredentialKind` + `secretRefMap?: Record<string, SecretRef>`; `CredentialTestResult` gains `agent?: string`
- [X] T008 Create migration `packages/backend/src/db/migrations/017_agent_managed_credentials.ts` per data-model.md — `credentials.kind text NOT NULL DEFAULT 'STORED'` + CHECK from `CREDENTIAL_KINDS`, `credentials.secretRefMap jsonb`, drop NOT NULL on `encryptedPayload`, coherence CHECK `credentials_kind_payload_check`; matching `down()` restores NOT NULL (safe: no AGENT_MANAGED rows in down)
- [X] T009 Update `packages/backend/src/db/types.ts` — `CredentialRow` gains `kind: string`, `secretRefMap: Record<string,{env?:string;file?:string}> | null`; `encryptedPayload: string | null`
- [X] T010 [P] Add `agent_credential_tests_total{agent,result}` counter to `packages/backend/src/plugins/metrics.ts`
- [X] T011 Write failing tests for the foundation: `packages/backend/test/integration/migrations.test.ts` addition (kind CHECK rejects invalid kind; coherence CHECK rejects STORED-without-payload and AGENT_MANAGED-with-payload); `packages/core` schema tests for `secretRefMapSchema` (exactly-one-source, unknown ref type rejected, key pattern, dup detection impossible-by-shape); resolver parity tests proving core `EnvSecretResolver` behaves identically to the pre-move backend one

**Checkpoint**: contracts, schema, shared resolver, and error vocabulary ready — story phases can start.

---

## Phase 3: User Story 1 — Define a reference-only credential (P1) — MVP

**Goal**: `AGENT_MANAGED` credentials CRUD: ref-map storage, no values, source-type key hints, list badge, form mode selector.

**Independent Test**: create an agent-managed credential via API/UI → stores refs, never values; kind badge renders; update edits the map in place; kind cannot change.

### Tests for User Story 1

- [X] T012 [US1] Write failing integration tests in `packages/backend/test/integration/credentials-agent-managed.test.ts`: `POST /credentials {kind:"AGENT_MANAGED", secretRefMap}` → 201, response carries `kind`+`secretRefMap`, `keyHints` = `{key:"env"|"file"}`, no encrypted payload readable anywhere; `secrets` on AGENT_MANAGED create and `secretRefMap` on STORED create → `400 VALIDATION_FAILED`; `GET /credentials`+`/{id}` expose `kind`/`secretRefMap`; `PATCH` with new `secretRefMap` → 200 (in-place edit, no dependent re-validation); `PATCH secrets` on AGENT_MANAGED → 400 kind error; `PATCH` attempting kind change → 400; revoke + delete-when-referenced unchanged; no master key configured → AGENT_MANAGED create still succeeds (no keyring needed) while STORED create still fails `CREDENTIAL_KEY_UNAVAILABLE`

### Implementation for User Story 1

- [X] T013 [US1] Extend `packages/backend/src/services/credential-service.ts` — `createCredential` branches on `kind`: AGENT_MANAGED skips `requireKeyring`/`encryptSecrets`, stores `secretRefMap` (`toJsonb`), `keyHints[key]=ref source type`, `encryptedPayload: null`; `updateCredential` accepts `secretRefMap` for AGENT_MANAGED rows (action `updated`, `changes.secretRefKeys` = key names only), rejects `secrets` on AGENT_MANAGED and `secretRefMap` on STORED with `CREDENTIAL_KIND_MISMATCH`; `toApi` emits `kind` + `secretRefMap`
- [X] T014 [US1] Update `docs/openapi.yaml` credential schemas — `kind` discriminator, `secretRefMap` property, AGENT_MANAGED request example; run `pnpm --filter @componode/backend docs:api`; confirm `api-docs-contract` test passes
- [X] T015 [P] [US1] Update `packages/frontend/src/api/types.ts` (+ `kind`, `secretRefMap`, test-result `agent`) and the credential hooks in `packages/frontend/src/api/hooks/` to carry the new fields
- [X] T016 [US1] Update `packages/frontend/src/components/credential-form.tsx` — mode selector "Where do the values live?" (`Stored in Componode` default | `Resolved on an Import Agent`); agent-managed mode swaps value inputs for per-key rows (key + `env`/`file` select + reference name); edit mode renders the stored ref map for AGENT_MANAGED credentials
- [X] T017 [US1] Update `packages/frontend/src/pages/credentials.tsx` — `Agent-managed` badge on `kind === "AGENT_MANAGED"` rows (same badge conventions as status chips); detail dialog renders the ref map + source-type hints; the secret-value last-4 hint rendering applies to STORED only

**Checkpoint**: US1 independently testable — AGENT_MANAGED CRUD works, nothing secret can enter the record.

---

## Phase 4: User Story 2 — Uniform linkage, kind enforcement (P1)

**Goal**: `credentialIds` linkage unchanged; executor-kind mismatches
rejected at save; coverage checks read ref-map keys transparently.

**Independent Test**: linking an AGENT_MANAGED credential to a hub config
fails with `CREDENTIAL_KIND_MISMATCH`; a STORED credential on an
`agentId`-bound config (inserted directly) fails the same way; coverage
passes with declared keys.

### Tests for User Story 2

- [X] T018 [US2] Write failing integration tests in `packages/backend/test/integration/credential-kind-binding.test.ts`: config create/update linking AGENT_MANAGED credential → `400 CREDENTIAL_KIND_MISMATCH` naming credential + reason; direct-DB `agentId` on a config + STORED credential link → `400 CREDENTIAL_KIND_MISMATCH`; AGENT_MANAGED keys satisfy `assertSecretCoverage` (save succeeds when `agentId` is set directly in DB); OIDC `clientSecretCredentialId` → AGENT_MANAGED → 400; `resolveImportSecrets` on AGENT_MANAGED → `CREDENTIAL_KIND_MISMATCH` (defense-in-depth); duplicate key across credential+legacy-ref still `CREDENTIAL_KEY_COLLISION`

### Implementation for User Story 2

- [X] T019 [US2] Extend `validateSecretSources` in `packages/backend/src/services/importer-config-service.ts` — select `kind` on credential lookup; AGENT_MANAGED + config `agentId` unset → `CREDENTIAL_KIND_MISMATCH` ("requires a config bound to an import agent"); STORED + `agentId` set → `CREDENTIAL_KIND_MISMATCH` ("agent-bound configs require agent-managed credentials"); update path reads the config row's `agentId`, create path treats it as null
- [X] T020 [US2] Add the defense-in-depth guard in `packages/backend/src/utils/secret-resolver.ts` — `CredentialRecord` gains `kind`; AGENT_MANAGED record reaching `resolveImportSecrets` → `CREDENTIAL_KIND_MISMATCH` before any decrypt attempt
- [X] T021 [US2] Reject non-STORED credentials for `clientSecretCredentialId` in `packages/backend/src/services/oidc-service.ts` → `CREDENTIAL_KIND_MISMATCH`
- [X] T022 [US2] Update `packages/frontend/src/components/importer-config-form.tsx` — AGENT_MANAGED credentials are excluded from the credential selector for hub-executed configs with a hint that agent-bound selection arrives with remote execution

**Checkpoint**: US1+US2 hold — mismatched bindings are impossible through every write path.

---

## Phase 5: User Story 3 — Remote credential test (P2)

**Goal**: `POST /credentials/{id}/test` on an AGENT_MANAGED credential
dispatches `credential.test` over the agent stream and returns the agent's
result with a bounded timeout.

**Independent Test**: with a bound config (direct `agentId` insert) and a
WS test client answering `credential.test`, the API returns the agent's
`ok/error` + `agent` name; offline/timeout/no-binding produce the named
errors.

### Tests for User Story 3

- [X] T023 [US3] Write failing integration tests in `packages/backend/test/integration/credential-test-remote.test.ts` (bind `importer_configs.agentId` directly, drive a fake agent over real `ws` like `agent-channel.test.ts`): happy path → `{ok:true, agent:<name>}` + `credential_test_dispatched` audit on the agent + `tested` audit on the credential + `lastUsedAt` stamped; no agent-bound config → `400 CREDENTIAL_NO_BOUND_AGENT`; bound agent offline → `503 AGENT_OFFLINE`; result never arrives → `504 AGENT_TEST_TIMEOUT` (inject small `AGENT_CREDENTIAL_TEST_TIMEOUT_MS`); agent disconnects mid-test → pending rejected, request fails not hangs; bound config with different `importerName` doesn't count as a binding; multi-agent binding picks a connected agent and the result names it; unknown `testId` result frames are ignored
- [X] T024 [P] [US3] Write failing unit tests in `packages/backend/test/unit/agent-session-service.test.ts` (extend): pending-map registration/resolution/rejection, timeout path, closeSession rejecting all pending dispatches

### Implementation for User Story 3

- [X] T025 [US3] Extend `packages/backend/src/services/agent-session-service.ts` — `pendingTests: Map<testId, {resolve, reject, timer}>`; `dispatchCredentialTest(agentId, payload)` → live-session lookup (none → throw `AGENT_OFFLINE`), send `credential.test`, register pending with `AGENT_CREDENTIAL_TEST_TIMEOUT_MS` (env-tunable) → reject `AGENT_TEST_TIMEOUT`; `onFrame` handles `credential.test.result` → resolve by `testId` (unknown id ignored); `closeSession` rejects all pending entries
- [X] T026 [US3] Extend `testCredential` in `packages/backend/src/services/credential-service.ts` — AGENT_MANAGED branch: gather configs referencing the credential via `importer_config_credentials` join `importer_configs` where `agentId IS NOT NULL` AND `importerName = input.importerName` → none: `CREDENTIAL_NO_BOUND_AGENT`; pick earliest-created config whose agent is CONNECTED → all offline: `AGENT_OFFLINE`; call `dispatchCredentialTest`; stamp `lastUsedAt`; audit `credential_test_dispatched` on `import_agent` (admin actor) + `tested` on credential with `changes.agent`; return `{ok, error, agent}`; STORED branch unchanged
- [X] T027 [US3] Wire the session service into `testCredential`'s callers — `routes/credentials.ts` passes the shared `AgentSessionService` instance (same instance `agent-channel.ts` owns; lift into `app.ts` plugin scope if currently route-local); `agent_credential_tests_total{agent,result}` increments
- [X] T028 [P] [US3] Update `packages/frontend/src/components/credential-test-dialog.tsx` — display `agent` when present ("Ran on agent <name>") and surface the new error codes with actionable copy

**Checkpoint**: remote test path complete hub-side; verified against a fake agent until US4 lands the real handler.

---

## Phase 6: User Story 4 — Agent-side resolution (P2)

**Goal**: the agent handles `credential.test` — resolves refs against its
own env/`SECRETS_DIR`, runs the importer's `testSecrets`, replies with
`ok/error`; values never logged/persisted/transmitted.

**Independent Test**: agent unit tests feed frames into the session
handler — env/file resolution, confinement rejection, missing env var,
missing `testSecrets`, log inspection shows keys+sources only.

### Tests for User Story 4

- [X] T029 [US4] Write failing unit tests in `packages/agent/test/credential-test.test.ts`: `credential.test` → resolves refs → `credential.test.result {ok}`; missing env var → `{ok:false}` naming key + `env` source; `file` ref resolves under `SECRETS_DIR` (default `/run/secrets`); `../` escape and absolute path rejected; unknown ref source → `{ok:false}`; importer without `testSecrets` → `{ok:false}` `MANIFEST_NO_TEST`; captured logs contain key names + source types and never resolved values; two credentials sharing a key name resolve independently
- [X] T030 [P] [US4] Write failing unit tests in `packages/core/test/utils/secrets.test.ts` for the shared resolver's confinement boundary — `EnvSecretResolver` under a custom `SECRETS_DIR` (default `/run/secrets`)

### Implementation for User Story 4

- [X] T031 [US4] Create `packages/agent/src/secrets.ts` — agent-facing resolver bound to `cfg.secretsDir ?? "/run/secrets"` wrapping core `EnvSecretResolver`; `resolveRefMap(map)` → `Record<key,string>`; resolution-event logging `{key, source:"env"|"file"}` via the injected pino log; `redactSecrets` applied to any structured log field that could carry values
- [X] T032 [US4] Add the `credential.test` handler in `packages/agent/src/client.ts` — on the frame: `resolveRefMap(payload.secrets)` → registry `getImporter(payload.importerName)` (reuse the `createImporterRegistry` loader used for the hello manifest list) → `importer.testSecrets(secrets, payload.scope)` → `sendFrame("credential.test.result", {testId, ok, error?})`; remove `credential.test` from the unknown-frame `rejectFrame` path; failures → `{ok:false,error}` naming key+source, never values; unknown `importerName` → `{ok:false}`

**Checkpoint**: US3+US4 together make the remote test real — re-run T023's happy path against the actual agent process, not the fake client.

---

## Phase 7: User Story 5 — Agent-side lifecycle semantics (P3)

**Goal**: rotation is purely agent-host-side; `expiresAt` advisory; revoke/
delete rules unchanged and verified for the new kind.

**Independent Test**: edit env/file on the agent host only → next
resolution returns the new value with zero hub changes; expiry shows
advisory text; revoke then resolve → fails.

### Tests for User Story 5

- [X] T033 [US5] Extend `packages/backend/test/integration/credentials-agent-managed.test.ts` — `expiresAt` on AGENT_MANAGED returns/warns identically to STORED (advisory only); `PATCH secretRefMap` audit entry carries key names not values; revoke → subsequent `POST /test` fails `CREDENTIAL_REVOKED`; delete-while-referenced → `409 CREDENTIAL_IN_USE`

### Implementation for User Story 5

- [X] T034 [US5] Ensure expiry-warning plumbing covers AGENT_MANAGED — `checkExpiryWarning` path in `secret-resolver.ts`/`credential-service.ts` treats both kinds identically (advisory display metadata; hub never claims to observe real expiry)
- [X] T035 [P] [US5] Verify agent-side rotation is a no-op on the hub — no code expected; add the doc assertion to `docs/agents.md` and a unit test asserting the resolver reads env at call time (not cached)

**Checkpoint**: all five stories independently green.

---

## Phase 8: Polish & Cross-Cutting

- [X] T036 [P] Write ADR-117 **Amendment 1** in `researches/adrs/ADR-117-agent-managed-credentials.md` — ratify the four new `ERROR_CODES` (`AGENT_OFFLINE`, `AGENT_TEST_TIMEOUT`, `CREDENTIAL_NO_BOUND_AGENT`, `CREDENTIAL_KIND_MISMATCH`), `credential_test_dispatched` in `AGENT_AUDIT_ACTIONS`, `agent_credential_tests_total` metric, `testId` correlation convention, `keyHints` source-type convention; add the amendment line to `researches/architecture-decisions.md` index
- [X] T037 [P] Update `docs/agent-protocol.md` — promote `credential.test`/`.result` from reserved to implemented (frame shapes per contracts/agent-protocol.md, failure-mode table)
- [X] T038 [P] Update `docs/agents.md` — `SECRETS_DIR` active (drop "reserved" note); hardening section: platform secret mounts over env vars (`/proc`, `docker inspect`, crash-dump leaks), agent token gets identical treatment, encryption at rest delegated to platform (k8s `encryptionConfiguration`, Swarm secrets, Vault agent → files)
- [X] T039 [P] Update `docs/ux.md` (credential form modes, badge) and `CONTEXT.md` (agent-managed credential term entry) per ADR-103/ADR-104
- [X] T040 Update `docs/openapi.yaml` residuals — confirm every changed schema/endpoint is covered; `pnpm --filter @componode/backend docs:api` regen
- [X] T041 Run `quickstart.md` end-to-end + full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; fix fallout

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: immediate
- **Foundational (Phase 2)**: blocks all stories — schema, contracts, shared resolver, error vocabulary
- **US1 (Phase 3)**: needs Phase 2 (migration, schemas) — MVP
- **US2 (Phase 4)**: needs Phase 2 + US1's `toApi`/create path (kind exists to be enforced)
- **US3 (Phase 5)**: needs Phase 2 (frames) + US1 (kind branch point); agent handler not required (fake WS peer)
- **US4 (Phase 6)**: needs Phase 2 (frames + shared resolver) only — can parallel US3
- **US5 (Phase 7)**: needs US1 (lifecycle paths exist)
- **Polish (Phase 8)**: after all stories

### Within Each Story

- Failing tests first (constitution VI) — verify red before implementing
- Schemas/constants before services; services before routes; backend before frontend wiring

### Parallel Opportunities

- T002 ∥ T003 ∥ T007 ∥ T010 (different files)
- T004 ∥ T005 ∥ T006 (different core files — T006 imports `secretRefMapSchema` from T004, so sequence T004→T006)
- US3 ∥ US4 (hub dispatch vs agent handler — fake peers decouple them)
- T036–T039 docs tasks fully parallel

---

## Parallel Example: US3 + US4

```text
# Hub dispatch and agent handler are independent halves:
T025/T026/T027 — hub-side dispatch (tested vs fake ws peer)
T031/T032      — agent-side handler (unit-tested frames in/out)
# Converge: re-point T023's happy path at the real agent process
```

---

## Implementation Strategy

### MVP First

Setup → Foundational → US1 (credential flavor exists, creatable, listed,
badged). US1 alone is a deployable increment — the kind exists and
mismatched use is already rejected.

### Incremental Delivery

1. US2 — binding safety (rejection is the shippable behavior pre-027)
2. US3 ∥ US4 — remote test path, latent until 027 binding lands
3. US5 — lifecycle semantics + docs
4. Polish — ADR amendment + doc surfaces + full gates

### Notes

- Every `AGENT_MANAGED` write path must prove no secret value can persist:
  create/update schemas reject `secrets`, the DB CHECK rejects payload +
  ref-map combos, and `toApi` never emits `encryptedPayload`.
- The `credentialIds` junction and coverage checks are intentionally
  untouched — `keyHints` keys = declared keys for both kinds (research R2).
- Binding (`importer_configs.agentId` settable) and `job.assign` remain
  spec 027 — do not implement them here; test the latent paths via direct
  DB binding.

## Phase 9: Convergence

- [X] T042 Align the `agent_credential_tests_total{result}` label enumeration in `docs/agent-protocol.md` and ADR-117 Amendment 1 with the emitted values (`ok`/`error`/`offline`/`timeout` in `credential-service.ts`) per FR-020 (partial)
- [X] T043 Rename the credential-form kind selector label/options to the spec's "Where do the values live?" framing (`Stored in Componode` / `Resolved on an Import Agent`) per FR-021 (partial)
- [X] T044 Map the new remote-test error codes (`AGENT_OFFLINE`, `CREDENTIAL_NO_BOUND_AGENT`, `AGENT_TEST_TIMEOUT`) to actionable hint copy in `credential-test-dialog.tsx` per T028 (partial)
- [X] T045 Run the `quickstart.md` live walkthrough (running hub + real agent container over a real channel) and fix any fallout before merge per T041 (partial)
- [X] T046 Isolate core's node-only secret-resolver exports from the browser-bundled barrel (`node:fs`/`node:path` are stubbed by rolldown in the frontend build — a browser call would silently fail) per plan/core-leaf decision (contradicts)

## Phase 10: Review Hardening (code-review round 1 — `4a4463c`)

- [X] T047 [CRITICAL] Filter the no-master-key fatal check to `kind = 'STORED'` so a hub holding only AGENT_MANAGED credentials boots without a keyring per ADR-117 (`credential-boot.ts` — the re-encrypt query has the filter, the count does not); add a regression test in `credential-boot.test.ts`
- [X] T048 Restrict `secretRefMap` to the credential detail/mutation responses — `GET /credentials` list exposes `keyHints` (source types) only per ADR-117 Amendment 1 (`credential-service.ts` `toApi`/`listCredentials`, `openapi.yaml` Credential schemas, `credentials.tsx` list badges via `keyHints`, `credential-lifecycle-dialogs.tsx` detail/rotate fetch `useCredential` for the ref map); regen `docs/api.md`
- [X] T049 Sanitize agent `credential.test` failures: typed `SecretRefError` codes in the core resolver with messages that name the ref and never absolute paths (ADR-096), per-key wrap naming key + source type per US4 edge case, and `MANIFEST_NO_TEST…` token for missing `testSecrets` per contracts/agent-protocol.md (`core/utils/secrets.ts`, `agent/secrets.ts`, `agent/client.ts`)
- [X] T050 Write `credential_test_dispatched` audit + `lastUsedAt` at dispatch (send) time, and a `tested` outcome row on timeout/close-reject, per FR-018 (`agent-session-service.ts` `onDispatched` seam, `credential-service.ts`)
- [X] T051 Add pino `redact` paths to the agent logger mirroring the hub's discipline per FR-013 (`agent/src/logging.ts`, both `pino()` sites in `agent/src/main.ts`)
- [X] T052 Confine `file` refs through `realpath` so a symlink inside `SECRETS_DIR` cannot escape per FR-011 (`core/utils/secrets.ts` + test — junction/dir-symlink with EPERM skip on Windows)
- [X] T053 Rename the `credential.test` payload field `secrets` → `secretRefMap` across schema, hub dispatch, agent handler, tests, and contract/protocol docs (`agent-protocol.ts`, `credential-service.ts`, `agent/client.ts`, `contracts/agent-protocol.md`, `docs/agent-protocol.md`)
- [X] T054 Consolidate resolution: core `resolveSecretsFromMap` gains an `onResolved(key, source)` callback and `refSource()` helper; agent `resolveRefMap` delegates (kills the duplicated loop and the repeated env/file switches); `kind?: CredentialKind` in `api/hooks/credentials.ts`
- [X] T055 Extract the shared row-editor shell from `SecretEntriesEditor`/`SecretRefEntriesEditor` (Duplicated Code) in `credential-form.tsx`
- [X] T056 Fix docs drift: `docs/api.md` credential-create note (`kind`/`secretRefMap`), `docs/agents.md` `SECRETS_DIR` config row → active, add `AGENT_CREDENTIAL_TEST_TIMEOUT_MS` to hub timing overrides, note realpath confinement (`docs/api.md`, `docs/agents.md`)

## Phase 11: Convergence

- [X] T057 Amend `contracts/credential-api.md` — the response-object section claims `secretRefMap` is present on "all credential endpoints"; state it is detail/mutation-only with `keyHints` source types on list responses per ADR-117 Amendment 1 (partial)

## Phase 12: Review Hardening (code-review round 2 — `4dfb697`)

- [X] T058 [HIGH] Sanitize non-resolution errors in `handleCredentialTest` — the catch-all at `agent/src/client.ts:127-128` forwards raw `err.message`; a `testSecrets` throw embedding absolute paths crosses the wire per ADR-096 + agent-protocol.md:153 (partial)
- [X] T059 [HIGH] `send()` silently no-ops when `readyState !== OPEN` yet `onDispatched` still fires (`agent-session-service.ts:431-438,530-535`) — check socket OPEN before send and reject `AGENT_OFFLINE` immediately, skipping the dispatch audit (partial)
- [X] T060 [MEDIUM] Remote test path performs no required-key coverage check — a dropped required key surfaces as a generic importer error instead of `CREDENTIAL_MISSING_KEY` naming the key per spec edge case + Clarifications (`credential-service.ts` AGENT_MANAGED test branch) (partial)
- [X] T061 [MEDIUM] Write-time ref validation hardening: reject absolute/`..` `file:` refs in `secretRefMapSchema` (confinement is currently resolution-time only); make `testCredentialSchema` `.strict()` per ADR-095 (`schemas/credential.ts`) (partial)
- [X] T062 [LOW] Align `frontend/src/api/types.ts` with the spec-025 pattern — re-export `CredentialKind`/`Credential`/`SecretRefMap`/`CredentialTestResult` from `@componode/core` instead of hand-declaring (partial)
- [X] T063 [LOW] Consume `CREDENTIAL_KIND_META` in `credential-form.tsx` (it hardcodes the same labels the constant exports) or drop the constant per Speculative Generality (`constants/credential-kind.ts`) (unrequested)
- [X] T064 [LOW] Fix `openapi.yaml` POST /credentials `label maxLength: 200` → 100 to match the Zod schema (partial)
- [X] T065 [LOW] Doc alignment: `spec.md` US1.2 still says list APIs "contain the declared references" (stale vs Amendment-1 list/detail split); `data-model.md` claims `keyVersion` DEFAULT 1 inert but `createCredential` inserts `keyVersion: 0` for AGENT_MANAGED — reconcile both docs (partial)

## Phase 13: Review Hardening (code-review round 3 — `c5c2ca7`)

- [X] T066 [HIGH] Guard the dispatch-bookkeeping promise in `credential-service.ts`: `dispatched` is created at send time but only awaited after dispatch settles — a mid-flight rejection crashes Node (unhandled rejection) and a late `await dispatched` can mask the original error. Make the IIFE catch+log failures (best-effort bookkeeping) and drop the redundant `didDispatch` flag (use `dispatched !== null`) (contradicts)
- [X] T067 [MEDIUM] Coverage ordering + dedup: a bound config failing `assertSecretCoverage` must not abort the candidate loop — collect the missing-key error, keep trying other bound configs (US3.5 "any bound agent is a valid probe"), and throw the coverage error only when no candidate dispatches (prefer MISSING_KEY over OFFLINE). Hoist the per-config provided-keys query to one grouped query for all bound configIds (partial)
- [X] T068 [MEDIUM] Mask resolved secret values in agent-side error text: `handleCredentialTest`'s `log.warn({ err })` can emit importer-thrown text embedding resolved values (FR-012 conditional breach) — add a `maskSecretValues(text, secrets)` helper in core secrets utils and apply it (`agent/src/client.ts`, `core/utils/secrets.ts`) (partial)
- [X] T069 [LOW] openapi test-endpoint error enumeration omits `CREDENTIAL_MISSING_KEY` (reachable since T060) — add it (`docs/openapi.yaml`, regen `docs/api.md` if rendered) (partial)
- [X] T070 [LOW] Validation parity: frontend `credential-form.tsx` file-ref check is weaker than the server schema (misses `..`, leading `\`, drive-relative `C:foo`) — align; bound `importerName` in `testCredentialSchema` (echoed into error messages) (partial)
- [X] T071 [LOW] spec.md edge case "duplicate key names inside one credential's map → rejected" is unenforceable (JSON.parse collapses duplicates before validation) — clarify the edge-case wording (partial)
