# GitHub Importer — Branch Coverage & Inventory Research

**Status:** Unnumbered research and planning input. This is not a feature spec, an ADR, or executable implementation tasks. Feature numbering is intentionally undecided.

**Trigger:** Operator report — the GitHub importer "is not bringing or presenting all the branches" from repositories. Verified against `Componode/componode` (7 branches) and `Componode/v0-componode-dpam` (5 branches): both catalog components show **zero** branch instances.

## Executive summary

- The importer **does fetch every branch** — `GET /repos/{o}/{r}/branches` is fully paginated (`packages/importer-github/src/github-repos.ts:161-172`). The loss happens one step later: each branch name is passed through `resolveEnvironment()`, and only names present in the environment mapping survive (`github-repos.ts:178-179`). `main`, `master`, `trunk`, `feature/*`, `dependabot/*`, `v0/*` all resolve to `null` and are **silently discarded**.
- This filtering is **ratified spec behavior**, not an implementation bug: spec `011-github-importer-expansion` declares the name→environment mapping to be "both classifier and selector" for branches, and `main`/`master` are never implicitly `PRODUCTION` (spec.md clarifications, FR-007/FR-008, edge cases).
- The `environmentMapping` config is the **only** branch selector today, and the user-facing doc (`docs/importers/github.md`) does not explain that it also gates branches — a documentation gap.
- **No core/backend contract change is required** to represent full branch data: `DiscoveredAsset.details`/`sourceDetails` are free-form JSONB, and `DiscoveredAsset` already permits N assets per repo. The cheapest correct fix is a branch *inventory* in component details; modeling branches as `ComponentInstance`s is semantically wrong (a branch is not an environment — ADR-014) and floods the `OTHER` bucket.
- The GitHub API offers substantially more DPAM-valuable data than is currently consumed: full release/tag inventory, branch `protected` flags (free in the list response), fork provenance (`parent`/`source`), repo activity stats, and environment protection policies — all behind per-capability permissions that map cleanly onto the existing `withCapability()` degradation pattern.

## 1. Verified symptom

Live branch lists (GitHub API, 2026-11-12):

| Repository | Branches | Survive the environment filter |
|---|---|---|
| `Componode/componode` | `main`, 6× `dependabot/*` | **0** |
| `Componode/v0-componode-dpam` | `main`, `v0/product-map-canvas-spec`, `v0/web-api-importer-journey`, 2× `dependabot/*` | **0** |

`resolveEnvironment()` (`packages/importer-github/src/mapping.ts:16-22`) recognizes only `prod|production|live|staging|stage|dev|develop|test|qa|demo` plus user `environmentMapping` overrides. None of the branches above match, so each repo emits `instances: []` (or only `env:*` instances if GitHub deployment environments exist — these repos have none configured).

## 2. Root cause — code walkthrough

`buildRepoInstances()` (`packages/importer-github/src/github-repos.ts:94-202`) runs two independent blocks per repo:

**A. Deployment environments** — gated by `includeEnvironments` (default `true`, `config.ts:32`):

- `GET /repos/{o}/{r}/environments` (single page, `per_page:100` — `github-repos.ts:105-107`; **>100 environments silently truncated**, no pagination iterator).
- Per environment: latest deployment + latest status (2 calls each, `github-repos.ts:47-80`) → instance `env:{name}` with real `status`/`version`/`deployedAt` (`github-repos.ts:144-156`).

**B. Branches** — runs **unconditionally**; not gated by `includeEnvironments` or any branch flag:

1. `listBranches` paginated to completion, collecting **names only** (`github-repos.ts:161-172`). All pages fetched — enumeration is complete.
2. `resolveEnvironment(branch, config.environmentMapping)` → `null` ⇒ `continue` (`github-repos.ts:178-179`). **This is the drop point.**
3. Survivors only: `GET /branches/{branch}` per branch for the committer date (`github-repos.ts:181-187`).
4. Instance emitted (`github-repos.ts:189-197`): `environment` = mapped value, `externalId: "branch:{name}"`, `status: "RUNNING"` (hardcoded), `version` = branch name, `deployedAt` = last commit date `?? repo.pushed_at`, `url` = `/tree/{branch}`.

Other observations from the same file:

- `default_branch` is fetched on every repo (`importer.ts:26`, `github-repos.ts:14`) but **read nowhere** — a dead field that would identify the primary branch for free.
- Releases: only `GET /releases/latest` (`github-repos.ts:88-91`), used solely as version/`deployedAt` fallback for environment instances (`github-repos.ts:138-142`). No tag or release inventory exists.
- Branch/env fetch failures are **silent** — `withCapability` results are never checked or recorded for these calls (unlike runners/packages/billing, which write `capabilities.*` markers, `importer.ts:194-231`).

### Presentation layer

- The component detail page renders an **Instances** table — Environment badge | Status | Version | Region | External ID | Last seen (`packages/frontend/src/ux/components/catalog/component-detail.tsx:100-177`). A branch instance would appear with `version` = branch name and `externalId` = `branch:{name}`, but its "environment" column can only show one of the six enum badges.
- Component `details` are stored but **rendered nowhere for GitHub**: the Details card only has resource-type-keyed sections for `docker-engine`/`image`/`network`/`volume` (`component-detail.tsx:207-218`, `docker-details.tsx`). `language`, `topics`, `visibility`, `htmlUrl`, `billing`, `capabilities`, `teams` are all invisible in the UI today. Instance `rawConfig` is likewise fetched but only Docker keys render (`docker-details.tsx:352-399`).

## 3. Design intent — this was deliberate

Spec `011-github-importer-expansion` (Shipped) ratified the current semantics:

- Clarification: "One instance per branch whose name appears in the environment mapping — the mapping is both classifier and selector for branches."
- FR-007: "one branch instance per repository branch whose name matches an entry in the environment mapping… Branch names with no mapping entry emit no instance; no branch name is automatically PRODUCTION."
- FR-008/FR-009: the same map governs GitHub deployment-environment names (always emit, unmatched→`OTHER`) and branch names (selector); branch instances carry `version` = branch name, `deployedAt` = last activity.
- Edge case: "Branch names with no mapping entry: emit no instance."

So the reported gap is a **scope/design limitation**, not a defect. Any change to branch semantics revisits a ratified spec decision and therefore needs the spec-kit workflow (specify → plan → tasks → implement) plus, where the domain model is touched, an ADR.

## 4. What the contract allows today

`packages/core/src/contracts/discovered-asset.ts`:

- `DiscoveredAssetInstance.environment` is a **required closed enum** (`DEV|TEST|STAGING|DEMO|PRODUCTION|OTHER` — `constants/environments.ts:1-8`; enforced by `component_instances_environment_check`, `001_initial_schema.ts:362-365`). Any branch-as-instance must wear one of these badges.
- Instance upsert key is `(componentId, externalId)` — unique constraint `component_instances_component_external_idx` (`001_initial_schema.ts:370-373`; ADR-034). Per-branch instances *can* coexist; nothing blocks `branch:main` + `branch:develop` on one repo.
- `DiscoveredAsset.details`/`sourceDetails` are `Record<string, unknown>` — free-form JSONB, no schema. A full branch inventory can ride here with **zero contract change**.
- `DiscoveredAsset` has no parent/child or `relationships[]` (explicitly removed — ADR-057, contract comment at `discovered-asset.ts:31-33`). The backend upserts each yielded asset independently on `(category, provider, externalId)` (`import-run-service.ts:261-267`), so an importer *may* yield per-branch assets — but they'd be orphan catalog components with no linkage to the repo component.
- Source-scoped reconciliation (`ADR-119`/ADR-120): memberships deactivated when unreported → branch inventory inside `details` simply overwrites each run; a deleted branch disappears cleanly. A deleted branch *component* would retire — also clean, but noisier.

### Option analysis

| Option | Mechanism | Contract change | Semantic fit | Cost |
|---|---|---|---|---|
| **A. Branch inventory in `details`/`sourceDetails`** | Emit `{name, sha, protected, isDefault, lastActivity?}[]` on the repo asset | None | Correct — inventory is metadata, not an environment | Low: list response already carries name/sha/protected; `default_branch` already fetched; dates need optional per-branch calls |
| **B. All branches as instances (`OTHER`)** | `resolveEnvironment(...) ?? "OTHER"` | None | Poor — floods `OTHER`, contradicts spec 011, `status:RUNNING`/`deployedAt:lastCommit` are false claims about deployments | Trivial code, high semantic debt |
| **C. Per-branch `github:branch` components** | Yield N assets per repo | None (contract allows it) | Weak — orphan components, no repo↔branch linkage in v1, catalog noise | Medium; needs slug/externalId design + frontend grouping to be usable |
| **D. First-class ref model** | New instance kind / relaxed environment / new entity | Core contract + DB CHECK + ADR + all importers | Best long-term if branches are truly first-class assets | High — constitution-level change |

**Recommendation:** Option A now (inventory as source facts), revisit Option D only if operators ask for branch-level lifecycle/health semantics. Option B should be rejected — it re-litigates spec 011 for a worse model.

## 5. GitHub API — what else is available for DPAM scope

All claims verified against docs.github.com (2026-11-12). Permission column = fine-grained PAT/App grant.

| Endpoint | Returns | Permission | DPAM value | Notes |
|---|---|---|---|---|
| `GET /repos/{o}/{r}/branches` | `name`, `commit.sha`, `protected` — **all pages** | Contents:read | Branch inventory | `protected` is **free** (covers classic protection *and* rulesets); no dates — needs `getBranch`/`commits?sha=` per branch for last-activity |
| `GET /repos/{o}/{r}` | `default_branch`, `archived`, `disabled`, `fork`, `parent`/`source`, `size`, `open_issues_count`, `license`, `pushed_at`, `created_at` | Metadata:read | Repo metadata | Already called — most fields fetched but never surfaced into `details`. `parent`/`source` gives fork provenance |
| `GET /repos/{o}/{r}/tags` | `name`, `commit.sha`, archive URLs | Metadata:read | Version inventory | Tags ≠ releases — need both for completeness |
| `GET /repos/{o}/{r}/releases` | `tag_name`, `target_commitish`, `draft`, `prerelease`, `published_at`, `assets[]` (name, size, download_count, URL) | Contents:read | **Release inventory — highest-value gap** | Full list paginated; drafts only visible with push access; importer uses only `/releases/latest` today |
| `GET /repos/{o}/{r}/commits?sha={ref}&per_page=1` | Latest commit per branch (date, sha, author) | Contents:read | Branch last-activity | Alternative to `getBranch` fan-out; same 1-call-per-branch cost |
| `GET /repos/{o}/{r}/compare/{base}...{head}` | `ahead_by`, `behind_by`, `status`, file stats | Contents:read | Branch divergence vs default | 250-commit cap per response; N calls if per-branch |
| `GET /repos/{o}/{r}/branches/{b}/protection` | Required checks, reviews, restrictions, allow-force-push | **Administration:read** | Branch governance | 403 vs 404 semantics matter (403 = can't see, 404 = unprotected); cheaper ruleset-aware fallback: `/rules/branches/{b}` |
| `GET /repos/{o}/{r}/environments` | `protection_rules`, `deployment_branch_policy`, `can_admins_bypass` | **Actions:read** | Environment governance | Importer already calls this endpoint but reads only `name` — protection metadata is free in the same response |
| `GET /repos/{o}/{r}/deployments` + `/statuses` | Full deployment history, `ref`, `task`, `transient`/`production_environment` flags, `log_url` | **Deployments:read** | Deployment inventory | Statuses >90 days auto-deleted; importer reads only latest-per-env today |
| `GET /repos/{o}/{r}/languages` | `{lang: bytes}` | Metadata:read | Composition detail | One cheap call; `language` (primary) already captured |
| `GET /repos/{o}/{r}/stats/*` | Weekly commit/code-frequency/participation/contributors | Contents:read | Activity/velocity signals | 202-then-200 caching; `code_frequency` 422 ≥10k commits; cache resets on default-branch pushes |

Sources: [branches](https://docs.github.com/en/rest/branches/branches), [git refs](https://docs.github.com/en/rest/git/refs), [repos](https://docs.github.com/en/rest/repos/repos), [tags](https://docs.github.com/en/rest/repos/repos#list-repository-tags), [releases](https://docs.github.com/en/rest/releases/releases), [commits/compare](https://docs.github.com/en/rest/commits/commits), [branch protection](https://docs.github.com/en/rest/branches/branch-protection), [environments](https://docs.github.com/en/rest/deployments/environments), [deployments](https://docs.github.com/en/rest/deployments/deployments), [deployment statuses](https://docs.github.com/en/rest/deployments/statuses), [languages](https://docs.github.com/en/rest/repos/repos#list-repository-languages), [statistics](https://docs.github.com/en/rest/metrics/statistics), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api), [fine-grained permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens), [GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

### Rate-limit & design constraints

- PAT: 5,000 req/hr; per-repo fan-out is the driver — releases+tags (2 calls), environments (already 1), deployments/statuses (2/env), branches list (⌈B/100⌉), optional per-branch detail (B calls). Spec 011 SC-004 targets ~1,000 repos/hr; per-branch detail calls are the expensive part — gate them.
- Secondary limits: ≤100 concurrent, ≤900 pts/min/endpoint → favor sequential/modest concurrency; **no retry/backoff exists today** for unwrapped calls (plain `Octokit`, `client.ts:8-16`) — large orgs can fail mid-run.
- Each permission family degrades independently → express as new `capabilities.*` markers via the existing `withCapability()` pattern.
- GraphQL could collapse repo+branches+releases+deployments+environments into few queries, but budgeting is points-based and less predictable; REST matches the per-endpoint capability model. **Stay REST.**
- Quirks to encode: `per_page` clamps at 100; `getBranch` can 301 on renamed branches; releases list excludes plain tags; deployment statuses expire at 90 days; compare caps at 250 commits; recommended branch ceiling ~5,000/repo.

## 6. Secondary defects found during the audit

1. **Branch block ignores `includeEnvironments`** — `github-repos.ts:104` closes at :159; branches run unconditionally (:161-199). With no `includeBranches` flag, there's no way to disable branch work at all.
2. **Silent capability failures** — branch/environment fetch errors aren't recorded in `capabilities` or logged (contrast runners/packages/billing).
3. **Single-page truncation** — `getAllEnvironments` (`github-repos.ts:106`) and `listPackagesForOrganization` (`github-extras.ts:114`) cap at 100 items.
4. **No retry/backoff** on 403/429 for unwrapped calls; rate limit only logged at start/end (spec FR-017).
5. **Manifest drift** — `manifest.ts:8` says `version: "1.0.0"`, `GithubImporter.version` is `"1.1.0"` (`importer.ts:101`).
6. **Doc gap** — `docs/importers/github.md:15-17` says "instances for branches" without stating the mapping-is-selector semantics; `environmentMapping` row (:67) describes only environment names.
7. **Dead fields** — `default_branch`, `updated_at` fetched but unused.

## 7. Proposal — recommended spec scope

A spec-kit feature (working title: *GitHub importer branch & release inventory*) covering, in priority order:

1. **Branch inventory in `sourceDetails`/`details`** (Option A): per repo, emit `{name, sha, protected, isDefault, headUrl, lastActivityAt?}[]`. `isDefault` from the already-fetched `default_branch`; `protected` free from the list response; `lastActivityAt` optional behind a sub-flag (per-branch `commits?sha=&per_page=1` — same cost class as today's `getBranch`, which can then be retired for mapped branches or kept). Honor `includeForks`/`includeArchived` scoping; GHES `qualifyGhes` unaffected (details aren't keyed).
2. **Release & tag inventory**: paginated `GET /releases` + `GET /tags` into details (`tagName`, `publishedAt`, `prerelease`, `draft`, `targetCommitish`, asset count/size); keep `releases/latest` behavior for env-instance version fallback. New `includeReleases` semantics need care — today it gates only the latest-release fallback.
3. **Repo metadata enrichment** (free — same `repos.get` payload): `defaultBranch`, `archived`, `disabled`, `fork`/`parent`/`source` provenance, `sizeKb`, `openIssuesCount`, `license`, `pushedAt`, `createdAt`; optionally `languages` byte-map behind a flag.
4. **Environment governance metadata** (free — same `environments` response): `protectionRules`, `deploymentBranchPolicy`, `canAdminsBypass` into instance `rawConfig`/`sourceDetails`.
5. **Config surface**: `includeBranches`/`branchInventory` toggle (default on for inventory — it's cheap), optional `includeBranchActivity` (per-branch calls), `includeTags`, `includeReleaseAssets`? — decide in spec; keep `environmentMapping` semantics for *instances* unchanged (spec 011 stays valid for env-classified branch instances).
6. **Frontend**: a `GithubDetailsSection` (mirroring `docker-details.tsx` pattern) rendering repo facts, a branches table (name, default badge, protected badge, last activity, link), and a releases table — plus surfacing `rawConfig.branch` in `InstanceDetails` if branch instances remain.
7. **Defect fixes folded in**: gate/fix the unconditional branch block, capability markers for branch/env/deployment fetches, paginate environments + packages, manifest version sync, retry/backoff policy decision, docs regeneration (`docs:importers`) + explicit mapping-is-selector documentation.
8. **Testing**: importer unit tests for inventory shape/filtering/pagination; Playwright coverage per project rules; `docs/openapi.yaml` untouched unless API surface changes (details are already free-form — likely no endpoint change).

**Explicitly out of scope** (per spec 011 FR-019 and constitution): security scanning (Dependabot/code/secret scanning), per-branch *components* (Option C), contract-level ref modeling (Option D) — candidates for a later ADR if demanded.

## 8. Open questions for the spec session

- Should branch inventory live in `details` (canonical, last-writer-wins across Sources) or `sourceDetails` (per-Source membership facts, ADR-120)? For a single-Source-per-org model both work; `sourceDetails` is the ADR-120-blessed place for source-specific facts.
- Instance semantics: keep spec-011 mapped-branch instances *and* add inventory, or replace branch instances with inventory-only? (Recommendation: keep both — instances remain the "environment-classified" view; inventory is the complete list. They serve different questions.)
- Per-branch last-activity: worth the API cost? `pushed_at` on the repo is a cheap proxy for "repo is alive" but not per-branch.
- Should `environmentMapping` gain wildcard/prefix patterns (e.g. `release/*→STAGING`)? Useful but orthogonal — spec decision.
