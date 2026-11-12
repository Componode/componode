# Contract: GitHub importer inventory payloads

**Feature**: `072-github-branch-inventory` | **Date**: 2026-11-12

Two contract surfaces, both internal to the monorepo (no HTTP/OpenAPI change — `details`/`rawConfig` are existing free-form jsonb fields already serialized to the frontend):

1. **Importer config schema** (`githubConfigSchema` in `packages/importer-github/src/config.ts`) — delivered to the frontend via the manifest (`ADR-042`); the schema-driven form renders new fields automatically.
2. **`DiscoveredAsset.details` / `DiscoveredAssetInstance.rawConfig` payload shapes** — consumed by `import-run-service` (stored verbatim) and the frontend details renderers.

## 1. Config schema additions

```ts
includeBranchInventory: z.boolean().default(true)
  .describe("Import the full branch inventory into component details"),
includeBranchActivity: z.boolean().default(false)
  .describe("Fetch last-commit timestamps per branch (one extra API call per branch)"),
includeBranchInstances: z.boolean().default(true)
  .describe("Emit one instance per repository branch (environment from mapping, OTHER fallback)"),
includeReleaseInventory: z.boolean().default(true)
  .describe("Import releases and tags inventory into component details"),
includeLanguageBreakdown: z.boolean().default(false)
  .describe("Import per-language byte breakdown (one extra API call per repo)"),
```

Unchanged: `includeEnvironments` (deployment-environment instances only — it never gated branch instances and still doesn't; branch instances are now governed solely by `includeBranchInstances`), `includeReleases` (latest-release fallback for env instances — independent of `includeReleaseInventory`), `environmentMapping` (classifier for *instances* — mapped names keep their environment, unmapped names fall back to `OTHER`; spec-011 selector semantics amended).

## 2. `details` payload — `github:repository`

```jsonc
{
  // …existing keys unchanged: language, topics, visibility, htmlUrl, billing?
  "defaultBranch": "main",
  "archived": false,
  "disabled": false,
  "fork": false,
  "forkParent": null,               // {fullName, htmlUrl} | null
  "forkSource": null,               // {fullName, htmlUrl} | null
  "sizeKb": 1024,
  "license": null,                  // {key, name, spdxId} | null
  "openIssuesCount": 12,
  "createdAt": "2024-01-01T00:00:00Z",
  "pushedAt": "2026-01-02T00:00:00Z",
  "updatedAt": "2026-01-02T00:00:00Z",

  "branches": [                     // includeBranchInventory; [] when empty
    {
      "name": "main",
      "sha": "abc123…",
      "url": "https://github.com/o/r/tree/main",
      "protected": true,
      "isDefault": true,
      "lastActivityAt": "2026-01-02T00:00:00Z"   // only when includeBranchActivity
    }
  ],

  "releases": [                     // includeReleaseInventory; [] when empty
    {
      "id": 7200,
      "tagName": "v1.2.3",
      "name": "v1.2.3",
      "publishedAt": "2026-01-03T00:00:00Z",
      "prerelease": false,
      "draft": false,
      "targetCommitish": "main",
      "assetCount": 2,
      "assetsTotalBytes": 4096,
      "htmlUrl": "https://github.com/o/r/releases/tag/v1.2.3"
    }
  ],

  "tags": [                         // includeReleaseInventory; plain tags LACKING releases (FR-007); [] when empty
    { "name": "nightly", "sha": "def456…", "htmlUrl": "https://github.com/o/r/releases/tag/nightly" }
  ],

  "languages": { "TypeScript": 91234 },   // includeLanguageBreakdown only

  "capabilities": {                 // per-repo degradation markers
    "branches": { "status": "OK" },
    "versionInventory": { "status": "FORBIDDEN", "message": "…" }
  }
}
```

Rules:

- Keys absent entirely when their toggle is off; `[]`/`{}` when on but empty.
- `details` is replaced wholesale each run — no merge semantics, no stale keys.
- Field names are camelCase; provider-native names preserved only inside `rawConfig`-style passthrough (none here — inventory is normalized).

## 3. `rawConfig` — environment instances (`env:{name}`)

```jsonc
{
  "environment": "production",
  "deploymentId": 7000,
  "deploymentState": "success",
  "githubEnvironment": {            // NEW — only when environments endpoint returns it
    "protectionRules": [
      { "type": "wait_timer", "waitTimerMinutes": 30 },
      { "type": "required_reviewers", "preventSelfReview": true, "reviewerCount": 2 }
    ],
    "deploymentBranchPolicy": { "protectedBranches": true, "customBranchPolicies": false },
    "canAdminsBypass": true
  }
}
```

`githubEnvironment` is omitted entirely when the environments call fails or returns no governance data.

## 3b. `rawConfig` — branch instances (`branch:{name}`)

Every provider-reported branch emits one instance (amends spec-011 selector semantics — mapping classifies, never selects):

```jsonc
{
  "branch": "feature/checkout",
  "sha": "abc123…",                  // head SHA from the shared branch list (null when absent)
  "protected": false,
  "isDefault": false,                // name === repo.default_branch
  "lastActivityAt": "2026-02-03T00:00:00Z"  // only when includeBranchActivity
}
```

Instance fields: `environment` = built-in/`environmentMapping` classification or `OTHER`; `url` = `{html_url}/tree/{branch}`; `status` = `RUNNING`; `version` = branch name; `deployedAt` = last-commit activity when `includeBranchActivity` is on, else repo `pushed_at`. `lastActivityAt` in `rawConfig` mirrors the inventory field when activity is enabled.

## 4. `details.capabilities` — `github:organization` (aggregate)

Org-scoped keys unchanged (`billing`, `runners`, `packages`, `teams`-adjacent markers). Repo-scoped families added with worst-status-wins across repos: `branches`, `branchInstances`, `branchActivity`, `versionInventory`, `releases` (latest-release env-instance fallback), `languages`, `environments`, `deployments`. Marker shape: `{status: "OK"|"FORBIDDEN"|"ERROR"|"UNAVAILABLE", message?}` — message on aggregate failures notes the affected repo count.

## 5. Degradation contract

Every optional fetch family wraps in `withCapability()`; non-`OK` → marker recorded (per-repo `details.capabilities` + org aggregate), `warnIfDegraded` logs a warning, run continues. `validateDiscoveredAsset` still gates every yielded asset — inventory shapes must pass it (all fields are `details`/`rawConfig` free-form, so validation risk is nil; instances still must satisfy the instance schema).
