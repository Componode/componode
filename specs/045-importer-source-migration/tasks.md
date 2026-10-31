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
- [x] T042 Confirm no REST/agent-protocol surface changed: `pnpm --filter @componode/backend test` contract tests green (openapi.yaml untouched); run `pnpm build` root-wide
- [x] T043 Final verification per plan: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` across changed packages (`core`, `backend`, `agent`, all `importer-*`)

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

## Phase 10: Review

- [x] T046 Emit component-local instance externalIds in `packages/importer-{aws,kubernetes,mcp-server}/src/importer.ts` — instance id must be `${localExternalId}:0`, not derived from the qualified component id, so legacy instances adopt instead of duplicating (code-review: spec, also code-review: standards)
- [x] T047 Canonicalize emitted `externalId` (component + instance) and drop the raw `label: parsed.url` in `packages/importer-{api-url,web-url}/src/importer.ts` so spellings converge and no userinfo/auth params persist in `components.externalId` or `importer_sources.label` (code-review: spec, also code-review: standards)
- [x] T048 Narrow the github `orgs.get` fallback in `packages/importer-github/src/importer.ts`: fall back to `#login:{org}` only on permission-style failures (403/404); rethrow network/5xx errors rather than inventing a renamable identity (code-review: spec)
- [x] T049 Fix `packages/backend/src/db/migrations/023_source_backfill.ts` `down()`: skip Sources referenced by any `import_runs.sourceId` (FK RESTRICT + live-run safety) — delete only memberships + Sources the migration itself created that remain unreferenced (code-review: standards)
- [x] T050 Expose Source membership `details` via the read API (extend `GET /importer-sources/{id}` or a memberships sub-endpoint), regenerate `docs/openapi.yaml` in the same change (ADR-104), and add an integration assertion that a source's reported details are readable (code-review: spec)
- [x] T051 Enforce required identity at config-schema level, not mid-run: `importer-aws` `sourceKey` required; `importer-kubernetes`/`importer-mcp-server` require `endpoint | sourceKey`; `importer-azure` require `subscriptionId | sourceKey` — via zod required/refine so invalid configs fail validation (code-review: spec)
- [x] T052 Ratify + align adoption semantics: azure's `{identity}:{rtype}` already embeds the identity and is retained (ADR-120 amendment noting the `::` exemption to avoid mass rekey), and the adopt-on-report guard in `import-run-service.ts` uses the effective-active union (active membership whose Source is ACTIVE|UNMONITORED), not raw `active`; update `contracts/asset-contract-changes.md` + ADR-120 to match implemented semantics (code-review: spec, also code-review: standards)
- [x] T053 Write an `entity_changes` audit row for the adopt-on-report `externalId` rewrite in `packages/backend/src/services/import-run-service.ts`, consistent with other mutations in `processAsset` (code-review: standards)
- [x] T054 Add `sourceKey` to the config-field tables in `docs/importers/{aws,azure,kubernetes,mcp-server}.md` (AGENTS.md requires every config field documented) (code-review: standards)
- [x] T055 Extend the auth-param blocklist in `packages/core/src/utils/source-identity.ts` `canonicalizeSourceIdentity` to cover common secret query params (`token`, `key`, `signature`, `sig`, `secret`, `password`, `access_key`, `private_key`, `x-amz-signature`, `x-amz-credential`, `auth`, `code`) (code-review: standards)
- [x] T056 Move `packages/core/src/utils/source-identity.test.ts` to `packages/core/test/` per repo test-layout convention (code-review: standards)
- [x] T057 Collapse the `processAsset` `sourceId`+`sourceIdentity` params into a `RunSource` object (Data Clump) and extract the `"https://api.github.com/"` literal in `importer-github/src/importer.ts` to a named constant (code-review: standards)

## Phase 11: Review

- [x] T058 Fix github source identity surviving canonicalization: `canonicalizeSourceIdentity` strips `#` fragments, collapsing every `{base}#org:{id}` to `{base}` — switch to path form `{base}org/{id}` / `{base}login/{org}` in `importer-github/src/importer.ts`, update tests + `docs/importers/github.md` + identity-key table, and ratify via ADR-120 Amendment 2 (code-review: spec, CRITICAL — destroys per-org Sources)
- [x] T059 Extend adopt-on-report in `import-run-service.ts`: when the `::`-prefix unqualify misses and the emitted `externalId` is a canonical URL, also match legacy components by `canonicalizeSourceIdentity(externalId)` equality so raw-URL legacy rows adopt instead of duplicating (code-review: spec)
- [x] T060 Use the canonical endpoint (not raw) in the mcp-server `localId` so userinfo never lands in durable externalIds (`packages/importer-mcp-server/src/importer.ts`) (code-review: spec)
- [x] T061 Stamp per-entity provenance in migration 023: membership `firstSeenInRunId`/`lastSeenInRunId` come from each component/instance's own `lastSeenInRunId`, not the config's newest run (code-review: standards)
- [x] T062 Zod-validate the `:id` route param on `GET /importer-sources/:id/memberships` (ADR-095 boundary validation) (code-review: standards)
- [x] T063 Regenerate `docs/api.md` via `pnpm docs:api` for the new memberships route (ADR-104 sync) (code-review: standards)
- [x] T064 Fix `docs/importers/mcp-server.md` externalId format to `{identity}::{endpoint}:{method}` (code-review: standards)

## Phase 12: Review

- [x] T065 Use `legacy.externalId` (not `legacyId` — null on the canonical-URL fallback path) for `previousExternalId` in the adopt-on-report `entity_changes` row in `import-run-service.ts` (code-review: standards + spec)
- [x] T066 Gate the canonical-URL adoption fallback to `legacyId === null` (bare-URL emits) so qualified GHES ids don't trigger a full `(category, provider)` scan per miss; extend the match with canonical-prefix derivation `{canon(storedPrefix)}:{rest}` so mcp's raw-endpoint stored ids (`{rawEp}:{rtype}`) adopt against the canonical localId (code-review: standards + spec)
- [x] T067 Fix stale `{canonicalBaseUrl}#org:{orgId}` comment in `importer-github/src/importer.ts` — identity is path form per ADR-120 Amendment 2 (code-review: standards)
- [x] T068 Ratify in ADR-120 Amendment 2 that azure `default:` externalId rows are intentionally not adopted — their true source identity is unknowable, so they stay `LEGACY_UNATTRIBUTED` per the no-guess invariant (code-review: spec)
- [x] T069 When a config's reported identity changes, unmonitor the previously bound Source in `importer-source-service.ts` `registerOrMatchSource` — only the just-matched Source may keep `boundConfigId` (ADR-119 #3, spec edge case: config re-pointed at a different system) (code-review: spec)

## Phase 13: Review

- [x] T070 Filter migration 023 instance backfill by provenance — only instances with `lastSeenInRunId` in the config's runs gain memberships (NULL/never-reported rows stay membership-less; `import-run-service.ts` invariant: manual instances never touched) (code-review: standards)
- [x] T071 Fix migration 023 `latestRun` ordering — Postgres `DESC` is NULLS FIRST so a PENDING run wins; filter `startedAt is not null` (code-review: standards)
- [x] T072 Apply the stale-binding unbind on the fresh-registration path too — `registerOrMatchSource`'s early return for a NEW identity must also clear other Sources bound to the same `boundConfigId` (ADR-119 #3) (code-review: spec)
- [x] T073 Add a defensible-attribution filter to migration 023 component backfill: skip `default:`-prefixed externalIds (placeholder provenance, ADR-120 A2 §5) and URL-embedded-prefix ids whose canonicalized prefix != derived identity (endpoint-drifted rows) (code-review: spec)
- [x] T074 Qualify emitted externalIds with the canonicalized source identity in `importer-{aws,kubernetes,mcp-server,azure}` — a URL-parseable `sourceKey` is canonicalized by the backend, so raw-key qualification can never unqualify for adoption (code-review: spec)
- [x] T075 Minor cleanup: correct the 023 header comment (source insert has no ON CONFLICT), rename `existingId` → clearer name in importer-source-service.ts, rename azure's `scope` local → `identityPrefix`, cap `listSourceMemberships` queries at 200 rows each like `listSourceRuns` (code-review: standards)

## Phase 14: Review

- [x] T076 Filter migration 023 component backfill to `lifecycle = 'ACTIVE'` — an active membership on a RETIRED row blocks adopt-on-report indefinitely (code-review: standards)
- [x] T077 Scope adopt-on-report matching (both `::` unqualify and canonical fallback) to rows last-seen by runs of the reporting run's config — provider-wide matching lets e.g. a GHES run adopt a github.com row on a numeric-id collision; no defensible provenance → insert new (code-review: spec)
- [x] T078 Normalize auth-param keys in `canonicalizeSourceIdentity` (lowercase + strip non-alphanumeric) so camelCase/hyphen variants (`accessToken`, `access-key`, `authToken`) are stripped like snake_case (code-review: spec)
- [x] T079 Validate source-identity payload bounds agent-side in `packages/agent/src/executor.ts` before `send` — an over-limit identity must fail the run with CONTRACT_VIOLATION, not kill the whole session via BAD_FRAME/1008 (code-review: standards)
- [x] T080 Tighten `isUrlLike` to http(s) schemes only; `encodeURIComponent` the github `#login`-fallback org; drop the now-unreachable `if (!identity)`/`if (!sourceKey)` guards in aws/azure/k8s/mcp importers (schema enforces at config level) (code-review: standards)
- [x] T081 Clear `boundConfigId` on stale-bound Sources regardless of status in `importer-source-service.ts` — a RETIRED Source must not keep pointing at a config reporting a different identity (only non-RETIRED get status UNMONITORED) (code-review: standards)
- [x] T082 Memberships endpoint hardening: deterministic `orderBy` + `truncated` flag on `listSourceMemberships`; zod `:id` validation on `/:id` and `/:id/runs` too; fix `docs/importers/github.md` `{base}/org/{id}` missing-slash typo (code-review: standards + spec)

## Phase 15: Review

- [x] T083 Filter migration 023 instance backfill to non-`GONE` instances (a GONE instance is not source-reported and must not enter the effective-active union); document the ACTIVE-component/non-GONE-instance exclusion in `contracts/migration-rules.md` (code-review: standards + spec)
- [x] T084 Extend the 023 attribution filter: for `azure` configs require stored externalIds to start with `{identity}:` (prefix IS the subscription); skip configs whose derived identity exceeds 512 chars (runtime contract bound) (code-review: standards)
- [x] T085 Add the canonical-URL fallback to instance matching in `processAsset` — pre-migration instances stored with a raw URL spelling adopt (externalId rekeyed to canonical) instead of duplicating + going GONE (code-review: spec)
- [x] T086 Update `docs/openapi.yaml` memberships path: add `truncated` to the response schema and a `400` validation-failure response (code-review: standards)
- [x] T087 Minor fixes: `source-identity-keys.md` label column should reflect what importers actually send; stale-binding audit uses `action: "unbound"` (not "unmonitored" for RETIRED sources); memberships orderBy gets `id` tie-breaker for determinism (code-review: standards)

## Phase 16: Review

- [x] T088 Add `"unbound"` to `SOURCE_AUDIT_ACTIONS` in `packages/core/src/constants/importer-source.ts` (controlled enum must stay current — ADR-fidelity) (code-review: standards)
- [x] T089 Zod-validate `:id` on `POST /importer-sources/:id/retire` and `/reactivate` (ADR-095 — missed by the earlier params fix) (code-review: standards)
- [x] T090 Scope the migration 023 `default:` skip to `azure` only — kubernetes `{namespace}:{rtype}` ids legitimately start with `default:` (namespace default) and were defensible (code-review: spec)
- [x] T091 Extend instance canonical matching to multi-colon prefix splits — a stored `{rawEp}:{rtype}:0` with a port-bearing raw endpoint can't `new URL`-parse; walk colon positions right-to-left trying `canon(prefix)+rest` (shared helper with the component path) (code-review: spec)
- [x] T092 Hoist the per-asset `import_runs.configId` lookup out of `processAsset` — carry it on `RunSource` from the caller (`run.configId` / `job.configId`); also wrap remote `recordSourceIdentity` in try/catch → finalize the run `failed` with the real errorType instead of warn-swallow + misleading CONTRACT_VIOLATION (code-review: standards)
- [x] T093 Fold reconcile-time orphans into the final `instancesOrphaned` count — `reconcileRetiredComponents` increments SQL but the worker's final `updateRun` overwrites it; accumulate `orphaned` from the reconcile return into the local counter (code-review: spec)

## Phase 17: Review

- [x] T094 Fix remote-path reconcile orphan clobber: `RemoteRunStore.reconcile` must return the `{componentsRetired, instancesOrphaned}` pair and add `instancesOrphaned` into `entry.counters.orphaned` before `onRunComplete` finalizes (same fix the in-process worker got in T093) (code-review: standards)
- [x] T095 Fix `matchesCanonicalForm` infinite-loop edge (`stored` starting with `:` — `lastIndexOf` clamps to 0 forever; break when `i === 0`) and extend adoption to `::`-local-id matching: when `::` unqualify + canonical fallback miss, match stored ids whose `{anything}::{localId}` tail equals `legacyId` — covers the github `login/`→`org/` identity transition (ADR-120 A2 note) (code-review: spec + standards)
- [x] T096 Parity in migration 023: replace the single `lastIndexOf(":")` canonical check with a local multi-colon walk equivalent to `matchesCanonicalForm` so port-bearing raw endpoints attribute identically to runtime adoption (code-review: standards)
- [x] T097 Append ADR-120 Amendment 2 item noting the identity-transition rule: when a Source's reported identity changes (e.g. github `login/`→`org/` permission gain), adopt-on-report matches prior qualified ids by their `{*}::{localId}` tail (code-review: spec)
- [x] T098 Minor cleanup: bound the canonical-fallback candidate scans (`.limit(500)`), gate `configRunIds` construction on non-null `runConfigId`, normalize the `reportsSourceIdentity` checks to one form, extract a shared `idParamsSchema` in importer-sources.ts (code-review: standards)
