# Research: GitHub importer branch, release & metadata inventory

**Feature**: `072-github-branch-inventory` | **Date**: 2026-11-12
**Basis**: `researches/github-importer-branches-research.md` (API-verified), live audit of `packages/importer-github`, spec `011-github-importer-expansion`.

This file records the design decisions for plan/tasks. The upstream research doc holds the full GitHub API evidence; this file holds only what the implementation needs.

## D1 — Inventory lives in `details`, not instances (user-confirmed in clarify)

- **Decision**: branch/version inventory and repo metadata go into `components.details` (free-form jsonb) on the `github:repository` asset. Per-source `sourceDetails` rejected — it lands on `source_component_memberships.details`, which no component-detail API path exposes today; using it would require backend serialization work for zero benefit (same-org configs share one Source identity → last-writer-wins is benign).
- **Rationale**: `details` is already returned by `getComponentById` (`component-catalog-service.ts:270`) and rendered-capable via the existing resourceType-keyed section pattern; `details` is wholesale-replaced every upsert (`import-run-service.ts:403,440`) so deleted branches/tags disappear with no reconciliation logic.
- **Alternatives considered**: branch-as-`ComponentInstance` (rejected — closed `environment` enum, false `status`/`deployedAt` semantics, contradicts spec-011); per-branch components (rejected — orphan catalog entries, no v1 relationships); `sourceDetails` (rejected — not API-visible).

## D2 — Config surface (all Zod booleans, schema-driven form renders them automatically per ADR-042/spec-037)

| Field | Type | Default | Governs |
|---|---|---|---|
| `includeBranchInventory` | bool | `true` | `details.branches[]` — full branch inventory (FR-001/002) |
| `includeBranchActivity` | bool | `false` | per-branch last-commit timestamps — 1 extra call/branch (FR-005) |
| `includeBranchInstances` | bool | `true` | spec-011 mapped branch instances — finally disableable; fixes the unconditional block (FR-004) |
| `includeReleaseInventory` | bool | `true` | `details.releases[]` + `details.tags[]` (FR-007) |
| `includeLanguageBreakdown` | bool | `false` | `details.languages` byte map — 1 extra call/repo (FR-010) |

- **Rationale**: flat `include*` naming matches existing toggles; defaults preserve spec-011 behavior (instances on, inventory is additive); activity/languages opt-in because they cost per-branch/per-repo calls (SC-004).
- **Alternatives considered**: single `branches` mode enum (rejected — booleans compose better with the existing `include*` family and the schema-driven form); merging inventory+instances under one toggle (rejected — FR-004 requires independent control).

## D3 — `details` payload shapes (contract: `contracts/github-inventory.md`)

Repo `details` gains (all keys emitted every run when their toggle is on; absent when off — wholesale `details` replace clears stale data automatically):

- Scalars (from the already-fetched repo object — zero extra calls): `defaultBranch`, `archived`, `disabled`, `fork`, `forkParent` (`{fullName, htmlUrl} | null`), `forkSource` (`{fullName, htmlUrl} | null`), `sizeKb`, `license` (`{key, name, spdxId} | null`), `openIssuesCount`, `createdAt`, `pushedAt`, `updatedAt`.
- `branches[]`: `{name, sha, url, protected, isDefault, lastActivityAt?}` — from `listBranches` (already called) + optional `getBranch` per branch when `includeBranchActivity`.
- `releases[]`: `{id, tagName, name, publishedAt, prerelease, draft, targetCommitish, assetCount, assetsTotalBytes, htmlUrl}` — paginated `GET /releases`.
- `tags[]`: `{name, sha, htmlUrl}` — paginated `GET /tags` (tags ≠ releases; plain tags have no release record).
- `languages`: `{[lang]: bytes}` — only when `includeLanguageBreakdown`.
- `capabilities`: per-repo capability markers (see D5).

Env-instance `rawConfig` gains `githubEnvironment`: `{protectionRules: [{type, …camelCased fields}], deploymentBranchPolicy: {protectedBranches, customBranchPolicies} | null, canAdminsBypass}` — read from the already-fetched `GET /environments` response (zero extra calls; `Actions:read` permission family).

## D4 — Fetch strategy & API cost

- `listBranches` already runs for instance classification → inventory reuses the same paginated response (names + `commit.sha` + `protected` + `commit.url` are all in the list payload — **no extra calls** for the base inventory).
- `isDefault` = `branch.name === repo.default_branch` — `default_branch` is already fetched and currently a dead field (`importer.ts:26`, `github-repos.ts:14`).
- `lastActivityAt` via existing `getBranch` per branch — **deduplicated**: when `includeBranchInstances`/`includeBranchActivity` both need a branch's detail, fetch once and share (the mapped-instance path already calls `getBranch` for committer date).
- `GET /releases` + `GET /tags`: 2 paginated calls/repo, `per_page:100`.
- `GET /languages`: 1 call/repo, opt-in.
- Releases list ≠ tags list — both required for a complete version inventory (docs.github.com/en/rest/releases/releases, /rest/repos/repos#list-repository-tags).
- `per_page` silently clamps at 100 — always set explicitly; all new endpoints use `paginate.iterator`.

## D5 — Capability markers: dual surface (FR-013 interpretation)

- **Per-repo**: `details.capabilities` on each `github:repository` component records repo-scoped families — `branches`, `branchInstances`, `branchActivity`, `versionInventory`, `languages`, `environments`, `deployments` — via the existing `withCapability()` result → `CapabilityMarker` mapping. Precise "which repo lost what".
- **Org aggregate**: the org asset's `details.capabilities` (spec-011 surface) gains the same repo-scoped keys with **worst-status-wins** semantics (`FORBIDDEN`/`ERROR`/`UNAVAILABLE` beats `OK`; message notes affected-repo count). Org-scoped families (billing/runners/packages/teams) unchanged.
- **Mechanism**: `fetchOrganizationAsset` runs early (org profile needed regardless) but its `yield` moves **after the repo loop**; the shared `capabilities` object is mutated during the loop and serialized at yield time. Runner/package assets keep yielding early — order among distinct assets is irrelevant to upsert correctness. On run abort the org asset may not yield — acceptable (aborted runs are partial by definition; next run reconciles).
- Branch/env/deployment fetch failures inside `buildRepoInstances` currently vanish silently — this feature routes them through `withCapability` + markers + `warnIfDegraded` (FR-013).

## D6 — Pagination & rate-limit correctness (FR-014/015/016)

- `getAllEnvironments` (`github-repos.ts:106`) and `listPackagesForOrganization` (`github-extras.ts:114`) fetch a single page — switch both to `paginate.iterator`.
- `octokit@4.1.4` **already bundles** `@octokit/plugin-retry` + `@octokit/plugin-throttling` with defaults that retry once on rate-limit responses honoring `retry-after` (`node_modules/octokit/dist-src/octokit.js`). FR-015 = bound and document: configure `retry.retries` (transient errors) and `throttle.onRateLimit`/`onSecondaryRateLimit` (allow up to N retries via `options.request.retryCount`, default 3) in `buildOctokit`; per-request `signal` already propagates aborts.
- Manifest `version: "1.0.0"` vs importer `"1.1.0"` drift → both `"1.2.0"` (FR-016).

## D7 — Frontend rendering

- New `ux/components/catalog/github-details.tsx` mirroring `docker-details.tsx`: allowlisted shapers only (no generic dump — ADR-121 precedent), `GithubDetailsSection({details})` rendered in `component-detail.tsx` when `resourceType === "github:repository"`. Sections: repo facts (DescriptionList), branches table (name/default/protected badges, SHA, activity, GitHub link), releases+tags tables (tag, date, prerelease/draft badges, assets summary).
- Instance expander: add `githubEnvironmentOf(i)` shaper reading `rawConfig.githubEnvironment` + a "GitHub environment" section in `InstanceDetails`/`hasInstanceDetails` (generic — keyed on rawConfig shape, not provider).
- Existing `details` fields (`language`, `topics`, `visibility`, `htmlUrl`, `billing`, `capabilities`) finally get rendered — the section surfaces them too where cheap (capabilities as status badges).

## D8 — Docs, tests, non-goals

- `docs/importers/github.md`: hand-written sections updated (inventory description, selector semantics for branch instances, new toggles, token scopes per permission family: Contents/Metadata read baseline, Actions read for env detail, Deployments read); `<!-- GENERATED:contract -->` region regenerates via `docs:importers` after `config.ts` changes.
- Tests: importer unit tests extend `test/importer.test.ts` + `fetch-mock.ts` (new endpoints, pagination, toggles, degradation); mock gains `/releases`, `/tags`, `/languages`, multi-branch repos, env `protection_rules`; Playwright journey asserts inventory on the component page; frontend unit tests for the new section.
- **No ADR amendment required**: `DiscoveredAsset` contract, instance model, and source-identity semantics are untouched; `details`/`rawConfig` are already free-form. Spec-011 semantics preserved by default-on `includeBranchInstances`.
- **No openapi.yaml/api.md change**: no endpoint or schema change — `details`/`rawConfig` already flow.
- **Out of scope** (spec Assumptions): GitHub App auth, protection-rule *detail* endpoint (Administration scope), deployment history, GraphQL, org-component details rendering, security scanning, non-GitHub importers.
