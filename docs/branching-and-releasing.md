---
title: Branching & releasing
description: The two-branch model — develop for integration, main for releases — plus promotion, hotfix, and recovery procedures.
---

# Branching & releasing

Componode uses a two-branch model:

```text
feature/* ──squash PR──▶ develop ══promotion PR (merge commit)══▶ main ──auto-tag──▶ publish
                            │                                      ▲
hotfix/* ──PR with version bump (merge commit)─────────────────────┘
                            └──── automatic back-merge PR main→develop ──┘
```

- **`develop`** is the repository's **default branch** and the integration
  line. Every feature, bugfix, and dependency update targets it. It is
  protected: no direct pushes, all quality gates (lint, typecheck, tests,
  build, end-to-end browser tests, dependency audit and review, security
  scans) must be green before merge.
- **`main`** is the release line. It only ever receives merges from
  `develop` (a promotion) or from `hotfix/*` branches. **Every merge to
  `main` is a release** — the version in `package.json` on `main` is always
  ahead of the last tag, and merging triggers tagging and publishing
  automatically.

## Why this model

- Problems are caught on `develop` — where developers and AI tools monitor
  scan results — **before** they can reach a release.
- Versions are only ever bumped at promotion time, never ad-hoc.
- The release decision stays human (two clicks: trigger the workflow, merge
  the promotion PR) while every mechanical step is automated.

## The release flow

1. A maintainer decides `develop` is worth releasing and manually runs the
   **Release** workflow from the Actions tab.
2. The workflow refuses to start unless `develop`'s latest quality gates
   are green.
3. It derives the version bump from the accumulated changesets (the
   `major/minor/patch` input is only a fallback for when no changesets
   exist) and opens a `chore/version-x.y.z` PR **to develop**. The release
   workflow then waits for that PR's gates to go green, merges it, and
   opens the promotion PR itself — all in one workflow run, because
   pushes and merges made with the default automation token do not
   trigger further workflows.
4. The workflow then opens the promotion PR `develop → main`
   automatically (the independent **Promote** workflow acts as a safety
   net for the same job on human pushes to develop — an open promotion
   PR tracks develop, so it self-updates).
5. A human merges the promotion PR with a **merge commit** (never squash —
   squash would diverge the histories and make every future promotion diff
   meaningless). This merge **is** the release approval.
6. The **Tag** workflow creates `v<version>` automatically and dispatches
   the **Publish** workflow, which builds and pushes the container image
   to GHCR and creates the GitHub Release.

If a merge to `main` ever lacks a version bump, the tag step **fails
loudly** — that failure is the alarm, not a bug.

## Hotfixes

For critical defects that cannot wait for `develop`'s unreleased work:

1. Branch `hotfix/<name>` off `main`.
2. Include in the same PR: the fix, its changeset, **and** the output of
   running `pnpm changeset version` in the branch — the whole release is
   auditable in one PR.
3. Merge to `main` with a merge commit. Tagging and publishing fire
   exactly as for a promotion.
4. The **Back-merge** workflow automatically opens a `main → develop` PR.
   Merge it (merge commit); resolve conflicts manually if needed —
   `develop`'s pending changesets must survive unconsumed.

## Documentation publishing

The docs site is dual-track on the single GitHub Pages site:

| Path | Content | Source branch |
|------|---------|---------------|
| `/componode/` | Production documentation | `main` |
| `/componode/dev/` | Development documentation (bannered, non-production) | `develop` |

A push to either branch rebuilds **both** halves from their own branches
and deploys one combined artifact — Pages deployments are immutable
whole-site artifacts, so partial updates are impossible. Validate docs
changes on the `/dev/` track before they reach production.

## Scan coverage

Every scan runs on both branches: CI lint/typecheck/test/build/audit,
end-to-end browser tests, dependency review (PRs), CodeQL ( pushes, PRs,
weekly), and OpenSSF Scorecard. Results land in the repository's
code-scanning and security dashboards per branch — query them with
`gh api` or the Security tab. There are deliberately no auto-issue bots:
the alerts and the blocking checks are the signal.

## Publish failure recovery

The publish workflow is **idempotent** — if it fails partway (registry
outage, asset upload error), re-run the failed workflow run from the
Actions tab; it converges instead of erroring on existing artifacts.

If re-running does not recover:

1. Check what exists: `gh release view vX.Y.Z`, and the package list in
   GHCR.
2. If the tag itself is wrong (wrong commit), delete the release and the
   tag (`gh release delete vX.Y.Z`, `git push origin :refs/tags/vX.Y.Z`),
   fix forward with a new patch version — **never** reuse a version number.
3. There is no automatic rollback of `main`: recovery is a human judgment
   call, deliberately.

## Bootstrap note: the first release

The model was cut over before the repository had ever been tagged. The
merge of the cutover change itself therefore triggered the automatic
tagging of **v1.0.0 as the baseline first release** — a deliberate,
one-time bootstrap that established the invariant (the version on `main`
is always tagged) rather than a violation of the human-release-decision
principle. Every release after that baseline follows the normal promotion
flow above.

## Repository settings reference

The branching model depends on these settings (applied at cutover by
`scripts/cutover-branch-settings.sh`):

- Default branch: `develop`.
- Branch ruleset for `develop`: no direct pushes, pull request required,
  required checks (`check`, `e2e`, `dependency-review`, CodeQL analyses),
  squash and merge-commit allowed, auto-merge allowed, zero required
  approvals — the gates are the enforcement.
- Branch ruleset for `main`: no direct pushes, pull request required, same
  required checks plus `main-guard`.

Two controls are **procedural, not settings-enforced**, because GitHub
rulesets cannot restrict merge types per branch (merge-type settings are
repository-wide) and auto-merge is likewise repository-wide:

- Promotion/hotfix/back-merge PRs must be merged with **merge commits** —
  the human clicking merge on `main` chooses the merge type and is the
  trusted control.
- Auto-merge must never be enabled on PRs to `main` — the manual merge act
  is the release approval.
- **Secret `RELEASE_TOKEN`**: a fine-grained personal access token scoped
  to this repository with contents:write and pull-requests:write. The
  release automation uses it for PR creation and merges because
  PRs created by the default workflow token do not reliably trigger CI.
  Without it the automation degrades: version PRs need a manual
  close/reopen to start their checks. Rotate before expiry (max 1 year).
- CodeQL runs from the in-repo advanced workflow (`.github/workflows/codeql.yml`);
  the repository-level default setup must stay **disabled** or the two
  configurations conflict.

## See also

- [Release process](release.md) — changesets mechanics for contributors.
- [Contributing](contributing.md) — development setup and quality gates.
