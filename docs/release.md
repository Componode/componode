---
title: Release process
description: Changesets and the release workflow.
---

# Releasing Componode

Componode uses [changesets](https://github.com/changesets/changesets) and GitHub
Actions for versioned releases.

## Adding a changeset

Every user-facing change should have a changeset. Run:

```bash
pnpm changeset
```

Select the `componode` package and choose the semver impact:

- `major` — breaking changes
- `minor` — new features
- `patch` — bug fixes or small improvements

Write a human-readable summary. Commit the generated `.changeset/*.md` file with
the code change.

## Cutting a release

Releases follow the two-branch model — see
[Branching & releasing](branching-and-releasing.md) for the full picture.
In short, a maintainer triggers the release workflow from the GitHub Actions
tab. The workflow:

1. Verifies `develop`'s quality gates are green — refusing to start otherwise.
2. Consumes all unreleased changesets and derives the version bump from them.
3. Bumps `package.json` and updates `CHANGELOG.md` in a version PR to
   `develop`, which auto-merges through the normal protected gates.
4. A promotion PR from `develop` to `main` opens automatically; a human
   merging it (merge commit) **is** the release approval.
5. The version tag is created automatically and a tagged container image and
   source archive are published as GitHub Release artifacts.

## Release artifacts

Each release produces:

- A Git-tagged source archive.
- A tagged container image built from the repository `Dockerfile` and attached
  to the GitHub Release.
- An updated `CHANGELOG.md`.

## Versioning

Componode follows [Semantic Versioning](https://semver.org/). The version is
managed in the root `package.json`.

## Edge cases

- **Missing changeset for a user-facing change**: The maintainer-supplied `bump` input is used as a fallback to create a release-bump changeset when no unreleased changesets exist.
- **`develop` gates are not green**: The release workflow refuses to start — fix develop first; that is the point of the integration branch.
- **New work merges to `develop` while a promotion PR is open**: The promotion PR tracks `develop` automatically. The maintainer judges whether the additions belong in this release — merging is the approval.
- **A merge to `main` without a version bump**: The tagging workflow fails loudly. Every merge to `main` must be a release; investigate what merged without one.
- **Publish workflow fails partway**: It is idempotent — re-run the failed run. See the recovery procedure in [Branching & releasing](branching-and-releasing.md#publish-failure-recovery).
- **Emergency fix that cannot wait for develop**: Use the hotfix flow — branch `hotfix/*` off `main`, carry the fix + changeset + version bump in one PR. See [Branching & releasing](branching-and-releasing.md#hotfixes).
