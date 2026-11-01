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

A maintainer triggers the release workflow from the GitHub Actions tab on the
`main` branch. The workflow:

1. Consumes all unreleased changesets.
2. Bumps `package.json` and updates `CHANGELOG.md`.
3. Opens a release pull request for review.
4. After the release PR is merged, a tagged container image and source archive
   are published as GitHub Release artifacts.

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

- **Missing changeset for a user-facing change**: The maintainer-supplied `bump` input is used as a fallback to create a release-bump changeset. If no changesets and no `bump` input are provided, the workflow fails with a clear message.
- **Release workflow runs while a feature branch is still open**: The release workflow only versions from `main`, so open feature branches do not interfere. The release PR should be reviewed and merged independently.
- **CI checks fail on the release PR**: The PR is opened but marked as failing; it must be fixed and the workflow re-run before merge.
- **Container build fails**: The release is not published until the build is fixed and the workflow is re-run.
