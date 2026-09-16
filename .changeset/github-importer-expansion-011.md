---
"@componode/core": minor
"@componode/backend": minor
"@componode/importer-github": minor
"@componode/frontend": minor
---

GitHub importer expansion (spec `011-github-importer-expansion`):

- New `ACCOUNT` component category; the GitHub organization imports as an
  account-level component carrying profile, plan/seats, member policies, a
  teams summary, an aggregated billing snapshot, and per-capability status
  markers.
- Repositories gain real deployment topology: one instance per
  operator-mapped branch plus one per GitHub deployment environment, with
  deployment-derived status/version/deployedAt. Branch names are classified
  through the configurable environment mapping — nothing is automatically
  production.
- Repository `externalId` switched from `full_name` to the stable numeric
  repo id — a one-time re-catalog on upgrade (existing repo components retire
  and re-create; re-assign curated ownership/groups).
- Optional emitters behind config toggles: Actions workflows (`JOB`),
  org-level self-hosted runners (`COMPUTE`), org packages
  (`PACKAGE_REGISTRY`).
- `baseUrl` config for GitHub Enterprise Server (hostname-only; passes the
  shared URL-safety guard). API version pinned to 2026-03-10.
