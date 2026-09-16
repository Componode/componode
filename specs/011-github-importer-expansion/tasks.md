---

description: "Task list for GitHub importer expansion"
---

# Tasks: GitHub Importer Expansion

**Input**: Design documents from `/specs/011-github-importer-expansion/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/importer-scope.md, quickstart.md

**Tests**: REQUIRED — constitution VI is test-first. Write each story's failing tests before implementation.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module skeletons inside `packages/importer-github` per plan.md — no new packages or dependencies needed.

- [X] T001 Create module skeletons `packages/importer-github/src/github-org.ts`, `github-billing.ts`, `github-repos.ts`, `github-extras.ts`, `mapping.ts`, `capabilities.ts`, `client.ts` (exported stubs only)
- [X] T002 [P] Add `.changeset/` entry bumping `@componode/importer-github` (minor) and `@componode/core` (minor for new category) per docs/release.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Taxonomy, config schema, Octokit client, mapping, capability markers, and the shared test harness — required by every story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add `ACCOUNT` to `COMPONENT_CATEGORIES` with `COMPONENT_CATEGORY_META` entry (`label: "Account"`, provider-level billing/administrative container) in `packages/core/src/constants/component-categories.ts`
- [X] T004 Write failing migration test asserting `components` accepts `category = 'ACCOUNT'` and rejects an invalid value, in `packages/backend/test/integration/migrations.test.ts`
- [X] T005 Implement migration `packages/backend/src/db/migrations/010_account_category.ts` — drop `components_category_check`, recreate via `checkConstraint("category", COMPONENT_CATEGORIES)`; down() restores the prior list. Verify T004 passes
- [X] T006 [P] Extend `githubConfigSchema` in `packages/importer-github/src/config.ts` — add `baseUrl` (optional, `.url().superRefine(urlSafetyError)` pattern from `importer-web-url`), `includeOrganization`, `includeBilling`, `billingPeriod` (`"current"|"previous"`, default `"current"`), `includeEnvironments`, `includeReleases`, `includeWorkflows`, `includeRunners`, `includePackages` (booleans per contracts/importer-scope.md), `environmentMapping` (`z.record(z.enum(ENVIRONMENTS)).optional()`)
- [X] T007 [P] Implement `buildOctokit(config, secrets)` in `packages/importer-github/src/client.ts` — `new Octokit({ auth: secrets.token, baseUrl: config.baseUrl, request: { headers: { "X-GitHub-Api-Version": "2026-03-10" } } })`
- [X] T008 [P] Implement `DEFAULT_ENVIRONMENT_MAPPING` + `resolveEnvironment(name, overrides)` in `packages/importer-github/src/mapping.ts` — trim/lowercase/exact-match lookup over merged defaults + `environmentMapping` (data-model.md)
- [X] T009 [P] Implement capability-marker types + `withCapability(fn, label)` guard helper in `packages/importer-github/src/capabilities.ts` — returns `{status:"OK"|"FORBIDDEN"|"ERROR"|"UNAVAILABLE", data?}`; maps HTTP 403→FORBIDDEN, 404→UNAVAILABLE, other→ERROR; never throws
- [X] T010 [P] Extract a reusable fetch-mock router `packages/importer-github/test/fetch-mock.ts` — `mockFetch(routes)` keyed on pathname (+query where needed) returning `Response` objects; refactor `test/importer.test.ts` to use it

**Checkpoint**: Foundation ready — `ACCOUNT` persists, config validates all new fields, Octokit builds for github.com and GHES, mapping/markers/harness unit-testable

---

## Phase 3: User Story 1 - Organization as a Catalog Asset (Priority: P1) 🎯 MVP

**Goal**: One `github:organization` `ACCOUNT` component per run carrying profile, plan/seats, policies, and the teams summary.

**Independent Test**: Run importer against a mocked org → exactly one `ACCOUNT` component with `details.profile`/`plan`/`policies`/`teams` populated; admin-denied fields show markers, not absence.

### Tests for User Story 1 ⚠️ (write FIRST, confirm they FAIL)

- [X] T011 [P] [US1] Test org component emission (category `ACCOUNT`, `externalId` = numeric org id, name/slug from login) in `packages/importer-github/test/importer.test.ts`
- [X] T012 [P] [US1] Test `details` payload: `plan` (seats filled/total), `policies.twoFactorRequired`, `usage` counts, `teams[]` with `memberCount`/`reposCount`/`privacy`/`parentSlug` in `packages/importer-github/test/importer.test.ts`
- [X] T013 [P] [US1] Test capability markers: org endpoint 403 → `capabilities.orgDetails = "FORBIDDEN"`, run still yields component in `packages/importer-github/test/importer.test.ts`
- [X] T014 [P] [US1] Test `includeOrganization: false` → no org component emitted in `packages/importer-github/test/importer.test.ts`

### Implementation for User Story 1

- [X] T015 [US1] Implement `fetchOrganizationAsset(octokit, config, capabilities)` in `packages/importer-github/src/github-org.ts` — `orgs.get` + `teams.list` (paginate) → `DiscoveredAsset` per data-model.md (`instances: []`)
- [X] T016 [US1] Wire org phase into `GithubImporter.run` in `packages/importer-github/src/importer.ts` — `reportPhase("Fetching organization")`, `withCapability` guards per section, yield before repo iteration
- [X] T017 [US1] Report `capabilities` summary object into org `details` in `packages/importer-github/src/github-org.ts`
- [X] T018 [US1] Verify T011–T014 pass; run `pnpm --filter @componode/importer-github test`

**Checkpoint**: US1 independently delivers the org asset — MVP candidate

---

## Phase 4: User Story 2 - Repositories with Real Deployment Topology (Priority: P1)

**Goal**: Stable `repo.id` externalIds; branch instances only for mapped branches (classifier + selector); GH environment instances with deployment-derived status/version/deployedAt.

**Independent Test**: Mock repos with environments/deployments/releases/branches → instances match the mapping and derivation chains in data-model.md; renamed repo keeps same `externalId`.

### Tests for User Story 2 ⚠️ (write FIRST, confirm they FAIL)

- [X] T019 [P] [US2] Update existing tests for `externalId = String(repo.id)` (breaking change) in `packages/importer-github/test/importer.test.ts`
- [X] T020 [P] [US2] Test mapped-branch instances: `main=PRODUCTION` mapping yields a `PRODUCTION` `branch:main` instance; unmapped branch names emit no instance in `packages/importer-github/test/importer.test.ts`
- [X] T021 [P] [US2] Test environment instances: env name → enum via mapping + `OTHER` fallback; never-deployed env → `STOPPED` in `packages/importer-github/test/importer.test.ts`
- [X] T022 [P] [US2] Test status/version/deployedAt chains: deployment `success→RUNNING`, `failure→ERROR`; version = deployment ref → release tag → null in `packages/importer-github/test/importer.test.ts`
- [X] T023 [P] [US2] Test `includeEnvironments: false` / `includeReleases: false` toggles in `packages/importer-github/test/importer.test.ts`

### Implementation for User Story 2

- [X] T024 [US2] Switch repo `externalId` to `String(repo.id)` in `buildDiscoveredAsset` in `packages/importer-github/src/importer.ts`
- [X] T025 [US2] Implement `enrichRepo(octokit, repo, config, capabilities)` in `packages/importer-github/src/github-repos.ts` — `repos.getAllEnvironments`, per-env `listDeployments` + `listDeploymentStatuses`, `repos.getBranch` per mapped branch, `repos.getLatestRelease`/`listReleases`
- [X] T026 [US2] Build instance list per data-model.md (`branch:{name}` + `env:{name}` kinds, status/version/deployedAt chains, `rawConfig` source truth) in `packages/importer-github/src/github-repos.ts`
- [X] T027 [US2] Integrate enrichment into `GithubImporter.run` in `packages/importer-github/src/importer.ts` — per-repo phase reporting, capability guards, respect `includeEnvironments`/`includeReleases` and `includeForks`/`includeArchived`
- [X] T028 [US2] Verify T019–T023 pass; run `pnpm --filter @componode/importer-github test`

**Checkpoint**: US2 independently delivers real deployment topology

---

## Phase 5: User Story 3 - Cost & Usage Visibility (Priority: P2)

**Goal**: Aggregated billing snapshot on the org component + per-repo attribution.

**Independent Test**: Mock billing endpoints → `details.billing` shows `{period, totals, byProduct, topRepos≤25}`; attributed repos carry `details.billing`; 403 → `FORBIDDEN` marker, run succeeds.

### Tests for User Story 3 ⚠️ (write FIRST, confirm they FAIL)

- [X] T029 [P] [US3] Test billing aggregation: usage items → totals/per-product/top-25-repos shape in `packages/importer-github/test/importer.test.ts`
- [X] T030 [P] [US3] Test per-repo attribution merges `repositoryName` usage into repo `details.billing` in `packages/importer-github/test/importer.test.ts`
- [X] T031 [P] [US3] Test 403 on billing endpoints → `{status:"FORBIDDEN"}` marker + run completes; `includeBilling: false` skips calls in `packages/importer-github/test/importer.test.ts`
- [X] T032 [P] [US3] Test `billingPeriod: "previous"` passes prior month to endpoint params in `packages/importer-github/test/importer.test.ts`

### Implementation for User Story 3

- [X] T033 [US3] Implement `fetchBillingSnapshot(octokit, org, period, capabilities)` in `packages/importer-github/src/github-billing.ts` — typed calls (`getGithubActionsBillingOrg`, `getGithubPackagesBillingOrg`, `getSharedStorageBillingOrg`, `getGithubBillingUsageReportOrg`) + `octokit.request()` for `usage/summary`, `ai_credit/usage`, `premium_request/usage`
- [X] T034 [US3] Implement aggregation + `topRepos` (cap 25) + per-repo `billing` map in `packages/importer-github/src/github-billing.ts`
- [X] T035 [US3] Wire billing into org `details.billing` and repo `details.billing` in `packages/importer-github/src/importer.ts` — guarded by `includeBilling`, `billingPeriod` honored
- [X] T036 [US3] Verify T029–T032 pass; run `pnpm --filter @componode/importer-github test`

**Checkpoint**: US3 delivers cost visibility with graceful permission degradation

---

## Phase 6: User Story 4 - Extended Inventory & Enterprise Reach (Priority: P3)

**Goal**: `github:workflow`/`github:runner`/`github:package` emitters behind toggles; GHES `baseUrl`; rate-limit logging.

**Independent Test**: Enable each toggle → matching component type appears; `baseUrl` hits the GHES host; unsafe `baseUrl` rejected at config validation.

### Tests for User Story 4 ⚠️ (write FIRST, confirm they FAIL)

- [X] T037 [P] [US4] Test `includeWorkflows` emits `JOB`/`github:workflow` per repo (`externalId: {repoId}:{workflowId}`) in `packages/importer-github/test/importer.test.ts`
- [X] T038 [P] [US4] Test `includeRunners` emits `COMPUTE`/`github:runner` from org runners in `packages/importer-github/test/importer.test.ts`
- [X] T039 [P] [US4] Test `includePackages` emits `PACKAGE_REGISTRY`/`github:package` iterating all six `package_type` values in `packages/importer-github/test/importer.test.ts`
- [X] T040 [P] [US4] Test `baseUrl` is used for API calls and unsafe values (non-HTTPS, localhost, literal private IP) fail schema validation in `packages/importer-github/test/importer.test.ts` + config-schema test
- [X] T041 [P] [US4] Test rate-limit budget logged at run start/end via `rateLimit.get` + `context.logger` in `packages/importer-github/test/importer.test.ts`

### Implementation for User Story 4

- [X] T042 [P] [US4] Implement `fetchWorkflowAssets(octokit, repo)` → `JOB` assets in `packages/importer-github/src/github-extras.ts` (`actions.listRepoWorkflows`, paginated)
- [X] T043 [P] [US4] Implement `fetchRunnerAssets(octokit, org)` → `COMPUTE` assets in `packages/importer-github/src/github-extras.ts` (`actions.listSelfHostedRunnersForOrg`, org-level only)
- [X] T044 [P] [US4] Implement `fetchPackageAssets(octokit, org)` → `PACKAGE_REGISTRY` assets in `packages/importer-github/src/github-extras.ts` (`packages.listPackagesForOrganization` × six `package_type`s)
- [X] T045 [US4] Wire the three emitters into `GithubImporter.run` behind their toggles with `withCapability` guards in `packages/importer-github/src/importer.ts`
- [X] T046 [US4] Add `rateLimit.get` calls at run start/end with `context.logger.info` in `packages/importer-github/src/importer.ts`
- [X] T047 [US4] Verify T037–T041 pass; run `pnpm --filter @componode/importer-github test`

**Checkpoint**: US4 completes the extended inventory + GHES reach

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Frontend form, docs, taxonomy record, validation.

- [X] T048 Extend GitHub section of `packages/frontend/src/components/importer-config-form.tsx` — `baseUrl` input, `billingPeriod` select, five capability switches, `environmentMapping` input (`name=ENV` comma pairs) per contracts/importer-scope.md; populate from `config.scope` in edit mode
- [X] T049 [P] Add taxonomy note for `ACCOUNT` category in `researches/adrs/` (constitution III three-way update: research + core + migration — core/migration done in T003–T005)
- [X] T050 [P] Update `manifest.description` and importer docs (`docs/importer-development.md` capability-marker pattern note) in `packages/importer-github/src/manifest.ts` and `docs/importer-development.md`
- [X] T051 [P] Update `README.md` roadmap — mark `011-github-importer-expansion` complete once implemented per AGENTS.md
- [X] T052 Update `specs/011-github-importer-expansion/checklists/requirements.md` if any spec drift occurred; run `pnpm -r typecheck && pnpm -r build && pnpm -r test`
- [x] T053 Execute `quickstart.md` manual scenarios S1–S5 against a real org (or recorded fixtures); record results — verified 2026-09-16 against org `Componode` (id 329863123) with a scoped PAT: S1 org ACCOUNT asset with profile/plan/policies/teams/capabilities; S2 repo `quickstart-validation` emitted `env:staging` STAGING/RUNNING (deployment success), `branch:main` PRODUCTION and `branch:develop` DEV only via explicit mapping; S3 billing snapshot OK with `actionsMinutes`/`packagesStorage`/`sharedStorage` marked ERROR (GitHub deprecated the legacy `/billing/*` endpoints — graceful degradation verified); S4 toggle-off run emitted fewer assets, GHES covered by unit tests; S5 rate-limit logged at run start and end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
  - T003 → T004 → T005 (constant → failing test → migration)
  - T006–T010 parallel
- **User Stories (Phase 3–6)**: All depend on Foundational
  - US1/US2 are both P1 — US1 first (MVP), US2 second; they touch different modules (`github-org` vs `github-repos`) but share `importer.ts` wiring (sequential integration)
  - US3 depends on US1 (billing lands on org component) and US2 (attribution lands on repo assets)
  - US4 independent of US1–US3 after Foundational
- **Polish (Phase 7)**: After desired stories complete; T048 can run in parallel with any story

### Within Each User Story

- Tests MUST be written and FAIL before implementation (constitution VI)
- Module implementation → `importer.ts` wiring → test verification

### Parallel Opportunities

- T002, T006, T007, T008, T009, T010 (foundational) — different files
- T011–T014, T019–T023, T029–T032, T037–T041 (test tasks per story) — same file but separable cases; can be authored in one pass then verified failing
- T042, T043, T044 (US4 emitters) — independent functions in one file
- T049, T050, T051 (polish docs) — independent files

### Parallel Example: Foundational

```bash
Task: "Extend githubConfigSchema in packages/importer-github/src/config.ts"
Task: "Implement buildOctokit in packages/importer-github/src/client.ts"
Task: "Implement DEFAULT_ENVIRONMENT_MAPPING in packages/importer-github/src/mapping.ts"
Task: "Implement withCapability in packages/importer-github/src/capabilities.ts"
Task: "Extract fetch-mock router in packages/importer-github/test/fetch-mock.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → foundation ready (ACCOUNT persists, config/client/mapping/markers done)
2. Phase 3 (US1) → org component visible in catalog → **STOP, validate, demo**
3. Continue: US2 (topology) → US3 (billing) → US4 (inventory/GHES)

### Incremental Delivery

Each story is a self-contained increment: US1 adds the org asset; US2 upgrades repos + flips `externalId` (deploy together to absorb the one-time re-catalog); US3 adds cost data; US4 adds opt-in emitters + GHES.

### Notes

- `externalId` break (T024): coordinate merge — existing installs re-catalog repos once (spec Assumptions)
- Octokit throttling/retry already active — no rate-limit handling code needed beyond logging (T046)
- `repos` allowlist scopes repo-level work only; org-level sections run regardless (spec edge case)

---

## Phase 8: Convergence

- [X] T054 Assert `validateDiscoveredAsset` on every yielded asset in `packages/importer-github/test/importer.test.ts` per AGENTS.md Testing (missing)
- [X] T055 Include `sku` in billing `byProduct` breakdown entries in `packages/importer-github/src/github-billing.ts` per FR-010 (partial)
