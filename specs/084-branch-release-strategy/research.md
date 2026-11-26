# Research: Two-Branch Release Management Strategy

All design decisions were settled in a three-round structured grilling
session with the repository owner before specification. This document
records the decisions and their rationale; remaining research concerned
only mechanical feasibility, verified against the live repository.

## Decision log

### Branch topology

- **Decision**: Two long-lived branches — `develop` (default, integration)
  and `main` (release-only). Feature branches target `develop`; `main`
  receives only `develop` promotions and `hotfix/*` branches.
- **Rationale**: Direct implementation of requirements #1/#2. GitHub
  default branch determines natural PR/dependabot targeting, so `develop`
  must be default.
- **Alternatives rejected**: Git-flow `release/*` branches (extra ceremony,
  no added control since promotion PR already is the release candidate);
  trunk-based with tag-from-develop (violates requirement #1 that main is
  the release line).

### Promotion trigger

- **Decision**: Manual `workflow_dispatch`; automation performs validation,
  versioning, PR creation, tagging. The merge click on the promotion PR is
  the release approval.
- **Rationale**: Green CI means "compliant", not "releasable"; the release
  decision is a business judgment.
- **Alternatives rejected**: Fully automatic promotion on every green
  develop (ships half-finished feature sets).

### Version-commit path under hard protection

- **Decision**: Release workflow opens a `chore/version-x.y.z` PR to
  `develop` with auto-merge; promotion PR opens after it merges. No ruleset
  bypass actors for any automation.
- **Rationale**: A bypass for the release bot erodes the hard-enforcement
  model; the extra CI cycle is cheap.
- **Alternatives rejected**: Bot bypass pushing directly to develop.

### Promotion PR creation trigger

- **Decision**: A `promote.yml` workflow triggers on push to `develop` and
  opens a promotion PR `develop → main` whenever develop's declared version
  differs from the latest release tag and no such PR is open. Because the
  PR's head is `develop` itself, it self-updates as develop moves.
- **Rationale**: Avoids the dispatch workflow needing to wait (potentially
  15+ minutes) for the version PR's CI inside a single workflow run; the
  invariant-based trigger (version ≠ tag) is self-healing against drift.
- **Alternatives rejected**: Long-running waiter job inside release.yml
  (burns runner minutes, brittle on cancellation); standing always-open
  promotion PR (no version is known before the bump, and a permanently open
  release PR invites accidental merges of unversioned state — the version
  gate on opening keeps the invariant exact).

### Merge strategies

- **Decision**: Promotion/back-merge PRs use merge commits; feature and
  version PRs into `develop` may squash.
- **Rationale**: Squash-merging develop→main would diverge the histories
  permanently, making every future promotion PR show phantom diffs of
  already-released work. Merge commits keep the branches genealogically
  linked. Feature branches are disposable, so squash there is safe.
- **Alternatives rejected**: Squash + resetting develop after each release
  (rewrites a shared branch's history — unacceptable).

### Tagging

- **Decision**: On push to `main`, a workflow reads the declared version
  and creates tag `vX.Y.Z`; if the tag already exists the workflow fails
  loudly.
- **Rationale**: Implements FR-019/FR-020 — the every-merge-is-a-release
  invariant becomes self-enforcing because a non-release merge to main
  produces a loud failure exactly where a human will see it.
- **Alternatives rejected**: Silent skip when tag exists (violations
  invisible); manual tagging (the current state — error-prone, easy to
  forget, easy to tag the wrong commit).

### Version derivation

- **Decision**: Bump derived from accumulated changesets; manual
  major/minor/patch input strictly as fallback when no changesets exist.
- **Rationale**: The knowledge about change magnitude is freshest at
  feature-PR review time; release-time human bump choice is error-prone.
  The repo already accumulates changesets (35+ present).

### Docs dual publishing

- **Decision**: One GitHub Pages site (the only one the repo can have),
  path-split: production at `/componode/` built from `main`, development
  at `/componode/dev/` built from `develop`. A single workflow triggered
  by pushes to either branch checks out both branches, builds both, and
  deploys one combined artifact. Dev docs carry a non-production banner.
- **Rationale**: `actions/deploy-pages` deploys immutable whole-site
  artifacts — partial path updates are impossible, so the artifact must
  contain both halves every time. Rebuilding both from their own branches
  keeps each half correct regardless of which branch triggered.
- **Alternatives rejected**: `gh-pages` branch with per-path writes
  (abandons artifact immutability, reintroduces force-push state
  management); external hosting for dev docs (new infrastructure and
  credential surface for zero secret content); PR-preview-only docs (no
  persistent dev surface to validate against).

### VitePress base-path mechanics (verified)

- `docs-site/.vitepress/config.ts` hardcodes `base: "/componode/"`.
  Dev builds need `/componode/dev/`. Resolution: read an environment
  variable (e.g. `DOCS_BASE`) in the config with the production value as
  default; the dev build sets the override. The banner likewise keys off
  an env var. This is the only docs-site source change required.

### E2E in CI (verified)

- The `playwright/` directory is a self-contained Docker Compose workload
  (`compose.test.yml`, `Dockerfile.runner`); `pnpm e2e` spins up the full
  stack including browsers inside containers. Ubuntu runners provide
  Docker, so the CI job needs no host browser installation — install
  playwright workspace deps, run `pnpm e2e`, tear down with `pnpm e2e:down`
  in an always-step. Cost is minutes per run; accepted as the price of
  requirement #2's "tested".

### Scan parity (verified)

- CodeQL is currently enabled as GitHub **default setup**, which scans only
  the default branch and cannot express dual-branch scanning. Migration to
  an in-repo **advanced** workflow (`codeql.yml` with a javascript-typescript
  + actions matrix, push/PR triggers on both branches, weekly cron) is
  mandatory, followed by disabling the default setup via repo settings at
  cutover. Verified via `gh api repos/Componode/componode/code-scanning/default-setup`
  (state: configured).
- Scorecard: extend push triggers to `develop`. Its branch-protection check
  evaluates the default branch only — accepted consequence of develop
  becoming default; main's protection is enforced by required checks
  regardless.
- Dependency-review: extend to PRs targeting both branches.

### Publish idempotency

- **Decision**: The publish job checks for an existing GitHub Release for
  the tag before creating one (skip-create or upload-assets-only); image
  pushes are inherently idempotent (same tag, same content).
- **Rationale**: Re-running a failed workflow must converge, not error on
  partial artifacts. Manual recovery beyond that is documented, not
  automated — rollback of main is human judgment.

### Hotfix flow

- **Decision**: Hotfix PR to `main` carries fix + changeset + author-run
  `pnpm changeset version` output in the same PR. Post-merge, a bot opens
  the back-merge PR `main → develop` automatically (conflicts resolved by
  humans).
- **Rationale**: No bot ever writes to main; the whole release is auditable
  in one PR. Back-merge keeps develop's pending changesets unconsumed, so
  the next promotion still derives correctly.

### Enforcement ceremony

- **Decision**: Required checks are the gate on both branches; zero
  mandatory human approvals on `develop`; promotion PRs never auto-merge.
- **Rationale**: Small maintainer team + AI agents — approval requirements
  would be rubber-stamp theater; the manual merge click on main is the
  genuine human gate.

### Cutover sequencing

- **Decision**: Single PR to `main` containing everything in-repo
  (workflows, configs, docs); then out-of-band settings flips (default
  branch, rulesets, disable CodeQL default setup, enable auto-merge);
  then smoke test. Settings steps are scripted/documented in the docs
  page so they are reproducible.
- **Rationale**: Nothing breaks mid-flight because the repo content lands
  while main is still the only branch; settings flips take minutes.
