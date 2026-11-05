# Tasks: Guided Docker importer setup

**Input**: Design documents from `/specs/063-docker-importer-onboarding/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/docker-target-probe-api.md`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Tests are included per the constitution's test-first principle: failing tests land in Phase 1, implementation follows in story phases.

## Phase 1: Setup — failing tests first

- [X] T001 [P] Add failing backend integration tests for `POST /api/v1/docker-targets/probe` covering: ok path (mocked `getImporter("docker").testSecrets`), `ok:false` sanitized error, malformed profile → 400 before network, `secrets`+`credentialId` both → 400, unknown `credentialId` → 404 `CREDENTIAL_NOT_FOUND`, credential missing required keys → 400 `CREDENTIAL_MISSING_KEY`, non-admin → 403, and zero writes to `docker_targets`/`credentials`/`importer_configs` in `packages/backend/test/integration/docker-targets.test.ts`
- [X] T002 [P] Add failing frontend unit tests for the pure wizard-logic module — transport→canonical-secret-key mapping (tcp: `clientCert`/`clientKey` required + `caCert` optional; ssh: `sshPrivateKey` required + `sshPassphrase` optional; socket/context: none), profile building with `*Key` fields derived and optional keys omitted when no value supplied, target-selector slug suggestion, credential key-coverage predicate — in `packages/frontend/src/test/unit/docker-setup-logic.test.ts`
- [X] T003 [P] Add failing frontend component tests for the wizard flow (transport pick → route fields → secrets step skipped for socket/context → identity → probe gating → sequential creates → navigate to config; partial-failure reporting) and for the Advanced disclosure (docker's `environmentMap`/`componentIdLabel`/`sourceKey` collapsed by default, expandable, round-trip unchanged; other importers unaffected) in `packages/frontend/src/test/unit/docker-setup-wizard.test.tsx` and `packages/frontend/src/test/unit/importer-form-scope.test.tsx`

## Phase 2: Foundational

- [X] T004 Add `probeDockerTargetSchema` (`.strict()`: `profile` required record, `secrets` optional record ≤64 KB, `credentialId` optional uuid, refine rejects both `secrets` and `credentialId` present) plus `ProbeDockerTargetInput` type in `packages/core/src/schemas/docker-target.ts`; export both from `packages/core/src/index.ts`
- [X] T005 [P] Add `useProbeDockerTarget()` mutation hook posting `{profile, secrets?}` or `{profile, credentialId?}` to `/docker-targets/probe` returning `{ok: boolean; error?: string}` in `packages/frontend/src/api/hooks/docker-targets.ts`

## Phase 3: US2 — Verify a route before any records exist (P1)

**Goal**: Admins can probe a route profile + secret material with zero persistence.

**Independent Test**: call the probe with valid/invalid profiles and secret sources per `contracts/docker-target-probe-api.md`; verify `{ok,error?}` results and that no rows are created.

- [X] T006 Implement `probeDockerTarget(input, actor)` in `packages/backend/src/services/docker-target-service.ts`: `validateProfile(input.profile)` (400 on invalid, before network), resolve secrets — inline verbatim or `credentialId` → load STORED credential, `decryptSecrets`, coverage-check `profileSecretKeys(profile)` (`CREDENTIAL_MISSING_KEY` on gap) — then `getImporter("docker").testSecrets(secrets, {}, profile)`; return `{ok, error?}`; write no audit row, touch no tables
- [X] T007 Add `POST /docker-targets/probe` route with `requireRole("importer:target:test")` and `probeDockerTargetSchema.safeParse` → `invalid(reply, issues)` on failure in `packages/backend/src/routes/docker-targets.ts`
- [X] T008 Document `/docker-targets/probe` in `docs/openapi.yaml` (tag Importers, `x-permission: "importer:target:test"`, request/response per contract) and regenerate `docs/api.md` via `pnpm docs:api` in `packages/backend`; confirm `pnpm docs:api:check` and `api-docs-contract.test.ts` pass

## Phase 4: US1 — Set up a Docker import in one guided flow (P1)

**Goal**: ADMIN completes transport → route → secrets (new values) → identity → probe → create → land on config, for all four transports.

**Independent Test**: run the wizard against a reachable engine (socket path) and a mocked probe; verify target + config created, credential created for tcp/ssh, and navigation to the new config.

- [X] T010 Implement `packages/frontend/src/ux/components/importers/docker-setup-logic.ts`: `DOCKER_SETUP_TRANSPORTS` metadata (labels, descriptions, per-transport route fields minus `*Key`, plain-language hints incl. socket mount warning), `TRANSPORT_SECRET_KEYS` canonical map, `buildTargetProfile()`, `suggestTargetId()`, `schedulePresets` reuse — pure, no React
- [X] T011 Implement `packages/frontend/src/ux/components/importers/docker-setup-wizard.tsx`: stepper with Route / Secrets (masked PEM inputs, new-values only) / Identity (label, editable suggested targetId with immutability note, schedule preset, enabled, optional description) / Verify & create steps; probe via `useProbeDockerTarget`; on `ok:true` run `useCreateDockerTarget` → `useCreateCredential` (STORED, canonical keys, label `Docker — <target label>`) → `useCreateImporterConfig` (`scope:{targetId}`, `agentId:null`, `credentialIds`, `secretRefs:[]`) in order; stop on first failure and render completed/failed steps with links; no agent-execution selector
- [X] T012 Create page `packages/frontend/src/ux/app/importers/docker-setup.tsx` composing the wizard and register `importers/new/docker` with `authed(..., "ADMIN")` in `packages/frontend/src/routes.tsx`
- [X] T013 [P] Add a "Guided setup" button (ADMIN-only render) linking to `/importers/new/docker` in the PageHeader actions of `packages/frontend/src/ux/app/importers/index.tsx`
- [X] T014 [P] Add a dismissible hint/link to `/importers/new/docker` in `packages/frontend/src/ux/components/importers/importer-form.tsx` shown only when `importerName === "docker"` and not editing

## Phase 5: US3 — Reuse credentials without re-typing secrets (P2)

**Goal**: Secrets step offers existing STORED credentials covering the transport's canonical keys; probe uses `credentialId` mode.

**Independent Test**: seed a STORED credential with canonical mTLS keys, run wizard for tcp, verify it is offered/selectable and no new credential is created; verify a credential missing a key is not offered.

- [X] T015 Extend `docker-setup-logic.ts` with `credentialCoversKeys(credential, requiredKeys)` predicate over `CredentialListItem.keyHints` (STORED + ACTIVE only)
- [X] T016 Add the reuse picker to the wizard secrets step in `docker-setup-wizard.tsx`: list qualifying credentials, skip value inputs on selection, pass `credentialId` (not `secrets`) to the probe, and omit credential creation while still linking `credentialIds:[id]` on the config

## Phase 6: US4 — Find advanced options without clutter (P2)

**Goal**: Docker's `environmentMap`, `componentIdLabel`, `sourceKey` collapse under "Advanced" in the generic scope editor.

**Independent Test**: open a Docker importer config form — three fields collapsed by default, expandable, values round-trip; a non-docker importer form is unchanged.

- [X] T017 Add `ADVANCED_SCOPE_KEYS: Record<string, string[]>` (`{ docker: ["environmentMap","componentIdLabel","sourceKey"] }`) and partition `renderedScopeFields` in `packages/frontend/src/ux/components/importers/importer-form.tsx`, rendering the advanced subset inside the existing `Collapsible` primitive (`packages/frontend/src/ux/components/ui/collapsible.tsx`) collapsed by default; render-only change — seeding, validation, and submit paths untouched

## Phase 7: US5 — Follow a five-minute quickstart (P3)

**Goal**: docker.md opens with a Hub + local-socket quickstart; deployment.md links it.

**Independent Test**: follow only the quickstart against a local socket to a completed import.

- [X] T018 Add a "Quickstart" section above the generated contract region in `docs/importers/docker.md`: Hub + local socket happy path (compose socket-mount prerequisite link → guided setup → run), pointers to `deployment.md` and `import-agents.md` for non-happy paths; generated region untouched
- [X] T019 Link the guided Docker setup from the "Docker importer on the Hub" section of `docs/deployment.md`

## Phase 8: Polish & cross-cutting

- [X] T020 Add `ADR-122` amendment recording `POST /docker-targets/probe` (stateless, `importer:target:test`, no persistence/audit, inline-secrets XOR credentialId) and update the ADR index/back-pointers in `researches/adrs/ADR-122-docker-hub-execution.md` and `researches/architecture-decisions.md`
- [X] T021 Update `docs/roadmap.md`: mark `063-docker-importer-onboarding` shipped and revise the Next entry
- [X] T022 Run changed-package verification: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in each touched package plus root `pnpm build`; fix all findings
- [X] T023 Security pass: confirm probe writes no rows/audit, error strings are `maskSecretValues`-sanitized, no secret values in frontend state beyond request bodies, no Docker socket mount added to deployment
- [X] T024 Run generated-docs checks (`docs:api:check`, `docs:importers:check`, `docs:oracle:check`, `docs:sidebar:check`) and the OpenAPI contract test; fix drift

## Dependencies

- Phase 1 tests block nothing structurally but define acceptance for all later phases.
- T004 (core schema) blocks T006/T007/T008 (probe route/service/spec).
- T005 (probe hook) blocks T011 (wizard verify step).
- US2 (Phase 3) blocks US1's verify-and-create step — the wizard cannot probe without the endpoint.
- US1 (Phase 4) blocks US3 (Phase 5) — the reuse picker lives in the wizard's secrets step.
- US4 (Phase 6) and US5 (Phase 7) are independent of each other and of US1/US3 once Phase 2 lands; US4 touches `importer-form.tsx` which T014 also touches — sequence T014 before T017.
- Phase 8 runs last.

## Parallel opportunities

- Phase 1: T001, T002, T003 are different files — run together.
- Phase 2: T004 (core) and T005 (frontend hook) are different packages — run together.
- Phase 4: T013 and T014 touch different files — run together after T012.
- Phase 7: T018 and T019 touch different docs — run together.

## Parallel example: Phase 1

```bash
# All three failing-test tasks target different files:
Task: "probe integration tests"   → packages/backend/test/integration/docker-targets.test.ts
Task: "logic unit tests"          → packages/frontend/src/test/unit/docker-setup-logic.test.ts
Task: "wizard + disclosure tests" → packages/frontend/src/test/unit/docker-setup-wizard.test.tsx
```

## Implementation strategy

**MVP**: Phases 1–4 deliver the probe endpoint plus the guided wizard with
enter-new-values secrets — a complete first-time setup path. US3 (reuse),
US4 (disclosure), and US5 (docs) are independent increments after that.
Each story lands with its tests already written (Phase 1) and is
verifiable via `quickstart.md` scenarios.

## Phase 9: Convergence

- [X] T025 Add an editable credential-name input on the wizard secrets step (new-values mode), defaulting to `Docker — <target label>` and used for the created STORED credential per FR-005 (partial)

## Phase 10: Review

- [X] T026 Emit `*Key` profile references in credential-reuse mode for every canonical key the selected credential covers (required always, optional only when covered) so reuse probes/persists valid profiles per FR-006/US3 (code-review: spec)
- [X] T027 Document `CREDENTIAL_REVOKED` (409) and `CREDENTIAL_KEY_UNAVAILABLE` (503) in `contracts/docker-target-probe-api.md` per FR-016 (code-review: spec)
- [X] T028 Disable the targetId input once a target row exists so a retried run cannot link the config to a different selector per FR-010 (code-review: spec)
- [X] T029 Align probe error statuses with the canonical error-types map — `CREDENTIAL_REVOKED`→409, `CREDENTIAL_KEY_UNAVAILABLE`→503 per ADR-071 (code-review: standards)
- [X] T030 Reuse `ProbeDockerTargetInput` from `@componode/core` in `api/hooks/docker-targets.ts` instead of re-declaring it (code-review: standards)
- [X] T031 Surface validation errors on collapsed Advanced scope fields via a "fix required" indicator on the disclosure trigger (code-review: standards)
- [X] T032 Accepted divergence: `DOCKER_SETUP_TRANSPORTS` intentionally differs from `TRANSPORT_FIELDS` — wizard fields carry plain-language guidance and omit `*Key` refs (canonical secrets instead); merging would couple two different UX contracts (code-review: standards)
- [X] T033 Accepted divergence: `runCreate` keeps four explicit step blocks rather than a `runStep` helper — steps differ in inputs, artifact writes, and resume semantics; a helper would obscure the ordering contract (code-review: standards)
- [X] T034 Accepted: unconditional `useCredentials()` in the wizard (one cached GET) and non-dismissible hint Alert — spec requires a "hint", not a dismissible one (code-review: standards)

## Phase 11: Review (round 2)

- [X] T035 Accept `schedule: null` in `createImporterConfigSchema`/`updateImporterConfigSchema` via `.nullish()` — wizard and generic form both send null for "Manual only", which previously 400'd at the final create step after target+credential existed (code-review: spec)
- [X] T036 Freeze profile-feeding inputs (transport, route fields, secret source, credential picker, secret values, credential name) once `artifacts.targetRowId` exists so a retry cannot desync the probe from the immutable persisted target profile; show a locked-settings note (code-review: spec)
- [X] T037 Name pending creation steps in the failure panel ("Still to do: …") per the spec edge case requiring completed + pending steps (code-review: spec)
- [X] T038 Document probe `409 CREDENTIAL_REVOKED` and `503 CREDENTIAL_KEY_UNAVAILABLE` responses in `docs/openapi.yaml` (code-review: spec)
- [X] T039 Replace `slugify`'s local regex copy with shared `deriveSlug` from `ux/lib/slug` (code-review: standards)
- [X] T040 Replace `*Key`-suffix/`SECRET_KEY_REF`-value detection with an explicit `secretRef` flag on `RouteFieldDef`; move `SECRET_LABELS` into the logic module (code-review: standards)
- [X] T041 Accepted divergence: `RouteFieldDef`/`validateStep`/`DOCKER_SETUP_SCHEDULES` intentionally differ from the admin target form and generic importer form — the wizard validates a reduced field set (no `*Key` literals) with guided presets incl. the `manual` sentinel; sharing would couple two UX contracts (code-review: standards)

## Phase 12: Review (round 3)

- [X] T042 Persist the created target's selector in `artifacts.targetSelector` and use it for `scope.targetId` + input display; guard the auto-suggest effect once a target exists — editing the importer label after partial creation previously rewrote `targetId` and made every retry fail `TARGET_NOT_FOUND` (code-review: spec)
- [X] T043 Declare `schedule` as `nullable: true` in the importer-config create/update OpenAPI request schemas now that `.nullish()` accepts null (code-review: spec)
- [X] T044 Drop the dead `secretRef` pseudo-fields, the `secretRef` flag, and `isSecretRefField` — every consumer excluded them; `DOCKER_SETUP_TRANSPORTS[].fields` now contains only literal route fields (code-review: standards)
- [X] T045 Accepted divergence: `SetupTransport`/`Transport` 4-member union stays declared locally in each frontend module — the contract lives in importer-docker (not importable per ADR-065) and core has no transport type; a shared ux type can follow when a third consumer appears (code-review: standards)
