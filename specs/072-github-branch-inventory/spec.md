# Feature Specification: GitHub importer branch, release & metadata inventory

**Feature Branch**: `072-github-branch-inventory`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User request — "The GitHub importer is not bringing or presenting all the branches from the repositories… reassess the GitHub Importer code, check the official GitHub API reference and propose what can be fixed and included as valuable information for the DPAM scope." Research completed in `researches/github-importer-branches-research.md`. Confirmed root cause: the importer enumerates every branch but emits a `ComponentInstance` only for branch names matching the environment mapping (classifier-and-selector per spec 011 FR-007); `main`, `master`, `feature/*`, `dependabot/*` etc. are silently dropped — verified live: `Componode/componode` (7 branches) and `Componode/v0-componode-dpam` (5 branches) both produce **zero** branch instances. Ratified approach (research §4–§7): keep spec-011 mapped-branch *instances* unchanged and add a **complete inventory layer** carried on the repository component's details — branches, releases, tags, and repository/environment metadata the GitHub API already returns or cheaply provides. Governing docs: ADR-014 (environment-as-instance), ADR-034 (instance upsert key), ADR-057 (no importer-declared product edges), ADR-119/ADR-120 (source identity & membership details), spec 011 (GitHub importer expansion — its branch-instance semantics stay valid). **Amended during implementation review**: the user directed that branches belong in the instance model per the DPAM pattern — see Clarifications session 2 below; spec-011 selector semantics are amended accordingly.

## Clarifications

### Session 2026-11-12

All decisions resolved during research — no open markers:

- **Representation → inventory on component details, not instances**: a git branch is not an environment; forcing every branch into `ComponentInstance.environment` (closed enum) would flood `OTHER` and falsify `status`/`deployedAt`. The complete branch list is source *inventory* — it belongs in the repository component's details payload, where it is visible on the component page without touching the instance model.
- **Spec-011 branch instances → kept**: environment-mapped branch instances (`branch:{name}`) continue to emit exactly as today — they answer "which branches play which environment role"; the inventory answers "which branches exist". Both coexist.
- **Per-branch last-activity → opt-in**: branch head dates require one API call per branch; default inventory carries name/head SHA/protected/default-branch marker at zero extra call cost, with an opt-in flag for activity timestamps.
- **Releases ≠ tags**: the version inventory covers both — GitHub releases (rich metadata) and plain tags (name+SHA) — because a complete released-version picture needs both endpoints.
- **Repo/environment metadata → enrich existing payloads**: fields the importer already receives (repo object, environments response) are surfaced instead of discarded; only genuinely new calls (languages breakdown, per-branch activity) are opt-in.
- **Q: Where should the inventory live — `details` or `sourceDetails`? → A: canonical `details`** (user-confirmed): the branch/version inventory and repo metadata live in the repository component's `details` payload — visible on the component page today with zero backend/API changes. Per-source `sourceDetails` was rejected: it is not exposed by the component detail API and would add backend surface for no benefit (same-org configs share one Source identity anyway).

### Session 2026-11-12 — Amendment: branches as instances

User review of the implementation reversed the earlier "inventory, not instances" decision: per the DPAM pattern (component = asset, instances = its variations), **every repository branch emits a `ComponentInstance`** keyed `branch:{name}`. `environmentMapping` is demoted from classifier-and-selector to **classifier-only** — mapped branches keep their mapped environment, all others land in `OTHER` (the same fallback GitHub deployment environments already use at `github-repos.ts`). This amends spec-011 FR-007's selector semantics; mapped-branch instance payloads remain byte-identical, and `details.branches[]` stays as the richer repository-metadata surface (protected/isDefault/activity fields instances don't model). Per-branch commit lookups stay gated behind `includeBranchActivity` — with it off, branch instances fall back to the repo's `pushed_at` for `deployedAt`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every branch of an imported repository (Priority: P1)

An operator opens an imported GitHub repository component and sees every branch in the **instances table** — one `ComponentInstance` per branch, environment = mapping result or `OTHER`, with branch facts in `rawConfig` — and in the **branch inventory** on the details payload (name, head SHA, protected, isDefault, optional last-activity, GitHub link) — including `main`, `master`, `feature/*`, `dependabot/*`, and any other branches that today emit nothing.

**Why this priority**: This is the reported defect — the catalog currently claims a repository while showing none of its branches. Branches are the component's variations: per the DPAM pattern they belong in the instance model; the inventory retains the provider facts instances don't model.

**Independent Test**: run the importer against a repo with `main` plus several non-environment branch names; verify the instances table shows one instance per branch (`OTHER` for unmapped) and the details inventory lists every branch with correct default/protected flags.

**Acceptance Scenarios**:

1. **Given** a repo with branches `main`, `develop`, `feature/x`, `dependabot/npm`, **When** imported with defaults, **Then** the instances table shows four `branch:*` instances — `develop`→DEV via the built-in mapping, the rest→OTHER — and the inventory lists all four with head SHA, `protected` flag, `isDefault` on `main`, and GitHub URLs.
2. **Given** `environmentMapping` classifying `feature/x→STAGING`, **When** imported, **Then** that branch's instance reports STAGING while unmapped branches report OTHER — mapping classifies, never selects.
3. **Given** a repo with >100 branches, **When** imported, **Then** every branch emits an instance and appears in the inventory (both fully paginated), not just the first page.
4. **Given** branch inventory disabled but branch instances enabled, **When** imported, **Then** no `details.branches` is emitted yet every branch still appears as an instance; with branch instances disabled, no `branch:*` instances emit while the inventory still lists all branches.
5. **Given** the branches endpoint fails (permissions/rate limit), **When** the run completes, **Then** the run succeeds, repo components still emit, no `branch:*` instances are created, and the failure is visible via capability markers — never silent.
6. **Given** a branch deleted on GitHub, **When** the next run completes, **Then** its instance transitions to GONE via source-scoped reconciliation and it disappears from the inventory.

---

### User Story 2 - See the released-version inventory per repository (Priority: P2)

An operator sees, on the repository component, the repository's release history: each GitHub release (tag, title, publish date, prerelease/draft flags, target branch, asset summary) and plain git tags that have no release — so "which versions of this asset exist" is answerable from the catalog. The latest-release fallback that feeds environment-instance versions keeps working unchanged.

**Why this priority**: Releases/tags are the second-most valuable GitHub fact for asset management (what shipped, when, which artifacts) and were entirely absent — only `releases/latest` was consumed, and only as an instance-version fallback.

**Independent Test**: run against a repo with multiple releases, a prerelease, a draft (token permitting), and tags without releases; verify the inventory distinguishes them all and the env-instance version fallback still resolves.

**Acceptance Scenarios**:

1. **Given** a repo with releases `v1.0.0`, `v1.1.0-rc.1` (prerelease) and tag `nightly` (no release), **When** imported, **Then** the version inventory lists both releases with correct flags and the plain tag.
2. **Given** a repo with >100 releases, **When** imported, **Then** the inventory is fully paginated.
3. **Given** a token without push access, **When** imported, **Then** draft releases are absent (GitHub hides them) and the inventory notes published-only coverage rather than erroring.
4. **Given** version inventory disabled, **When** imported, **Then** the latest-release fallback for environment instances still works if `includeReleases` remains enabled.

---

### User Story 3 - See repository facts and environment governance on the component (Priority: P3)

An operator sees the repository's own metadata — default branch name, archived/disabled/fork status, fork provenance (parent/upstream repo), size, license, primary language plus optional language breakdown, creation/push timestamps — and, on each deployment-environment instance, the environment's protection rules, deployment branch policy, and admin-bypass flag when the token can read them.

**Why this priority**: These facts are already returned by API calls the importer makes today and are currently discarded; surfacing them is nearly free and rounds out "what is this asset" — but it is enrichment, not the reported defect.

**Independent Test**: import a forked repo and a repo with protected deployment environments; verify provenance/metadata fields and environment governance facts appear on the component and instance payloads.

**Acceptance Scenarios**:

1. **Given** a forked repo, **When** imported, **Then** its details identify the parent/upstream repository.
2. **Given** a repo with `archived: true`, **When** `includeArchived` is on, **Then** the component details mark it archived.
3. **Given** a repo with a deployment environment requiring reviewers, **When** imported with sufficient token scope, **Then** the environment instance's details carry the protection rules and branch policy.
4. **Given** a token lacking the permission for environment protection detail, **When** imported, **Then** the base environment instance still emits and the gap is marked via capability status.

---

### Edge Cases

- **Branch renamed on GitHub**: the old `branch:{old}` instance transitions to GONE via reconciliation while `branch:{new}` is discovered; the inventory simply reflects the new name (it is not identity-keyed).
- **Branch deleted**: its instance transitions to GONE via source-scoped reconciliation AND it disappears from the inventory on the next run.
- **Repo with zero branches** (empty repo): no branch instances and an empty inventory — valid, not an error.
- **Default branch renamed**: `isDefault` follows `default_branch` from the repo object, not a hardcoded `main`/`master` guess.
- **GHES instances**: inventory behaves identically; `externalId` qualification rules are unchanged (inventory lives in details, not keys).
- **Rate limits**: per-branch activity lookups are opt-in and bounded; all inventory reads degrade via capability markers without failing the run.
- **`repos` allowlist scoping**: inventory applies to allowlisted repos exactly as repo listing does.
- **Multiple importer configs on the same org**: inventory is per-source data on the shared component; last-writer-wins on details is acceptable (same underlying source).
- **Environments/packages >100 items**: existing single-page truncation is fixed as part of this feature's correctness work.
- **Branch instances vs inventory divergence**: every branch appears in both places by design — the instance answers "this branch exists as a variation of the component" while the inventory carries the richer provider facts (protected/isDefault/activity) instances don't model. Instance classification never reads the inventory.

## Requirements *(mandatory)*

### Functional Requirements

**Branch inventory (US1)**

- **FR-001**: For every imported repository, the component's `details` payload MUST carry a complete branch inventory — every branch reported by the provider, fully paginated — when branch inventory is enabled (default on).
- **FR-002**: Each inventoried branch MUST include at minimum: name, head commit SHA, head URL, protected flag, `isDefault` marker (derived from the repository's reported default branch — never a hardcoded name), and last-activity timestamp when the activity option is enabled.
- **FR-003**: Every provider-reported branch MUST emit a `ComponentInstance` (`externalId: branch:{name}`) when branch instances are enabled (default on); `environment` MUST be the built-in/`environmentMapping` classification result or `OTHER` — mapping classifies, never selects (amends spec-011 FR-007 selector semantics). Instance payload: `url` = branch tree URL, `status` = RUNNING, `version` = branch name, `deployedAt` = last-commit activity when `includeBranchActivity` is enabled else the repo's `pushed_at`, `rawConfig` = `{branch, sha, protected, isDefault, lastActivityAt?}` sourced from the shared branch list.
- **FR-004**: The configuration MUST allow disabling branch inventory independently of branch instances, and MUST allow disabling branch-instance emission entirely.
- **FR-005**: When per-branch activity is enabled, last-activity MUST come from the provider's commit data per branch; when disabled, inventory MUST still emit without activity timestamps at no extra per-branch API cost.
- **FR-006**: The repository component detail page MUST render the branch inventory (name, default/protected markers, SHA, activity, link) for GitHub repository components.

**Version inventory (US2)**

- **FR-007**: For every imported repository, the component's `details` payload MUST carry a version inventory of the provider's releases (tag, title, publish date, prerelease/draft flags, target ref, asset summary) and plain tags lacking releases — fully paginated — when enabled (default on).
- **FR-008**: The existing latest-release fallback for environment-instance `version`/`deployedAt` MUST keep working under its current `includeReleases` toggle, independent of the new inventory toggle.
- **FR-009**: The repository component detail page MUST render the version inventory distinguishing releases from plain tags and showing prerelease/draft markers.

**Metadata & governance (US3)**

- **FR-010**: Repository components MUST surface provider-reported metadata already fetched today: default branch name, archived/disabled/fork status, fork parent/upstream identity, size, license, primary language, creation and last-push timestamps — plus an opt-in per-language byte breakdown.
- **FR-011**: Deployment-environment instances MUST carry provider-reported governance facts when readable — protection rules, deployment branch policy, admin-bypass — without failing the instance when the permission is absent (capability-marked).
- **FR-012**: The repository component detail page MUST render repository metadata and the version/branch inventories for GitHub repository components.

**Importer correctness (cross-cutting)**

- **FR-013**: Every optional GitHub capability added or touched by this feature (branch inventory, version inventory, metadata enrichment, environments, deployments, branch instances) MUST record an explicit capability marker (`OK`/`FORBIDDEN`/`ERROR`/`UNAVAILABLE`) on the organization component and log a warning on degradation — no silent failures.
- **FR-014**: Paginated GitHub list endpoints used by the importer (environments, packages, and any new inventory endpoints) MUST fetch all pages — no silent 100-item truncation.
- **FR-015**: Read calls MUST tolerate provider rate-limit responses (429 and secondary-limit 403s) with bounded backoff honoring `Retry-After`/`X-RateLimit-Reset`, within the run's existing cancellation semantics.
- **FR-016**: Importer version metadata MUST be consistent between manifest and implementation.
- **FR-017**: User-facing importer documentation MUST describe the new inventory fields, every new config toggle with defaults, the mapping-as-classifier (`OTHER` fallback) semantics for branch instances, and required token scopes — regenerated via the docs pipeline, not hand-edited generated regions.
- **FR-018**: All new behavior MUST be covered by importer unit tests (including `validateDiscoveredAsset` harness usage), backend/frontend tests where applicable, and Playwright coverage of the component-detail surface per project testing rules.

### Key Entities *(include if feature involves data)*

- **Component** (`REPOSITORY`, `github:repository`): `details` gains `branches[]`, `releases[]`, `tags[]`, and repo metadata facts — all overwritten each run, no new entity or table.
- **ComponentInstance** (environment + branch instances): environment instances gain governance facts in `rawConfig.githubEnvironment`; every branch emits a `branch:{name}` instance whose `rawConfig` carries `{branch, sha, protected, isDefault, lastActivityAt?}`.
- **ImporterConfig**: gains inventory/activity toggles alongside existing `include*` flags and `environmentMapping`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of branches on an imported repository are visible — as instances AND in the inventory — verified against live repos where today 0 of 7 and 0 of 5 branches appear.
- **SC-002**: Operators can answer "which branches/versions exist for this repo" from the component page without leaving Componode or calling the GitHub API.
- **SC-003**: Zero silent capability failures — 100% of degraded GitHub sections surface a status marker.
- **SC-004**: Default configuration adds at most ~2 API calls per repository for inventory (list branches + list releases + list tags amortized); per-branch activity stays opt-in.
- **SC-005**: Existing behavior is preserved where it matters — mapped branch instances keep identical `externalId`/`environment`/payload, environment instances, billing/workflows/runners/packages unchanged unless toggled; the only deliberate change is unmapped branches now emitting `OTHER` instances (spec-011 selector semantics amended).

## Assumptions

- Branch inventory default-on is safe: the list-branches call is already made today for instance classification, so the marginal cost is zero calls — only payload size grows.
- Per-branch last-activity is opt-in (`includeBranchActivity`-style flag, default off) because it costs one call per branch per run.
- Language byte-breakdown is opt-in (one extra call per repo).
- Draft releases are only visible to tokens with push access — the inventory reflects what the token can see and says so.
- GitHub App authentication, branch-protection rule *detail* (Administration scope), deployment history beyond latest-per-env, and GraphQL migration are out of scope.
- Security-scanning endpoints remain excluded per spec 011 FR-019.
- Organization-component details rendering and non-GitHub importers are out of scope.
