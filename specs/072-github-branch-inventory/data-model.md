# Data Model: GitHub importer branch, release & metadata inventory

**Feature**: `072-github-branch-inventory` | **Date**: 2026-11-12

No database schema changes. All new data rides existing free-form payloads:

- `components.details` (jsonb) — wholesale-replaced on every component upsert (`import-run-service.ts:403,440`); already returned by `GET /components/{id}`.
- `component_instances.rawConfig` (jsonb) — per-instance importer facts; already returned in instance payloads.

Shapes below are the importer→core contract. Full field-level contract: [contracts/github-inventory.md](./contracts/github-inventory.md).

## `github:repository` component — `details` additions

Existing keys (`language`, `topics`, `visibility`, `htmlUrl`, `billing?`) unchanged. New keys, each gated by its config toggle:

| Key | Type | Toggle | Source endpoint | Notes |
|---|---|---|---|---|
| `defaultBranch` | `string` | — (always) | repo object (already fetched) | replaces dead field usage |
| `archived` | `boolean` | — | repo object | |
| `disabled` | `boolean` | — | repo object | |
| `fork` | `boolean` | — | repo object | |
| `forkParent` | `{fullName, htmlUrl} \| null` | — | repo object `parent` | provenance |
| `forkSource` | `{fullName, htmlUrl} \| null` | — | repo object `source` | ultimate upstream |
| `sizeKb` | `number` | — | repo object `size` | KB per GitHub docs |
| `license` | `{key, name, spdxId} \| null` | — | repo object `license` | |
| `openIssuesCount` | `number` | — | repo object | issues+PRs combined (GitHub semantics) |
| `createdAt` / `pushedAt` / `updatedAt` | `ISO string` | — | repo object | |
| `branches` | `BranchInventoryEntry[]` | `includeBranchInventory` | `GET /branches` (paginated, already called) | see below |
| `releases` | `ReleaseInventoryEntry[]` | `includeReleaseInventory` | `GET /releases` (paginated) | |
| `tags` | `TagInventoryEntry[]` | `includeReleaseInventory` | `GET /tags` (paginated) | tags ≠ releases |
| `languages` | `Record<string, number>` | `includeLanguageBreakdown` | `GET /languages` | bytes per language |
| `capabilities` | `Record<string, CapabilityMarker>` | — | derived | per-repo degradation markers |

### `BranchInventoryEntry`

| Field | Type | Source |
|---|---|---|
| `name` | string | branch `name` |
| `sha` | string | `commit.sha` (list response) |
| `url` | string | `{html_url}/tree/{name}` (consistent with instance URL) |
| `protected` | boolean | list response `protected` (covers classic protection + rulesets) |
| `isDefault` | boolean | `name === repo.default_branch` |
| `lastActivityAt` | ISO string \| absent | `commit.committer.date` via `getBranch` — only when `includeBranchActivity` |

### `ReleaseInventoryEntry`

| Field | Type | Source |
|---|---|---|
| `id` | number | release `id` |
| `tagName` | string | `tag_name` |
| `name` | string \| null | `name` |
| `publishedAt` | ISO string \| null | `published_at` |
| `prerelease` | boolean | `prerelease` |
| `draft` | boolean | `draft` (only visible with push access) |
| `targetCommitish` | string \| null | `target_commitish` |
| `assetCount` | number | `assets.length` |
| `assetsTotalBytes` | number | sum of asset `size` |
| `htmlUrl` | string | `html_url` |

### `TagInventoryEntry`

| Field | Type | Source |
|---|---|---|
| `name` | string | tag `name` |
| `sha` | string | `commit.sha` |
| `htmlUrl` | string | `{html_url}/releases/tag/{name}` |

## Environment-instance `rawConfig` addition

Existing keys (`environment`, `deploymentId`, `deploymentState`) unchanged. New namespaced block, emitted when `GET /environments` returns it (zero extra calls):

```jsonc
"githubEnvironment": {
  "protectionRules": [
    { "type": "wait_timer", "waitTimerMinutes": 30 },
    { "type": "required_reviewers", "preventSelfReview": true, "reviewerCount": 2 }
    // branch_policy rules carry {"type":"branch_policy","protectedBranches":bool,"customBranchPolicies":bool}
  ],
  "deploymentBranchPolicy": { "protectedBranches": true, "customBranchPolicies": false } | null,
  "canAdminsBypass": true
}
```

Rule entries are normalized to camelCase allowlisted fields per `type` (`wait_timer`→`waitTimerMinutes`; `required_reviewers`→`preventSelfReview`,`reviewerCount`; `branch_policy`→policy flags). Unknown rule types contribute `{type}` only — no raw passthrough (ADR-121 allowlist spirit).

## `github:organization` component — `details.capabilities` additions

Repo-scoped capability families roll up worst-status-wins onto the org asset (org yield moves after the repo loop): `branches`, `branchInstances`, `branchActivity`, `versionInventory`, `languages`, `environments`, `deployments`. Org-scoped families (`billing`, `runners`, `packages`, `teams`) unchanged.

## Validation rules

- All inventory entries are plain JSON — no class instances; `undefined` fields omitted (not `null`) except where noted.
- `branches`/`releases`/`tags` emit `[]` (not absent) when the source legitimately returns empty — distinguishes "no data" from "feature off" for the UI. When the toggle is off the key is absent entirely.
- `isDefault` is computed, never assumed — repos whose `default_branch` is null emit `isDefault: false` everywhere.
- Timestamps are ISO-8601 strings or absent; never epoch numbers.
