---
"@componode/importer-github": minor
"@componode/frontend": minor
---

GitHub importer branch, release & metadata inventory (spec
`072-github-branch-inventory`):

- Repository components now carry a complete inventory in `details`:
  every branch (name, head SHA, protected flag, default-branch marker,
  optional last-commit activity), the full release inventory plus plain
  tags lacking releases, repository facts (default branch, archived /
  disabled / fork flags, fork provenance, size, license, timestamps), an
  opt-in per-language byte breakdown, and per-repo capability markers —
  all behind new config toggles (`includeBranchInventory`,
  `includeBranchActivity`, `includeBranchInstances`,
  `includeReleaseInventory`, `includeLanguageBreakdown`).
- Environment-mapped branch *instances* keep spec-011 semantics —
  `environmentMapping` remains the instance selector only, and
  `includeBranchInstances` (default on) now gates them explicitly;
  unmapped branches like `main`/`feature/*`/`dependabot/*` appear in the
  inventory instead of being silently dropped.
- Deployment-environment instances carry provider governance facts
  (protection rules, deployment branch policy, admin-bypass) under
  `rawConfig.githubEnvironment` when readable.
- Capability reporting is explicit end-to-end: environments, packages,
  branches, releases, tags, and languages paginate fully and degrade to
  `OK`/`FORBIDDEN`/`ERROR`/`UNAVAILABLE` markers per repo and aggregated
  worst-status-wins on the organization component — no more silent
  failures or 100-item truncation. Rate-limit responses get bounded
  retries honoring `Retry-After`.
- The component page renders a bounded GitHub details section (repo
  facts, branches, releases, tags, languages, degraded-data notice),
  and slug-based detail/history/checks/promote lookups resolve
  gone-only components so degraded repos stay reachable.
- Importer version `1.2.0`; `docs/importers/github.md` documents the new
  toggles, selector semantics, and required token scopes.
