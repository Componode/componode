# Quickstart: Cutover & Validation Runbook

## Prerequisites

- The feature PR (branch `084-branch-release-strategy`) merged to `main`.
- Repository admin access for settings changes.
- `gh` CLI authenticated.

## Cutover sequence

### Phase 1 — land the in-repo change

1. Merge the feature PR to `main` (normal squash merge — the two-branch
   model is not active yet).
   **Deliberate bootstrap effect**: the repository has never been tagged.
   When this merge lands, `tag.yml` fires on the push to `main`, finds no
   `v1.0.0` tag, and creates it — publishing v1.0.0 as the baseline first
   release. This is the intended one-time bootstrap: `main`'s declared
   1.0.0 represents exactly the state being merged, and tagging it
   establishes the invariant (main == last tag) that every future merge
   relies on. The maintainer merging this PR accepts the baseline release
   by doing so. If v1.0.0 should NOT be published, tag or release it
   manually BEFORE merging this PR instead.

### Phase 2 — create the branch and flip settings

2. Create `develop` from `main` and push it:
   ```bash
   git checkout main && git pull
   git checkout -b develop && git push -u origin develop
   ```
3. Apply repository settings (scripted in `scripts/cutover-branch-settings.sh`
   or manually per docs page):
   - default branch → `develop`
   - branch rulesets for `develop` and `main` per contracts/pipelines.md
   - enable auto-merge
   - disable CodeQL default setup (the in-repo advanced workflow replaces it)

### Phase 3 — smoke test

4. Open a trivial PR to `develop` (e.g. a docs typo fix); verify:
   - CI runs: check, e2e, dependency-review, CodeQL analyses
   - merge is blocked until green; auto-merge completes the merge
5. Verify scans: code-scanning dashboard shows results attributed to
   `develop`.
6. Verify docs dev publishing: after a push to develop, confirm
   `https://componode.github.io/componode/dev/` serves the dev docs with
   the non-production banner, and `/componode/` still serves prod.

## Validation scenarios (prove the feature end-to-end)

### V1 — Promotion release flow

1. Ensure `develop` is green and carries at least one changeset.
2. Actions → Release → Run workflow (bump input irrelevant — changesets
   exist).
3. Expect: `chore/version-x.y.z` PR to develop opens, auto-merges when
   green.
4. Expect: within minutes of that merge, a `release: vX.Y.Z` PR from
   develop to main appears.
5. Merge it manually (merge commit). Expect: tag `vX.Y.Z` appears, publish
   pipeline runs, GitHub Release exists, GHCR image tagged.

### V2 — Invariant enforcement

1. (Test/repo-maintenance only, revert after) Merge a change to main
   without a version bump — expect `tag.yml` to fail loudly.
   Prefer validating this in a fork rather than the real repo.

### V3 — Hotfix flow

1. Branch `hotfix/test` off `main`; include a trivial fix + changeset +
   `pnpm changeset version` output.
2. PR to `main`; verify `main-guard` passes (hotfix pattern).
3. Merge (merge commit); verify tag+publish fire; verify back-merge PR
   to develop opens automatically.

### V4 — Scan parity

1. Compare the code-scanning dashboard filtered by `main` vs `develop` —
   same tool coverage. CI checks list identical on PRs to either branch
   (modulo `main-guard`, which is main-only).

### V5 — Docs separation

1. Merge a docs-visible change to develop only: it appears under `/dev/`
   and NOT at the production root.
2. After the next promotion, it appears at the production root.

## Failure recovery

- Publish pipeline failure after tagging: re-run the failed workflow run
  (idempotent). If the tag itself is wrong: delete the release + tag,
  fix forward. Full procedure documented in the docs page shipped with
  this feature.
