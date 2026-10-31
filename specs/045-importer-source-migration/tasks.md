# Tasks: Importer Source Migration

**Input**: Design documents from `/specs/045-importer-source-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — constitution VI makes test-first non-negotiable;
`validateDiscoveredAsset` must be exercised per importer.

**Organization**: US1 = identity reporting (all 8 importers); US2 =
externalId qualification + adopt-on-report; US3 = membership `details`;
US4 = defensible backfill; US5 = per-importer documentation.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: baseline verification only — existing monorepo, nothing to scaffold

- [x] T001 Verify green baseline: `pnpm install`, then `pnpm --filter @componode/core test` and `pnpm --filter @componode/backend test` on the feature branch

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: core contract + executor machinery all stories build on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Extend `DiscoveredAsset` and `DiscoveredAssetInstance` with optional `sourceDetails?: Record<string, unknown> | null` in `packages/core/src/contracts/discovered-asset.ts`; update `validateDiscoveredAsset` schema to accept plain-object `sourceDetails` (reject non-objects) and export the contract docs in `packages/core/src/index.ts` if needed
- [x] T003 [P] Add `qualifyExternalId(identity, nativeId)` → `"{identity}::{nativeId}"`, `legacyExternalId(qualified)` (strips first `{identity}::` prefix, returns null when unqualified), and `isQualifiedExternalId(id)` helpers with failing-first unit tests in `packages/core/src/utils/source-identity.ts` and `packages/core/src/utils/source-identity.test.ts`; export from `packages/core/src/index.ts`
- [x] T004 Adopt-on-report matching in `packages/backend/src/services/import-run-service.ts` `processAsset`: after the qualified `(category, provider, externalId)` lookup misses and `sourceId != null` and `isQualifiedExternalId(asset.externalId)`, fall back to `legacyExternalId(...)` matching only components with **no membership from this Source**; on match update `externalId` to the qualified form, then normal upsert + membership stamp. Write failing integration test in `packages/backend/test/integration/source-adoption.test.ts` first (legacy row adopted, no duplicate; second source inserts its own qualified row)
- [x] T005 Update fake `getImporter` mocks to call `context.reportSourceIdentity({externalIdentity: "test-source"})` before yielding in `packages/backend/test/integration/` suites that run under real manifest names: `importers.test.ts`, `import-runs.test.ts`, `import-reconciliation.test.ts`, `alibaba-import.test.ts`, `edge-suggestion-generation.test.ts`, `config-drift.test.ts`, `metadata-importer-safety.test.ts`, plus remote-run/agent test fixtures using `importerName: "github"`/`"alibaba-cloud"`

**Checkpoint**: Foundation ready — contract fields, qualification helpers, adopt-on-report matching, and test-fake reporting all in place

---

## Phase 3: User Story 1 - Every in-tree importer reports its source identity (Priority: P1) 🎯 MVP

**Goal**: all 8 manifests declare `reportsSourceIdentity`; each importer
reports its provider-native (or `sourceKey`) identity before first yield,
including empty inventories.

**Independent Test**: run each importer → `ImporterSource` registered/matched
per `contracts/source-identity-keys.md`; empty inventory still registers;
missing identity fails the run before yield.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [P] [US1] Tests in `packages/importer-alibaba-cloud/test/importer.test.ts`: `reportSourceIdentity` called with `{externalIdentity: accountId}` before first asset; empty inventory still reports
- [x] T007 [P] [US1] Tests in `packages/importer-api-url/test/importer.test.ts` and `packages/importer-web-url/test/importer.test.ts`: reports canonical `config.url`; userinfo/auth-params stripped from reported identity
- [x] T008 [P] [US1] Tests in `packages/importer-github/test/importer.test.ts`: reports `{canonicalBaseUrl}#org:{orgId}`; `orgs.get` invoked before any yield incl. when `includeOrganization` is false; GHES `baseUrl` reflected in identity
- [x] T009 [P] [US1] Tests in `packages/importer-aws/test/importer.test.ts` and `packages/importer-kubernetes/test/importer.test.ts`: reports `sourceKey` (aws) / canonical `endpoint` or `sourceKey` (k8s); run throws/fails when required identity absent — no yield
- [x] T010 [P] [US1] Tests in `packages/importer-azure/test/importer.test.ts` and `packages/importer-mcp-server/test/importer.test.ts`: `subscriptionId`/`endpoint` preferred, `sourceKey` fallback, failure when neither
- [x] T011 [P] [US1] Agent passthrough test in `packages/agent/test/executor.test.ts`: importer `reportSourceIdentity` on agent produces the `source.identity` frame hub-side (verify existing protocol v3 path — no new protocol)

### Implementation for User Story 1

- [x] T012 [US1] `importer-alibaba-cloud`: `manifest.ts` `reportsSourceIdentity: true`; report `identity.accountId` from the existing pre-yield `getCallerIdentity` in `src/importer.ts`
- [x] T013 [P] [US1] `importer-api-url` + `importer-web-url`: flag manifests; report `canonicalizeSourceIdentity(config.url)` before yield in each `src/importer.ts`
- [x] T014 [US1] `importer-github`: flag manifest; move/call `octokit.rest.orgs.get({org})` at run start (before any fetch that yields); report `{canonicalBaseUrl}#org:{orgId}` with `label` = org login
- [x] T015 [US1] `importer-aws`: add optional trimmed `sourceKey` to `src/config.ts` scope; flag manifest; report `sourceKey` or fail before yield when absent
- [x] T016 [US1] `importer-kubernetes`: add optional `sourceKey` to `src/config.ts`; flag manifest; report canonical `endpoint` else `sourceKey` else fail
- [x] T017 [US1] `importer-azure`: add optional `sourceKey` to `src/config.ts`; flag manifest; report `subscriptionId` else `sourceKey` else fail
- [x] T018 [US1] `importer-mcp-server`: add optional `sourceKey` to `src/config.ts`; flag manifest; report canonical `endpoint` else `sourceKey` else fail
- [x] T019 [US1] Backend integration: add assertions that a run through a real flagged manifest attributes `run.sourceId` and registers the Source (extend `source-adoption.test.ts` or a new `importer-source-adoption.test.ts` in `packages/backend/test/integration/`)

**Checkpoint**: 8/8 importers report identity; runs attribute; T005 fakes keep every suite green

---

## Phase 4: User Story 2 - Source-qualified external IDs prevent false sharing (Priority: P1)

**Goal**: emitted `externalId`s gain `{identity}::{nativeId}` where the
native ID is not globally unique; pre-migration rows are adopted on
report — no duplicates, no batch rekey.

**Independent Test**: two `sourceKey`-distinct aws configs report
same-named assets → two Components; pre-seeded legacy row is adopted on
first migrated run; stored externalIds of unreported rows unchanged.

### Tests for User Story 2 ⚠️

- [x] T020 [P] [US2] Unit tests asserting qualified `externalId` formats in `packages/importer-aws`, `importer-kubernetes`, `importer-mcp-server` test files (`{identity}::{nativeId}`, incl. endpoint-less mcp `sourceKey` case)
- [x] T021 [P] [US2] Unit tests in `packages/importer-github/test/importer.test.ts`: GHES configs emit `externalId` qualified by canonical host; github.com configs emit unqualified (existing assertions keep passing)
- [x] T022 [P] [US2] Unit tests in `packages/importer-alibaba-cloud/test/importer.test.ts`: ARN assets unqualified; non-ARN fallback `{type}:{id}` becomes `{accountId}::{type}:{id}`
- [x] T023 [US2] Integration tests in `packages/backend/test/integration/source-adoption.test.ts`: same native ID from two distinct Sources → two Components; legacy-row adoption (qualified rewrite + membership + zero duplicates); unreported legacy rows untouched; previously merged legacy row disambiguates across two Sources' runs

### Implementation for User Story 2

- [x] T024 [P] [US2] Qualify emitted `externalId`s in `packages/importer-aws/src/importer.ts` (`{sourceKey}::{region}:{rtype}`) and `packages/importer-kubernetes/src/importer.ts` (`{identity}::{ns}:{rtype}`) using core `qualifyExternalId`
- [x] T025 [P] [US2] Qualify in `packages/importer-mcp-server/src/importer.ts`: `{identity}::{rtype}` for both endpoint and `sourceKey` identities (drop bare `mcp:{rtype}` form)
- [x] T026 [US2] Qualify GHES-only externalIds in `packages/importer-github/src/`: org/repo/workflow/runner/package IDs gain canonical-baseUrl prefix only when `baseUrl` differs from `https://api.github.com`
- [x] T027 [US2] Qualify Alibaba non-ARN fallback in `packages/importer-alibaba-cloud/src/mapping.ts`: `externalIdFor` returns `{accountId}::{type}:{id}` when no `arn` (thread accountId through from caller)
- [x] T028 [US2] Verify azure emits `{subscriptionId-or-sourceKey}:{rtype}` (already qualified shape — adjust `scope` fallback from `"default"` to the resolved identity so the `default:` collision form disappears) in `packages/importer-azure/src/importer.ts`

**Checkpoint**: distinct systems can never merge; legacy continuity proven by adoption tests

---

## Phase 5: User Story 3 - Per-source details stop last-writer-wins (Priority: P2)

**Goal**: `sourceDetails` persists on memberships; canonical `details`
unchanged on the shared row.

**Independent Test**: two Sources report one Component with differing
`sourceDetails` → each membership retains its own facts;
`components.details` holds only canonical fields.

### Tests for User Story 3 ⚠️

- [x] T029 [P] [US3] Unit tests in `packages/core/src/` validating `sourceDetails` shape through `validateDiscoveredAsset` (accept object/null/absent; reject non-object)
- [x] T030 [US3] Integration tests in `packages/backend/test/integration/source-adoption.test.ts`: `asset.sourceDetails` → `source_component_memberships.details`; `instance.sourceDetails` → `source_instance_memberships.details`; two Sources keep distinct membership details; legacy run ignores `sourceDetails`

### Implementation for User Story 3

- [x] T031 [US3] Wire `asset.sourceDetails` / `instance.sourceDetails` into `upsertComponentMembership` / `upsertInstanceMembership` in `packages/backend/src/services/import-run-service.ts` (upsert sets `details` on both insert and conflict-update)
- [x] T032 [US3] Emit `sourceDetails` from one real importer as the reference implementation — `packages/importer-alibaba-cloud/src/` (e.g. `arn`, `identityType`, `resourceGroupId` on the account/resource assets)

**Checkpoint**: membership `details` populated end-to-end; Wave A follow-up closed

---

## Phase 6: User Story 4 - Existing catalog data migrates defensibly or stays legacy (Priority: P2)

**Goal**: migration 023 backfills Sources + memberships only where scope
provenance is derivable; everything else stays `LEGACY_UNATTRIBUTED`.

**Independent Test**: seed derivable (api-url) + underivable (aws no
`sourceKey`) + deleted-config data → only derivable config's last-seen
components gain memberships; run history `sourceId` untouched; no-op on
empty DB.

### Tests for User Story 4 ⚠️

- [x] T033 [US4] Migration tests in `packages/backend/test/` (new `migration-023.test.ts` or integration suite): derivable config → Source + memberships; underivable/deleted-config/`lastSeenInRunId NULL` → untouched `LEGACY_UNATTRIBUTED`; `import_runs.sourceId` unchanged for history; idempotent re-run; preservation of edges/curated fields/externalIds

### Implementation for User Story 4

- [x] T034 [US4] Create `packages/backend/src/db/migrations/023_source_backfill.ts` implementing `contracts/migration-rules.md`: scope-only identity derivation (azure `subscriptionId`, k8s `endpoint`, api-url/web-url `url`, mcp-server `endpoint`), `getOrCreate` Source bound to the config, component/instance membership backfill from `lastSeenInRunId → import_runs.configId`, all `ON CONFLICT DO NOTHING`
- [x] T035 [US4] Update `packages/backend/src/db/types.ts` if the migration introduces new typed reads (membership tables already typed by 022 — verify only)

**Checkpoint**: existing data lands defensibly; unreported legacy rows still retire correctly under source-scoped reconciliation

---

## Phase 7: User Story 5 - Each importer's migration is documented (Priority: P3)

**Goal**: per-importer identity key, scope boundary, and legacy-cleanup
disposition documented where operators look.

**Independent Test**: all 8 guides contain a Source identity section
matching `contracts/source-identity-keys.md`.

- [x] T036 [P] [US5] Add "Source identity" sections (identity key, `sourceKey` requirement/fallback, migration notes) to `docs/importers/github.md`, `docs/importers/aws.md`, `docs/importers/azure.md`, `docs/importers/alibaba-cloud.md`
- [x] T037 [P] [US5] Same for `docs/importers/kubernetes.md`, `docs/importers/api-url.md`, `docs/importers/web-url.md`, `docs/importers/mcp-server.md`
- [x] T038 [US5] Add a "Migrating to ImporterSource" section to `docs/importer-development.md` covering `reportSourceIdentity`, `sourceKey`, qualification, and `sourceDetails` for future importer authors

**Checkpoint**: documentation matches implemented behavior for all 8 importers

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: ADR fidelity, roadmap/tracking sync, full verification

- [x] T039 Create `researches/adrs/ADR-120-importer-source-migration.md` ratifying: per-importer identity-key table, `sourceKey` scope field, `{identity}::{nativeId}` format, adopt-on-report semantics, `sourceDetails` fields, backfill defensibility rules; add `**Amended by ADR-120**` back-pointers to `ADR-056` (asset contract gains `sourceDetails`) and `ADR-119` (per-importer keys concretized); update each ADR's amends list in `researches/architecture-decisions.md`
- [x] T040 Update `researches/docker-importer-implementation-tracking.md`: check Phase 2 checkboxes, remove/resolve the Wave A `details` follow-up note
- [x] T041 Update `docs/roadmap.md`: move `045-importer-source-migration` to Shipped, revise Next (Wave C Docker Engine inventory)
- [ ] T042 Confirm no REST/agent-protocol surface changed: `pnpm --filter @componode/backend test` contract tests green (openapi.yaml untouched); run `pnpm build` root-wide
- [ ] T043 Final verification per plan: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` across changed packages (`core`, `backend`, `agent`, all `importer-*`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: after Setup — BLOCKS all stories
- **US1 (Phase 3)**: after Foundational (uses contract helpers only)
- **US2 (Phase 4)**: after Foundational + the manifest flag of the importer being qualified (report identity must exist for `reportedSourceId`)
- **US3 (Phase 5)**: after T002 (contract field) — otherwise independent
- **US4 (Phase 6)**: independent of US1–US3 content-wise, but ship after US1 flags exist so backfilled Sources match adopting runs' identities
- **US5 (Phase 7)**: after US1–US4 (docs describe final behavior)
- **Polish (Phase 8)**: last

### User Story Dependencies

- **US1**: foundational only — no other story deps
- **US2**: needs adopt-on-report (T004) + per-importer flag (its US1 impl task)
- **US3**: needs T002 + US1's adopting runs (details only persist under sourceId)
- **US4**: needs US1 identity-key table fixed (derivation mirrors reported identities)
- **US5**: needs settled behavior from all stories

### Parallel Opportunities

- T002/T003 in parallel; T013 (two small importers) pairs with T012/T014
- US1 importer tasks T015–T018 parallel across packages (different files)
- US2 per-importer tasks T024–T028 parallel
- US5 doc tasks T036/T037 parallel
- All test tasks marked [P] can be written concurrently

---

## Parallel Example: User Story 1

```bash
# Write failing tests for four importer groups at once:
Task: "T006 alibaba identity tests"
Task: "T007 api-url/web-url identity tests"
Task: "T008 github identity tests"
Task: "T009 aws/kubernetes identity tests"

# Then implement in parallel (different packages):
Task: "T012 alibaba adoption"
Task: "T013 api-url + web-url adoption"
Task: "T015 aws adoption"
Task: "T016 kubernetes adoption"
```

---

## Implementation Strategy

### MVP First

Phase 1 + 2 + US1 (identity reporting across all 8) is the deployable
spine: every run attributes to a durable Source and empty inventories
register — the provenance foundation is live even before qualification.

### Incremental Delivery

US2 then adds collision safety + continuity (the risky delta, gated by
adopt-on-report); US3 closes the Wave A `details` debt; US4 lands
backfill; US5 + polish ratify and document.

## Phase 9: Convergence

- [x] T044 Add integration test in `packages/backend/test/integration/source-adoption.test.ts`: an adopting run that reports identity but yields zero assets still registers the `importer_sources` row and stamps `import_runs.sourceId` (spec edge case / US1, missing)
- [x] T045 Add test in `packages/backend/test/integration/remote-run*.test.ts` (or remote-run-service unit suite): a `source.identity` frame arriving on a non-adopting job is ignored — `run.sourceId` stays NULL and reconciliation stays config-scoped (FR-013, partial)
