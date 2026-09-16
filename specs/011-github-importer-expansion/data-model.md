# Data Model: GitHub Importer Expansion

**Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

No new tables. One new `ComponentCategory` value; all new data flows through
existing `Component.details` / `ComponentInstance.rawConfig` JSONB columns and
the existing dedup key `(category, provider, externalId)`.

## Schema changes

### `components.category` CHECK constraint

- Add `ACCOUNT` to `COMPONENT_CATEGORIES` in `packages/core` +
  `COMPONENT_CATEGORY_META` entry
  (`label: "Account"`, description: provider-level billing/administrative
  container that owns assets).
- Migration `010_account_category`: drop `components_category_check`,
  recreate with the extended list via `checkConstraint("category",
  COMPONENT_CATEGORIES)`. Down-migration restores the prior list (fails safely
  if `ACCOUNT` rows exist — acceptable; document).

## Emitted assets (provider `GITHUB` for all)

### `github:organization` → `ACCOUNT`

| Field | Value |
|---|---|
| `externalId` | `String(org.id)` — rename-stable |
| `name` | `org.name ?? org.login` |
| `slug` | `org.login` |
| `instances` | `[]` — account objects have no environment deployment |

`details`:

```jsonc
{
  "profile": { "login", "htmlUrl", "description", "createdAt" },
  "plan": { "name", "seats", "filledSeats", "privateRepos" },
  "policies": { "twoFactorRequired", "defaultRepoPermission",
                "membersCanCreateRepos", "membersCanCreateTeams" },
  "usage": { "publicRepos", "totalPrivateRepos", "diskUsage", "collaborators" },
  "teams": [ { "slug", "name", "memberCount", "reposCount", "privacy",
               "parentSlug" } ],
  "billing": {
    "status": "OK | FORBIDDEN | ERROR | UNAVAILABLE",
    "period": { "year": 2026, "month": 9 },
    "totals": { "grossAmount", "discountAmount", "netAmount" },
    "byProduct": [ { "product", "netAmount", "quantity", "unitType" } ],
    "topRepos": [ { "repository", "netAmount" } ],          // ≤ 25
    "aiCredits": { "status", "netAmount" },                 // preview endpoint
    "premiumRequests": { "status", "netAmount" },           // preview endpoint
    "actionsMinutes": { "includedMinutes", "usedMinutes" },
    "packagesStorage": { "gigabytesUsed", "includedGigabytes" },
    "sharedStorage": { "daysLeft", "estimatedStorage" }
  },
  "capabilities": {                                          // marker summary
    "orgDetails": "OK | FORBIDDEN | ...",
    "teams": "OK | FORBIDDEN | ...",
    "billing": "OK | FORBIDDEN | UNAVAILABLE | ...",
    "runners": "OK | FORBIDDEN | ...",
    "packages": "OK | FORBIDDEN | ..."
  }
}
```

### `github:repository` → `REPOSITORY` (changed)

| Field | Value |
|---|---|
| `externalId` | **`String(repo.id)`** — was `full_name` (breaking, R5) |
| `name` | `repo.full_name` (unchanged) |
| `slug` | `slugify(repo.name)` (unchanged) |
| `details` | existing `{language, topics, visibility, htmlUrl}` + `billing: {net, byProduct}` when attributed |

**Instances** (zero or more; a repo may now emit none):

| Kind | externalId | environment | status | version | deployedAt |
|---|---|---|---|---|---|
| Mapped branch | `branch:{name}` | mapping lookup | `RUNNING` | branch name | last commit on branch |
| GH environment | `env:{name}` | mapping lookup (`OTHER` fallback) | latest deployment state; `STOPPED` if never deployed | deployment ref → release tag → null | deployment `created_at` → release `published_at` |

`rawConfig` per instance carries source truth (`{branch}`, `{environment,
deploymentId, deploymentStatus}`).

### `github:workflow` → `JOB` (`includeWorkflows`)

| Field | Value |
|---|---|
| `externalId` | `{repoId}:{workflow.id}` |
| `name` | `{repo.full_name} / {workflow.name}` |
| `details` | `{path, state, badgeUrl, repoFullName}` |
| `instances` | `[]` |

### `github:runner` → `COMPUTE` (`includeRunners`)

| Field | Value |
|---|---|
| `externalId` | `String(runner.id)` |
| `name` | `runner.name` |
| `details` | `{os, labels[], status, busy, runnerGroupId}` |
| `instances` | `[]` |

### `github:package` → `PACKAGE_REGISTRY` (`includePackages`)

| Field | Value |
|---|---|
| `externalId` | `String(package.id)` |
| `name` | `{package.package_type}:{package.name}` |
| `details` | `{packageType, visibility, htmlUrl, owner}` |
| `instances` | `[]` |

## Environment mapping

```ts
const DEFAULT_ENVIRONMENT_MAPPING: Record<string, Environment> = {
  prod: "PRODUCTION", production: "PRODUCTION", live: "PRODUCTION",
  staging: "STAGING", stage: "STAGING",
  dev: "DEV", develop: "DEV",
  test: "TEST", qa: "TEST",
  demo: "DEMO",
};
```

- Lookup: `trim()` + `toLowerCase()` + exact match; `environmentMapping`
  config overrides/extends defaults.
- **Branches**: mapping is selector *and* classifier — only branches whose
  names appear in the merged map emit instances.
- **GH environments**: mapping is classifier only — every environment emits an
  instance, `OTHER` on no match.

## Reconciliation notes

- Org/workflows/runners/packages are per-config assets — toggling a
  capability off retires exactly those components next run.
- The `externalId` break (R5) retires `full_name`-keyed repos and creates
  `id`-keyed ones; instances re-create under the new component.
- Zero-instance repos are legal (`instances` array may be empty).
