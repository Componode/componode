---

description: "Task list for Alibaba Cloud importer implementation"
---

# Tasks: Alibaba Cloud Importer

**Input**: Design documents from `/specs/024-alibaba-cloud-importer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/importer-contract.md

**Tests**: REQUIRED — constitution VI (test-first). Every story's tests are
written first, confirmed failing, then implemented.

**Organization**: Tasks grouped by user story for independent implementation
and testing.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package scaffold and registration

- [x] T001 Create package scaffold `packages/importer-alibaba-cloud/` (`package.json` with `type:"module"` and `./manifest` + `./importer` exports, `tsconfig.json`, `src/index.ts`) — copy structure from `packages/importer-aws/`
- [x] T002 Add dependencies via `pnpm add` inside `packages/importer-alibaba-cloud/`: `@componode/core` (`workspace:*`), `zod` (`^3.24.1`), `@alicloud/resourcecenter20221201` (`^1.6.0`), `@alicloud/sts20150401` (`^1.2.0`), `@alicloud/bssopenapi20171214` (`^4.1.1`); devDeps `typescript`, `vitest` matching sibling importers
- [x] T003 [P] Register the importer: add `"@componode/importer-alibaba-cloud"` to `IMPORTER_PACKAGES` in `packages/backend/src/services/importer-registry.ts` and `"@componode/importer-alibaba-cloud": "workspace:*"` to `packages/backend/package.json` dependencies
- [x] T004 Run `pnpm install` and `pnpm -r build` — scaffold compiles and registry imports resolve

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Taxonomy update, migration, and pure modules every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Add `"ALIBABA_CLOUD"` to `COMPONENT_PROVIDERS` and `{ label: "Alibaba Cloud", description: "Cloud assets discovered from Alibaba Cloud" }` to `COMPONENT_PROVIDER_META` in `packages/core/src/constants/component-providers.ts`
- [x] T006 Create migration `packages/backend/src/db/migrations/015_alibaba_cloud_provider.ts`: drop `components_provider_check`, re-add from `COMPONENT_PROVIDERS` (`sql` + `sql.join` + `sql.lit`, same pattern as `010_account_category.ts`); `down` re-adds the list filtered without `ALIBABA_CLOUD`
- [x] T007 [P] Append an addendum to `researches/component_taxonomy_research.md` noting `ALIBABA_CLOUD` (proposed §12.3) is ratified under ADR-115 / spec 024
- [x] T008 Create `packages/importer-alibaba-cloud/src/config.ts` — strict zod schema per data-model.md: `regionIds?: string[]`, `resourceTypes?: string[]`, `resourceGroupId?: string`, `environment` (ENVIRONMENTS enum, default `"PRODUCTION"`), `enrichResources` (default `false`), `includeCosts` (default `false`), `billingPeriod?` (`YYYY-MM` regex), `endpoint?` (URL, `.superRefine` with `urlSafetyError` from `@componode/core`); export `AlibabaCloudConfig` type
- [x] T009 Create `packages/importer-alibaba-cloud/src/manifest.ts` per contracts/importer-contract.md (`name: "alibaba-cloud"`, `implPath: "@componode/importer-alibaba-cloud/importer"`, three secret declarations)
- [x] T010 Create `packages/importer-alibaba-cloud/src/client.ts` — `buildClients(secrets, config)` returning a narrow typed interface `{ sts.getCallerIdentity, resourceCenter.getServiceStatus, resourceCenter.getResourceCounts, resourceCenter.searchResources, resourceCenter.getResourceConfiguration, bss.queryAccountBill }` wrapping the three Darabonba SDKs; this is the unit-test mock seam
- [x] T011 [P] Create `packages/importer-alibaba-cloud/src/mapping.ts` — `ACS::<Service>::<Type>` → `ComponentCategory` table (start from research.md §4 list), `slugify(name)`, `componentSlug(name, resourceId)` (name + `-` + last 8 of id), `externalId(record)` (ARN else `type:resourceId`), `mapStatus(providerStatus)` → `InstanceStatus | null` per data-model.md rules
- [x] T012 [P] Create `packages/importer-alibaba-cloud/src/filters.ts` — `buildSearchFilters(config)` → `Filter[]` (`RegionId`/`ResourceType`/`ResourceGroupId`, `MatchType:"Equals"`, values OR'd; empty inputs → `[]`)
- [x] T013 [P] Create `packages/importer-alibaba-cloud/src/capabilities.ts` — port `withCapability`, `capabilityMarker`, `warnIfDegraded`, `CapabilityMap` types from `packages/importer-github/src/capabilities.ts` (error→status mapping: 403→`FORBIDDEN`, 404→`UNAVAILABLE`, else `ERROR`)
- [x] T014 [P] Create `packages/importer-alibaba-cloud/test/client-mock.ts` — `vi.mock("../src/client.js")` factory exporting controllable stubs for every `buildClients` method + fixture builders for search records / counts / bill items / caller identity

**Checkpoint**: Foundation ready — provider constant lands, migration runs, pure modules exist, mock seam is usable

---

## Phase 3: User Story 1 - Import an Alibaba Cloud account (P1) 🎯 MVP

**Goal**: A configured run yields the account component plus one
component+instance per mapped resource, across all regions.

**Independent Test**: Run `pnpm --filter @componode/importer-alibaba-cloud
test` — fixtures prove account+resource assets pass
`validateDiscoveredAsset`; backend integration test proves a run lands
`ALIBABA_CLOUD` components in Postgres.

### Tests for User Story 1 (write FIRST, confirm FAIL)

- [x] T015 [P] [US1] Test in `packages/importer-alibaba-cloud/test/importer.test.ts`: mocked search pages → yields assets where every `validateDiscoveredAsset(asset) === true`; account asset has `category:"ACCOUNT"`, `provider:"ALIBABA_CLOUD"`, `externalId` = account ID; resource assets have mapped category, `externalId` from ARN/`type:resourceId`, instance `region` set, `environment:"PRODUCTION"`
- [x] T016 [P] [US1] Test: `GetResourceCenterServiceStatus` reports disabled → `run` throws actionable error naming the service and yields nothing; `GetCallerIdentity` auth failure → `run` throws
- [x] T017 [P] [US1] Test: `signal.aborted` mid-pagination stops iteration; `process.env` access spy never fires (aws-test pattern); yielded assets have no `relationships` key
- [x] T018 [P] [US1] Test: multi-page `NextToken` loop drains all pages; `Throttling` error triggers retry with backoff, persistent throttle surfaces as run error
- [x] T019 [P] [US1] Test: unmapped `ACS::*::*` types are skipped with one `logger.warn` per type and counted — no throw

### Implementation for User Story 1

- [x] T020 [US1] Implement `packages/importer-alibaba-cloud/src/account.ts` — `buildAccountAsset(identity, config)` → ACCOUNT `DiscoveredAsset` shell per data-model.md (coverage/capabilities attached by caller)
- [x] T021 [US1] Implement `packages/importer-alibaba-cloud/src/resources.ts` — `searchAllResources(client, config, context)`: paginated `SearchResources` (`MaxResults:100`, filters from `buildSearchFilters`), abort checks per page/record, throttle retry (exponential backoff, max 3), collects `{mapped[], skippedTypes}`; `buildResourceAsset(record, config)` → component+instance per data-model.md
- [x] T022 [US1] Implement `run()` in `packages/importer-alibaba-cloud/src/importer.ts` — sequence per contracts/importer-contract.md (account asset yielded LAST with coverage); `reportPhase` transitions `Authenticating → Checking service → Counting resources → Searching resources → Completed`; `context.logger` progress only
- [x] T023 [US1] Write backend integration test `packages/backend/test/integration/alibaba-import.test.ts` — `vi.mock` `getImporter` to return a fixture importer yielding `ALIBABA_CLOUD` assets (import-runs.test.ts pattern); assert run completes, components/instances persist with the new provider value (exercises migration 015 CHECK)

**Checkpoint**: `pnpm --filter @componode/importer-alibaba-cloud test` green; integration test green; MVP deliverable

---

## Phase 4: User Story 2 - Verify credentials before importing (P2)

**Goal**: `testSecrets` gives an immediate ok/failure via `GetCallerIdentity`.

**Independent Test**: `credential-test.test.ts` — ok path, failure path,
no secret material in errors.

- [x] T024 [P] [US2] Test in `packages/importer-alibaba-cloud/test/credential-test.test.ts`: success → `{ok:true}`; auth error → `{ok:false}` with class-only message (e.g. `"Authentication failed (InvalidAccessKeyId)"`) and no `accessKeySecret`/`securityToken` values echoed
- [x] T025 [US2] Implement `testSecrets` in `packages/importer-alibaba-cloud/src/importer.ts` per contracts/importer-contract.md (parse config leniently with `.partial()`, `GetCallerIdentity` only)

**Checkpoint**: Credential test action works end-to-end for the new importer

---

## Phase 5: User Story 3 - Scope the import (P2)

**Goal**: `regionIds` / `resourceTypes` / `resourceGroupId` narrow discovery.

**Independent Test**: unit tests asserting the `Filter[]` passed to
`searchResources` for each config combination.

- [x] T026 [P] [US3] Test in `packages/importer-alibaba-cloud/test/importer.test.ts` (or `filters.test.ts`): `regionIds:["cn-hangzhou"]` → `{Key:"RegionId",MatchType:"Equals",Value:["cn-hangzhou"]}`; `resourceTypes` → `ResourceType` filter; `resourceGroupId` → `ResourceGroupId` filter; all-empty → `[]`; multiple values OR within one condition
- [x] T027 [US3] Verify/adjust `buildSearchFilters` in `packages/importer-alibaba-cloud/src/filters.ts` against test expectations

**Checkpoint**: Scoped configs produce correctly filtered searches

---

## Phase 6: User Story 4 - See what was skipped (P2)

**Goal**: `GetResourceCounts` totals + skip tracking land in
`details.coverage` on the account asset.

**Independent Test**: fixture with an unmapped type → account asset's
`details.coverage` lists it; mapped-only fixture → `skippedCount:0`.

- [x] T028 [P] [US4] Test: unmapped type present → account `details.coverage.skippedTypes` contains it, `skippedCount`/`mappedCount`/`discoveredCount` correct, `totals` from `GetResourceCounts` attached; counts call failure → `capabilities.resourceCounts:"ERROR"`, run still completes
- [x] T029 [US4] Implement coverage assembly — `getResourceCounts` guarded via `withCapability`; merge `{discoveredCount, mappedCount, skippedCount, skippedTypes, totals}` into the account asset's `details.coverage` before its (last-position) yield in `src/importer.ts`

**Checkpoint**: Coverage summary visible on account component for any run

---

## Phase 7: User Story 5 - Enrich components with live detail (P3)

**Goal**: `enrichResources:true` adds full configuration + mapped status per
resource, guarded per-resource.

**Independent Test**: enrichment on → instances carry enriched `rawConfig`
and mapped `status`; a denied call → capability marker, run completes; off →
zero enrichment calls.

- [x] T030 [P] [US5] Test: `enrichResources:true` → `getResourceConfiguration` called per resource, `rawConfig` = configuration body, `status` mapped (`Running`→`RUNNING`, `Stopped`→`STOPPED`, unknown→`null`); a throwing call → `details.capabilities.enrichment` marker on that component, other resources unaffected
- [x] T031 [US5] Implement per-resource guarded `GetResourceConfiguration` enrichment inside `packages/importer-alibaba-cloud/src/resources.ts` — merge config body into `rawConfig`, `mapStatus` → `status`, wired behind `config.enrichResources` (implemented in `resources.ts` rather than a separate `enrich.ts`)

**Checkpoint**: Enriched runs produce status + full config; base runs unchanged

---

## Phase 8: User Story 6 - Attach cost data (P3)

**Goal**: `includeCosts:true` attaches per-resource billing to
`details.billing`.

**Independent Test**: bill fixtures keyed by resource ID land on matching
components; no permission → `FORBIDDEN` marker; invalid `billingPeriod`
format → config error.

- [x] T032 [P] [US6] Test: `includeCosts:true` → `queryAccountBill` called once for the period, line items grouped by resource ID into `details.billing` (`{period, pretaxAmount, currency}` per resource); 403 → `capabilities.costs:"FORBIDDEN"`, run completes; `billingPeriod:"2026-13"` → config validation error
- [x] T033 [US6] Implement `packages/importer-alibaba-cloud/src/costs.ts` — `fetchCosts(client, period, signal)` → `Map<resourceId, billing>`; default period = latest closed `YYYY-MM`; merge into component `details.billing` during asset build; wire in `src/importer.ts`

**Checkpoint**: Cost-capable runs annotate components; forbidden degrades cleanly

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Feature-wide verification and documentation sync

- [x] T034 [P] Run `pnpm lint && pnpm typecheck` repo-wide; fix findings in new code
- [x] T035 [P] Run `pnpm --filter @componode/importer-alibaba-cloud test` + `pnpm --filter @componode/backend test` — all green including new integration test
- [x] T036 Update `docs/roadmap.md` — mark Alibaba Cloud importer shipped (it is listed as a remaining provider / contributor-welcome item)
- [x] T037 Verify frontend renders `Alibaba Cloud` provider label in component filters (driven by `COMPONENT_PROVIDER_META` — no code change expected, confirm)
- [x] T038 Run quickstart.md checklist end-to-end; run `speckit-analyze` for cross-artifact consistency before merge
- [x] T039 Commit all artifacts (research doc, ADR-115 + index, spec dir, package, migration, registry) on `feature/024-alibaba-cloud-importer`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: depends on T001–T004 — BLOCKS all stories
- **US1 (Phase 3)**: depends on Phase 2 — MVP
- **US2 (Phase 4)**: needs T010 client seam only — could run parallel to US1 after Phase 2
- **US3 (Phase 5)**: needs T021 resources loop — after US1
- **US4 (Phase 6)**: needs T020/T021/T022 — after US1
- **US5 (Phase 7)**: needs T021 — after US1
- **US6 (Phase 8)**: needs T022 — after US1; independent of US4/US5
- **Polish (Phase 9)**: after desired stories complete

### Parallel Opportunities

- Phase 2: T005, T007, T011, T012, T013, T014 parallel (different files)
- US1 tests T015–T019 parallel (same file — write together as one suite)
- US2 fully parallel with US1 after Phase 2
- US4/US5/US6 parallel after US1 (different modules)

## Implementation Strategy

### MVP First

T001–T023 delivers US1 — a working discover-all importer with account
component, migration, and integration coverage. Ship-able alone.

### Incremental

US2 (credential test) → US3 (filters) → US4 (coverage) harden the core path;
US5/US6 are additive opt-ins.
