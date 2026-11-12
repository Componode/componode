# Tasks: GitHub importer branch, release & metadata inventory

**Input**: Design documents from `/specs/072-github-branch-inventory/` (plan.md, research.md, data-model.md, contracts/github-inventory.md, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/github-inventory.md

**Tests**: INCLUDED — constitution VI (test-first) + spec FR-018 + project Playwright rule.

**Organization**: Tasks grouped by user story; shared plumbing in Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependencies)
- **[Story]**: US1/US2/US3 mapping to spec.md priorities

---

## Phase 1: Setup

- [X] T001 Baseline check: `cd packages/importer-github && pnpm test` green before changes; record starting state

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: config surface, client resilience, shared fetch plumbing, capability aggregation — everything stories build on.

- [X] T002 [P] Add config toggles to `githubConfigSchema` in `packages/importer-github/src/config.ts`: `includeBranchInventory` (bool, default true), `includeBranchActivity` (bool, default false), `includeBranchInstances` (bool, default true), `includeReleaseInventory` (bool, default true), `includeLanguageBreakdown` (bool, default false) — descriptions per contracts/github-inventory.md §1
- [X] T003 [P] Configure octokit retry/throttle bounds in `packages/importer-github/src/client.ts` `buildOctokit`: `retry.retries` and `throttle.onRateLimit`/`onSecondaryRateLimit` allowing bounded retries (≤3) honoring retry-after; keep per-request `signal` propagation (FR-015)
- [X] T004 Create `packages/importer-github/src/github-inventory.ts`: payload types per data-model.md (`BranchInventoryEntry`, `ReleaseInventoryEntry`, `TagInventoryEntry`) + capability-wrapped fetchers `fetchBranchInventory` (reuses a caller-supplied paginated branch list — see T006), `fetchVersionInventory` (`GET /releases` + `GET /tags`, paginate.iterator, per_page 100), `fetchLanguageBreakdown` (`GET /languages`, opt-in)
- [X] T005 Refactor branch listing for single-fetch sharing: extract the paginated `listBranches` call from `buildRepoInstances` (`github-repos.ts:161-172`) into a shared helper (e.g. `listAllBranches` in github-inventory.ts or github-repos.ts) returning `{name, sha, url, protected}[]` — used by BOTH instance classification and inventory (no duplicate API call)
- [X] T006 Wire repo-loop inventory + capability aggregation in `packages/importer-github/src/importer.ts`: per repo, gather `details.capabilities` markers (worst-status per family via withCapability results); move org-asset `yield` to AFTER the repo loop merging repo-scoped aggregate markers (worst-status-wins, message notes repo count) into the shared `capabilities` map per research.md D5; keep runner/package yields early
- [X] T007 Gate the branch-instance block in `buildRepoInstances` (`github-repos.ts:161-199`) under `config.includeBranchInstances` (default true preserves spec-011); dedupe `getBranch` calls between instance path and `includeBranchActivity` (fetch once per branch, share result)
- [X] T008 Fix pagination truncations: `getAllEnvironments` (`github-repos.ts:106`) and `listPackagesForOrganization` (`github-extras.ts:114`) → `paginate.iterator`, per_page 100 (FR-014)
- [X] T009 Route existing silent failures through capability markers: environments/deployments/releases-latest fetches inside `buildRepoInstances` record per-repo `details.capabilities` entries + `warnIfDegraded` (FR-013); sync `manifest.ts` version and `GithubImporter.version` to `"1.2.0"` (FR-016)
- [X] T010 Extend `packages/importer-github/test/fetch-mock.ts` + `test/importer.test.ts` scaffolding for new endpoints (`/releases`, `/tags`, `/languages`, multi-branch fixtures, env `protection_rules`) — test infrastructure only, assertions land per story

**Checkpoint**: config schema exposes toggles; org yield aggregation plumbing compiles; existing tests still pass (default-on preserves behavior).

---

## Phase 3: User Story 1 — See every branch of an imported repository (Priority: P1) 🎯 MVP

**Goal**: `details.branches[]` lists every provider branch (name/sha/url/protected/isDefault/optional lastActivityAt) on each repo component; rendered on the component page.

**Independent Test**: mock repo with `main`+unmapped branches → component details + page show all branches; instances table still shows only mapped branch instances.

### Tests for User Story 1

- [X] T011 [US1] Failing importer tests in `test/importer.test.ts`: (a) `details.branches` contains every fixture branch incl. `main`/`trunk`/`dependabot/*` with `protected`, `isDefault` on default only, `sha`, `url`; (b) `includeBranchInventory:false` omits `branches` key but mapped instances still emit; (c) `includeBranchInstances:false` suppresses `branch:*` instances while inventory still emits; (d) `includeBranchActivity:true` adds `lastActivityAt` (one `getBranch` per branch, deduped with instance path); (e) `/branches` 403 → `details.capabilities.branches=FORBIDDEN` + org aggregate marker + run completes
- [X] T012 [P] [US1] Failing frontend unit test `packages/frontend/src/test/unit/github-details.test.tsx`: `GithubDetailsSection` renders branch rows (name, default/protected badges, sha, activity, link) from allowlisted details keys only

### Implementation for User Story 1

- [X] T013 [US1] Implement branch inventory emission in `github-inventory.ts` + wire into `importer.ts` repo loop → `buildDiscoveredAsset` details (`branches[]` per contract §2; `isDefault` from `repo.default_branch`; single shared branch-list fetch per T005)
- [X] T014 [US1] Repo metadata scalars into `details` (`defaultBranch`, `archived`, `disabled`, `fork`, `forkParent`, `forkSource`, `sizeKb`, `license`, `openIssuesCount`, `createdAt`, `pushedAt`, `updatedAt`) in `importer.ts`/`github-repos.ts` — fields already on the repo object (FR-010 partial; US3 adds languages/governance)
- [X] T015 [US1] Create `packages/frontend/src/ux/components/catalog/github-details.tsx`: allowlisted shapers (docker-details.tsx pattern, ADR-121 — no generic dump) + `GithubDetailsSection` with repo-facts DescriptionList + branches table; render in `component-detail.tsx` for `resourceType === "github:repository"`
- [X] T016 [US1] Verify T011/T012 pass; `pnpm test && pnpm typecheck && pnpm lint && pnpm build` in importer-github + frontend

**Checkpoint**: US1 independently demoable — every branch visible on component page; MVP shippable.

---

## Phase 4: User Story 2 — See the released-version inventory per repository (Priority: P2)

**Goal**: `details.releases[]` + `details.tags[]` fully paginated; rendered on component page; `includeReleases` latest-fallback untouched.

**Independent Test**: mock repo with releases (incl. prerelease/draft), plain tags, >1 page → inventory distinguishes all; env-instance version fallback still resolves.

### Tests for User Story 2

- [X] T017 [US2] Failing importer tests: `details.releases` fields per contract (id/tagName/name/publishedAt/prerelease/draft/targetCommitish/assetCount/assetsTotalBytes/htmlUrl); `details.tags` (name/sha/htmlUrl); full pagination across pages; `includeReleaseInventory:false` omits both keys while `includeReleases` latest-fallback still feeds env instances; `/releases` 403 → `versionInventory` marker, run completes

### Implementation for User Story 2

- [X] T018 [US2] Implement `fetchVersionInventory` in `github-inventory.ts` (paginated `/releases` + `/tags`, asset summary = count + summed `size`) and wire into repo loop details
- [X] T019 [US2] Extend `github-details.tsx`: releases + tags tables (tag, published date, prerelease/draft badges, target ref, asset summary, links); unit tests for new sections
- [X] T020 [US2] Verify T017 passes; package verification sweep

**Checkpoint**: US1+US2 both independently functional.

---

## Phase 5: User Story 3 — Repository facts & environment governance (Priority: P3)

**Goal**: repo metadata complete (incl. opt-in languages); env instances carry `rawConfig.githubEnvironment` governance; per-repo + org capability markers complete.

**Independent Test**: forked repo → provenance fields; protected env → instance rawConfig governance; token-lacking scope → marker not failure.

### Tests for User Story 3

- [X] T021 [US3] Failing importer tests: `details.languages` only when `includeLanguageBreakdown` (403 → `languages` marker); env `protection_rules`/`deployment_branch_policy`/`can_admins_bypass` → `rawConfig.githubEnvironment` normalized camelCase allowlist; environments 403 → `environments` marker + instance still emits with base fields; per-repo `details.capabilities` + org aggregate entries present for every touched family
- [X] T022 [P] [US3] Failing frontend unit tests: repo-facts rows render; `InstanceDetails`/`hasInstanceDetails` recognizes `rawConfig.githubEnvironment` and renders governance section

### Implementation for User Story 3

- [X] T023 [US3] Implement `fetchLanguageBreakdown` wiring + env governance extraction in `github-repos.ts` (normalize `protection_rules[]` per type allowlist per data-model.md; omit `githubEnvironment` when absent/failed)
- [X] T024 [US3] Complete per-repo `details.capabilities` for all families + org aggregate merge verification in `importer.ts`
- [X] T025 [US3] Extend `docker-details.tsx` `InstanceDetails`/`hasInstanceDetails` with `githubEnvironment` shaper + "GitHub environment" section; extend `github-details.tsx` repo-facts coverage (license, fork provenance, counts)
- [X] T026 [US3] Verify T021/T022 pass; package verification sweep

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting

- [X] T027 [P] Extend `playwright/mocks/github/server.ts`: `/releases`, `/tags`, `/languages` endpoints; multi-branch repo fixtures (mapped + unmapped); env `protection_rules`/`deployment_branch_policy`/`can_admins_bypass` payloads; capability-failure scenario coverage for new endpoints
- [X] T028 Playwright journey spec (importers or journeys dir): run mock importer → assert `GET /api/v1/components/{id}` `details.branches`/`releases`/`tags` populated + env instance `rawConfig.githubEnvironment` → assert component page renders GitHub section (per constitution VI + FR-018)
- [X] T029 Update `docs/importers/github.md`: inventory description, branch-instances selector semantics, new toggles table rows (via `pnpm docs:importers` regen for GENERATED region + hand-edit prose sections), token scope notes per permission family (Contents/Metadata, Actions, Deployments)
- [X] T030 Full verification sweep: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for importer-github + frontend; `pnpm docs:oracle:check`/`docs:sidebar:check`/`docs:api:check` as applicable; targeted `pnpm e2e -- --grep <spec>`; `git status` clean except intended files
- [ ] T031 Commit spec artifacts + implementation on `072-github-branch-inventory`; push; open PR per repo convention (do NOT include `.devin/sec-review/`)

---

## Dependencies & Execution Order

```
Phase 2 (config/client/inventory-module/aggregation plumbing)
   ├──▶ Phase 3 US1 (branch inventory + instances gate + page section)
   ├──▶ Phase 4 US2 (version inventory — independent of US1 code paths)
   └──▶ Phase 5 US3 (metadata/governance/capabilities completion)
Phase 6 polish depends on all stories; T027 mock work can start any time after T002
```

- US2/US3 build on the same `github-inventory.ts` module and `importer.ts` wiring from Phase 2 — sequential file edits, not parallel.
- T005 (shared branch fetch) must precede T013; T006 (org yield reorder) precedes all capability-marker assertions.
- Frontend `github-details.tsx` created in US1 (T015) is extended by US2 (T019) and US3 (T025) — same file, sequential.

## Parallel opportunities

- T002 ∥ T003 (config.ts vs client.ts)
- T004 module skeleton ∥ T008 pagination fixes (different files)
- T012 frontend test ∥ T011 importer tests (different packages)
- T022 frontend test ∥ T021 importer tests
- T027 mock extension ∥ story implementation (different tree)

## Implementation strategy

MVP = Phase 2 + Phase 3 (US1 alone delivers the reported fix: all branches visible). US2/US3 are additive enrichments on the same plumbing. Each phase ends with package verification green before the next begins.
