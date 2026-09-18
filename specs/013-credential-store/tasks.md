---

description: "Task list for Credential Store implementation"
---

# Tasks: Credential Store

**Input**: Design documents from `/specs/013-credential-store/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/credentials-api.md, quickstart.md

**Tests**: INCLUDED — Constitution VI mandates test-first; quickstart.md enumerates the required suites.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7)

## Path Conventions

- Core contracts/schemas: `packages/core/src/`
- Backend: `packages/backend/src/`, tests in `packages/backend/test/{unit,integration}/`
- Frontend: `packages/frontend/src/`
- Importer manifests: `packages/importer-*/src/manifest.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract surface that every later task builds on — no DB or crypto yet.

- [x] T001 [P] Add `CREDENTIAL_STATUSES` constant (`ACTIVE`/`REVOKED`) in `packages/core/src/constants/` and `CREDENTIAL_*` error codes (`CREDENTIAL_NOT_FOUND`, `CREDENTIAL_IN_USE`, `CREDENTIAL_REVOKED`, `CREDENTIAL_MISSING_KEY`, `CREDENTIAL_KEY_COLLISION`, `CREDENTIAL_KEY_UNAVAILABLE`, `MANIFEST_NO_TEST`, `CONVERSION_NOTHING_TO_CONVERT`, `LEGACY_SECRET_UNRESOLVABLE`) in `packages/core/src/constants/error-codes.ts`
- [x] T002 [P] Create Zod schemas (`createCredentialSchema`, `updateCredentialSchema`, `testCredentialSchema`) in `packages/core/src/schemas/credential.ts` and API contract types in `packages/core/src/contracts/credential.ts`; export both from package index files
- [x] T003 [P] Extend importer manifest contract with `secrets: Array<{key, label, required}>` and optional `testSecrets?(secrets, config?)` in `packages/core/src/contracts/importer.ts`
- [x] T004 [P] Add `credential:create/read/update/delete` → `ADMIN` mappings in `packages/backend/src/plugins/rbac.ts` and add `encryptedPayload`, `secrets`, `secrets.*` to the Pino redaction paths (ADR-090)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration, crypto, and resolution plumbing every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Write FAILING unit tests for credential crypto in `packages/backend/test/unit/credential-crypto.test.ts`: encrypt/decrypt round-trip, tamper detection via GCM tag, wrong-key failure, `keyVersion` tagging, bootstrap order (`COMPONODE_SECRETS_KEY` env → `SECRETS_DIR/master.key` → auto-generate), dual-env rotation re-encrypt
- [x] T006 [P] Write FAILING unit tests for credential resolution in `packages/backend/test/unit/secret-resolver.test.ts`: credential merge into `secrets` record, legacy env/file still resolving + deprecation flag, `CREDENTIAL_KEY_COLLISION`, `CREDENTIAL_MISSING_KEY`, `CREDENTIAL_REVOKED`, `CREDENTIAL_NOT_FOUND`
- [x] T007 Write migration `packages/backend/src/db/migrations/011_credential_store.ts`: `credentials` table (per data-model.md), `importer_config_credentials` junction (FK CASCADE config / RESTRICT credential), `import_runs.credentialIds` jsonb, `oidc_config.clientSecretCredentialId` FK RESTRICT, CHECK constraint from `CREDENTIAL_STATUSES`
- [x] T008 Update `packages/backend/src/db/types.ts`: `CredentialRow`, `ImporterConfigCredentialRow`, `credentialIds` on `ImportRunRow`, `clientSecretCredentialId` on `OidcConfigRow`, `DB` table registrations
- [x] T009 Implement `packages/backend/src/utils/credential-crypto.ts`: AES-256-GCM encrypt/decrypt with `v1.<keyVersion>.<nonce>.<ct+tag>` envelope, key bootstrap (env → file → auto-generate mode 0600), `rotateIfNeeded()` dual-env re-encrypt
- [x] T010 Extend `packages/backend/src/utils/secret-resolver.ts`: resolve junction-linked credentials (decrypt → merge), keep legacy env/file resolution with deprecation warning, enforce collision/missing-key/revoked errors per data-model.md resolution algorithm
- [x] T011 Verify migration + crypto + resolver tests pass (`pnpm test --filter backend`)

**Checkpoint**: Foundation ready — credential rows can be encrypted, stored, and resolved

---

## Phase 3: User Story 1 - Store an Integration Credential Securely (Priority: P1) 🎯 MVP

**Goal**: Admin can create a credential by pasting secret values; it is encrypted at rest and never returned in plaintext.

**Independent Test**: `POST /api/v1/credentials` with a PAT → list shows masked hint only → DB row is ciphertext → no endpoint returns plaintext.

### Tests for User Story 1 ⚠️

- [x] T012 [P] [US1] Write FAILING integration tests in `packages/backend/test/integration/credential-store.test.ts` (subset): create → 201 + masked `keyHints`; list/get → metadata only, never `secrets`; DB row `encryptedPayload` is ciphertext; non-ADMIN → 403; audit `credential.created` with no values
- [x] T013 [P] [US1] Write FAILING unit tests in `packages/backend/test/unit/credential-service.test.ts`: slug derivation + collision suffix, `keyHints` last4 computation, payload size/key-format validation errors

### Implementation for User Story 1

- [x] T014 [US1] Implement `createCredential`, `listCredentials`, `getCredential` (with dependents shape) in `packages/backend/src/services/credential-service.ts` — encrypt via T009, `writeEntityChange` audit (metadata only)
- [x] T015 [US1] Implement `GET /credentials`, `POST /credentials`, `GET /credentials/:id` in `packages/backend/src/routes/credentials.ts` and register the route group in `packages/backend/src/app.ts`
- [x] T016 [US1] Add credential types + API client functions + TanStack Query hooks in `packages/frontend/src/api/types.ts`, `packages/frontend/src/api/client.ts`, `packages/frontend/src/api/hooks/`
- [x] T017 [US1] Build credentials list page + create form (label, expiry, dynamic key/value editor) in `packages/frontend/src/pages/credentials.tsx` and `packages/frontend/src/components/credential-form.tsx`; register route in `packages/frontend/src/routes.tsx` and add sidebar nav entry
- [x] T018 [US1] Add the three credential endpoints to `docs/openapi.yaml` with `x-permission` (ADR-104)

**Checkpoint**: US1 independently testable — a credential can be stored and listed, never read back

---

## Phase 4: User Story 2 - Use a Stored Credential in an Importer Configuration (Priority: P1)

**Goal**: Importer configs reference credentials; runs resolve them; the UI offers pick-or-create without env vars.

**Independent Test**: Credential + GitHub config → run authenticates with zero env vars; save-time validation rejects missing/colliding keys.

### Tests for User Story 2 ⚠️

- [x] T019 [P] [US2] Write FAILING integration tests in `packages/backend/test/integration/credential-run-resolution.test.ts`: config+credential → run resolves + stamps `import_runs.credentialIds` + `lastUsedAt`; revoked → fail-fast; junction RESTRICT blocks referenced delete (assert FK-level rejection only — the service-level `409 CREDENTIAL_IN_USE` is tested in T033/US4)
- [x] T020 [P] [US2] Write FAILING unit tests in `packages/backend/test/unit/importer-config-validation.test.ts`: coverage check against manifest `secrets` (`CREDENTIAL_MISSING_KEY`), cross-source collision (`CREDENTIAL_KEY_COLLISION`)
- [x] T021 [P] [US2] Add `secrets` declarations to all 7 manifests in `packages/importer-*/src/manifest.ts` per contracts/credentials-api.md — github: `[{key:"token", label:"Personal access token", required:true}]`; aws/azure/kubernetes/api-url/web-url/mcp-server: `secrets: []` (ambient credential chains; declare only keys the importer actually reads) — and extend manifest tests in `packages/backend/test/unit/importer-registry.test.ts`
- [x] T022 [US2] Add `credentialIds: string[]` to create/update importer-config schemas in `packages/core/src/schemas/importer-config.ts` and contract types in `packages/core/src/contracts/importer-config.ts`
- [x] T023 [US2] Update `packages/backend/src/services/importer-config-service.ts`: junction insert/delete on create/update, save-time coverage + collision validation (decrypt refs), `secretRefsDeprecated` flag in responses
- [x] T024 [US2] Update `packages/backend/src/services/import-run-service.ts`: resolve credentials via T010 at run start, stamp `credentialIds` on the run row and expose it in run-detail responses, update `credentials.lastUsedAt`, emit expiry warnings
- [x] T025 [US2] Update `packages/backend/src/routes/importers.ts`: accept `credentialIds`, surface new error codes, return deprecation flag
- [x] T026 [US2] Update `packages/frontend/src/components/importer-config-form.tsx`: credential picker (list from API), "store new credential" inline flow, DEPRECATED badge on legacy refs
- [x] T027 [US2] Update `docs/openapi.yaml` for importer-config `credentialIds` + deprecation flag

**Checkpoint**: US1+US2 — the paste-a-PAT → running import flow works end-to-end

---

## Phase 5: User Story 3 - Verify a Credential Before Relying on It (Priority: P2)

**Goal**: `POST /credentials/:id/test` dry-runs the target importer's auth check; UI test button shows the result.

**Independent Test**: Store a deliberately invalid token → test → `{ok:false}`; valid → `{ok:true}`.

### Tests for User Story 3 ⚠️

- [X] T028 [P] [US3] Write FAILING tests: unit test for `testSecrets` dispatch + `MANIFEST_NO_TEST` in `packages/backend/test/unit/credential-service.test.ts`; integration test for the endpoint in `packages/backend/test/integration/credential-store.test.ts` (register a stub manifest with `testSecrets`, no network); github `testSecrets` happy/failure in `packages/importer-github/test/` with `vi.mock("octokit")` — never live network

### Implementation for User Story 3

- [X] T029 [P] [US3] Implement `testSecrets` in `packages/importer-github/src/` only (Octokit auth probe: `GET /rate_limit` or `GET /user`); the other 6 importers intentionally omit it → `MANIFEST_NO_TEST` per contracts/credentials-api.md
- [X] T030 [US3] Implement test dispatch in `packages/backend/src/services/credential-service.ts` + `POST /credentials/:id/test` in `packages/backend/src/routes/credentials.ts` (result in 200 body; upstream auth failure is not a 4xx)
- [X] T031 [US3] Add test button + result display to `packages/frontend/src/pages/credentials.tsx` / `credential-form.tsx` (importer selector from manifests)
- [X] T032 [US3] Add `POST /credentials/:id/test` to `docs/openapi.yaml`

**Checkpoint**: Credentials are verifiable without exposing values

---

## Phase 6: User Story 4 - Manage the Credential Lifecycle (Priority: P2)

**Goal**: Rotate in place, revoke, advisory expiry warnings, last-used tracking, dependent-aware delete.

**Independent Test**: Rotate → same id, runs use new value; revoke → run fails fast; delete referenced → 409 + dependents; expiry → warnings only.

### Tests for User Story 4 ⚠️

- [X] T033 [P] [US4] Write FAILING integration tests in `packages/backend/test/integration/credential-store.test.ts`: PATCH rotate preserves id + junction links; REVOKED resolution fails; DELETE → 409 with dependent configs + OIDC flag; expired credential produces run warning but runs

### Implementation for User Story 4

- [X] T034 [US4] Implement `updateCredential` (label/expiresAt), `rotateCredential` (payload replace, hints recompute, `rotated` audit), `revokeCredential`, `deleteCredential` (dependent listing → `CREDENTIAL_IN_USE`) in `packages/backend/src/services/credential-service.ts`
- [X] T035 [US4] Implement `PATCH /credentials/:id` + `DELETE /credentials/:id` in `packages/backend/src/routes/credentials.ts`
- [X] T036 [US4] Add expiry-warning emission to run resolution in `packages/backend/src/services/import-run-service.ts` and expiry flagging to list responses in `packages/backend/src/services/credential-service.ts`
- [X] T037 [US4] Build lifecycle UI in `packages/frontend/src/pages/credentials.tsx`: rotate form, revoke confirm, delete with dependent list on 409, expiry/last-used badges; surface run→credential linkage on `packages/frontend/src/pages/importer-run.tsx` (credentials used by the run)
- [X] T038 [US4] Add `PATCH`/`DELETE /credentials/:id` to `docs/openapi.yaml`

**Checkpoint**: Full lifecycle operable through UI + API

---

## Phase 7: User Story 5 - Migrate Existing Configurations Without Breaking Them (Priority: P2)

**Goal**: Legacy env/file refs keep working (flagged deprecated); one-click convert to stored credential.

**Independent Test**: env-based config → runs → DEPRECATED badge → convert → credential created, config re-pointed, env var unset still works.

### Tests for User Story 5 ⚠️

- [X] T039 [P] [US5] Write FAILING integration tests in `packages/backend/test/integration/credential-store.test.ts`: legacy config resolves + deprecation flag present; convert-secrets → credential created + refs rewritten + `secretRefs` cleared; `CONVERSION_NOTHING_TO_CONVERT`; `LEGACY_SECRET_UNRESOLVABLE` when env var absent

### Implementation for User Story 5

- [X] T040 [US5] Implement `convertSecrets` (resolve legacy → create bundle credential → rewrite config + audit both) in `packages/backend/src/services/credential-service.ts` and `POST /importer-configs/:id/convert-secrets` in `packages/backend/src/routes/importers.ts`
- [X] T041 [US5] Add DEPRECATED badge + convert action to `packages/frontend/src/components/importer-config-form.tsx` and the configs list in `packages/frontend/src/pages/importers.tsx`
- [X] T042 [US5] Add convert endpoint to `docs/openapi.yaml`

**Checkpoint**: v1 deployments upgrade safely with an assisted path to stored credentials

---

## Phase 8: User Story 6 - Operate the Encryption Key Safely (Priority: P2)

**Goal**: Zero-config key bootstrap, loud boot failure on missing key with existing credentials, dual-env rotation, documented backup unit.

**Independent Test**: Fresh boot auto-generates `master.key`; boot with credentials + no key fails; rotation keeps credentials readable.

### Tests for User Story 6 ⚠️

- [X] T043 [P] [US6] Write FAILING tests in `packages/backend/test/integration/credential-boot.test.ts`: auto-generate on first boot; boot fails when credentials exist without key; degraded mode when empty + no key + unwritable dir; dual-env rotation re-encrypts and bumps `keyVersion`

### Implementation for User Story 6

- [X] T044 [US6] Wire boot sequence in `packages/backend/src/server.ts`: load/rotate key via credential-crypto, fail when `credentials` non-empty without key; when keyless and empty, run with credential features degraded — surface via boot log warning + a `credentialsAvailable: false` flag on `/api/v1/health`
- [X] T045 [US6] Document master key, backup unit (DB + `master.key`), rotation runbook, and `COMPONODE_SECRETS_KEY[_PREVIOUS]` in `docs/deployment.md`

**Checkpoint**: Operators can run, back up, and rotate the store safely

---

## Phase 9: User Story 7 - Store the OIDC Client Secret in the Same Store (Priority: P3)

**Goal**: `oidc_config.clientSecretCredentialId` resolves the client secret through the store; legacy `clientSecretRef` deprecated but working.

**Independent Test**: OIDC configured with a credential → login flow works; legacy env ref still works + flagged.

### Tests for User Story 7 ⚠️

- [X] T046 [P] [US7] Write FAILING tests in `packages/backend/test/integration/oidc-credentials.test.ts`: credential resolution preferred over `clientSecretRef`; legacy fallback + deprecation; revoke/delete protection (`CREDENTIAL_IN_USE` lists OIDC)

### Implementation for User Story 7

- [X] T047 [US7] Add `clientSecretCredentialId` to OIDC settings schema in `packages/core/src/schemas/settings.ts` and persistence in `packages/backend/src/services/settings-service.ts` (masked audit)
- [X] T048 [US7] Update `packages/backend/src/services/oidc-service.ts`: resolve client secret via credential store when `clientSecretCredentialId` set, legacy env fallback + deprecation warning otherwise
- [X] T049 [US7] Add credential picker to OIDC settings UI in `packages/frontend/src/pages/` (settings/oidc form)
- [X] T050 [US7] Update `docs/openapi.yaml` for the OIDC settings field

**Checkpoint**: All in-app integration secrets flow through one store

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Architecture record, docs sync, and release hygiene.

- [X] T051 Write `researches/adrs/ADR-107-credential-store.md` (supersedes ADR-023's no-secrets-at-rest clause; amends ADR-055 ref shape, ADR-073 OIDC ref, ADR-099 in-memory clause) and add it to `researches/architecture-decisions.md`
- [X] T052 [P] Update `docs/importer-development.md`: `secrets` manifest declaration, `testSecrets` hook, credential store contract
- [X] T053 [P] Update `AGENTS.md` boundaries (credential store replaces ADR-023 external-only rule for in-app secrets) and `README.md` roadmap (`013-credential-store` complete, revise Next)
- [X] T054 Regenerate `docs/api.md` (`docs:api`) and confirm the api-docs contract test passes with all new endpoints in `packages/backend/test/unit/api-docs-contract.test.ts`
- [X] T055 Add a changeset (`.changeset/`) describing the feature + deprecation notice for env/file secret refs
- [X] T056 Run full validation: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` plus quickstart.md manual scenarios

## Phase 11: Convergence

- [X] T057 Make credential key hints non-reversible for short secret values in `computeKeyHints` (`packages/backend/src/services/credential-service.ts`) — a value of ≤4 characters currently leaks fully as its own hint; mask fully (e.g. `****`) or enforce a minimum secret length in `packages/core/src/schemas/credential.ts` per FR-004 (contradicts)
- [X] T058 Add a credential detail view/dialog in `packages/frontend/src/pages/credentials.tsx` (or a new component) listing dependent importer configs and OIDC usage plus `lastUsedAt`, so dependents are visible without triggering a rejected delete per SC-005 (partial)
- [X] T059 Include the credential label(s) in the run-time missing-required-key error in `assertRequiredSecrets` / `resolveImportSecrets` (`packages/backend/src/utils/secret-resolver.ts`) — the run must fail fast naming the credential label and the missing key per spec edge case 2 (partial)
- [X] T060 Add `*.secrets` and `*.secrets.*` wildcard paths to the Pino redact list in `packages/backend/src/plugins/logging.ts` for symmetry with `*.secretRefs` per FR-006 (partial)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001–T004 all parallel
- **Foundational (Phase 2)**: Depends on Setup; BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — MVP
- **US2 (Phase 4)**: Depends on US1 (credentials must exist to reference)
- **US3–US6 (Phases 5–8)**: Depend on US1+US2 (US6 technically only needs Foundational + crypto — can start earlier)
- **US7 (Phase 9)**: Depends on US1 (store exists); independent of US2–US6
- **Polish (Phase 10)**: After all desired stories complete

### Within Each Story

- Failing tests before implementation (Constitution VI)
- Schemas/services before routes; routes before frontend; openapi.yaml last in the story

### Parallel Opportunities

- T001–T004 (Setup): all parallel
- T005+T006 (Foundational tests): parallel; T007+T008 parallel after them
- T012+T013, T019+T020+T021, T028+T029 (partial), T033, T039, T043, T046: test tasks parallel within story
- T052+T053 (Polish docs): parallel
- US7 can run fully parallel to US3–US6 given US1 done

### Parallel Example: User Story 2

```bash
# Launch together:
Task: "Write FAILING integration tests in credential-run-resolution.test.ts"
Task: "Write FAILING unit tests in importer-config-validation.test.ts"
Task: "Add secrets declarations to all 7 manifests"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 + 2 → crypto/storage/resolution ready
2. Phase 3 (US1) → credential CRUD-min + UI
3. Phase 4 (US2) → importer consumption
4. **STOP and VALIDATE**: the reported pain (can't save a PAT) is fixed

### Incremental Delivery

1. MVP (US1+US2) → demo: paste PAT → running import
2. US4 (lifecycle) → rotation/revocation usable immediately
3. US3 (test), US5 (migration), US6 (key ops) → hardening + ops
4. US7 (OIDC) → completes the scope boundary
5. Polish → ADR-107 + docs + changeset

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [USx] label maps to spec.md user stories
- Verify each test task FAILS before implementing
- `docs/openapi.yaml` updates are per-story (ADR-104) — never batch to the end
- Commit after each task or logical group; PowerShell env → use `git commit -F <file>` for messages
