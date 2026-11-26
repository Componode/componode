# Pipeline Contracts

Interface contracts for each workflow: triggers, inputs, preconditions,
effects, failure semantics. These are the external interfaces of this
feature — the surfaces maintainers and automation interact with.

## `ci.yml` — Continuous Integration (modified)

**Triggers**: push to `[main, develop]`; pull_request targeting
`[main, develop]`.

**Jobs**:
- `check`: lint, typecheck, test, build, audit, generated-docs checks,
  docs build. (unchanged content, extended triggers)
- `e2e` (NEW): runs the Playwright Docker Compose workload
  (`pnpm e2e` in `playwright/`), always tears down (`e2e:down`).
- `dependency-review` (PRs, both branches — extended).
- `main-guard` (NEW, PRs targeting `main` only): fails unless the head
  branch is `develop` or matches `hotfix/*`.

**Required checks contract**: `check`, `e2e`, `dependency-review`,
`main-guard` (main PRs) + CodeQL analyses become required status checks in
branch rulesets for both branches.

## `codeql.yml` — Advanced CodeQL (new)

**Triggers**: push to `[main, develop]`; pull_request targeting
`[main, develop]`; weekly cron.

**Matrix**: `javascript-typescript`, `actions`.

**Effects**: SARIF results in the code-scanning dashboard, attributable
per-branch.

**Cutover dependency**: repo-level default setup MUST be disabled or both
configurations conflict.

## `release.yml` — Release (reshaped)

**Job `version`** — trigger `workflow_dispatch`, inputs:
`bump` (major/minor/patch, fallback only).

- Precondition check: latest quality-gate runs on `develop` are green;
  otherwise the job fails before changing anything.
- Runs `changeset version` on a branch off `develop` (fallback changeset
  created from `bump` input when none exist).
- Opens `chore/version-x.y.z` PR to `develop` with auto-merge enabled.
- Permissions: contents:write, pull-requests:write. No ruleset bypass.

**Job `publish`** — trigger push of tag `v*` (as today), made idempotent:

- If a GitHub Release for the tag already exists, skip creation and
  upload/replace assets as needed instead of erroring.
- Container image push unchanged (inherently idempotent).

## `promote.yml` — Promotion PR opener (new)

**Trigger**: push to `develop`.

**Logic**: read declared version on develop; read latest release tag;
if they differ AND no open PR with head `develop` base `main` exists,
create it (title `release: vX.Y.Z`, body lists included changes).
If one exists, do nothing — it self-updates.

**Failure semantics**: read-only on failure; a missed run self-heals on
the next push to develop.

## `tag.yml` — Auto-tag (new)

**Trigger**: push to `main`.

**Logic**: read declared version; if tag `vX.Y.Z` exists → exit 1 with a
loud message (invariant violation: merge without version bump). Otherwise
create and push the annotated tag.

**Permissions**: contents:write.

## `backmerge.yml` — Hotfix back-merge (new)

**Trigger**: pull_request closed (merged) targeting `main` with head
matching `hotfix/*`.

**Logic**: open PR `main → develop` titled `chore: back-merge <hotfix>`.
If one already exists, do nothing. Conflicts are left for human resolution.

## `docs.yml` — Documentation (reshaped)

**Triggers**: push to `[main, develop]`, workflow_dispatch.

**Logic**:
1. Checkout `main` → install → build docs with production base
   (`/componode/`) into `dist-prod/`.
2. Checkout `develop` (separate path) → install → build docs with dev base
   (`/componode/dev/`) + non-production banner into `dist-dev/`.
3. Compose single artifact: `dist-prod/` at root, `dist-dev/` copied into
   `dist-prod/dev/`.
4. Deploy via actions/deploy-pages as today.

**Invariants**: prod content always built from `main`, dev always from
`develop`, regardless of which branch triggered the run.

**Concurrency**: existing `docs-${{ github.ref }}` grouping must change to
a single shared group — two near-simultaneous pushes to main and develop
would otherwise deploy conflicting artifacts (last-writer-wins is
acceptable but should be serialized, not parallel).

## `scorecard.yml` — Supply chain (modified)

Extend push triggers to `[main, develop]`. Weekly cron unchanged.

## Settings contracts (out-of-band, scripted/documented)

At cutover, via `gh api` or the repository settings UI:
- default branch → `develop`
- ruleset `develop`: no direct pushes, require PR, required checks
  [check, e2e, dependency-review, codeql analyses], squash+merge allowed,
  auto-merge allowed, zero required approvals
- ruleset `main`: no direct pushes, require PR, same required checks +
  main-guard, merge commits only, no auto-merge
- enable auto-merge at repo level
- disable CodeQL default setup
