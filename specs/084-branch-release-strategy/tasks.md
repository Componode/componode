# Tasks: Two-Branch Release Management Strategy

**Input**: Design documents from `/specs/084-branch-release-strategy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/pipelines.md, quickstart.md

**Tests**: This feature is CI/CD infrastructure. No unit/integration/Playwright
product tests apply (no product surface changes — the constitution check in
plan.md documents this). Validation is by YAML linting, the existing CI
suite running on the feature PR, and the quickstart.md smoke scenarios.

**Organization**: Tasks grouped by user story per spec.md priorities.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Validate all existing workflow YAML parses and establish a lint baseline with `npx actionlint` (or equivalent YAML parse check) against `.github/workflows/*.yml` before making changes

---

## Phase 2: Foundational

*(No blocking shared prerequisites — each workflow file is independent; stories proceed directly.)*

---

## Phase 3: User Story 1 — Integration branch with full quality gates (P1)

**Goal**: `develop`-targeted PRs and pushes run the full quality gate suite
including the new e2e job; merges blocked until green.

**Independent test**: Open the feature PR itself — since ci.yml triggers
are extended, the PR validates the extended workflow syntax immediately.
Post-cutover quickstart smoke scenario 4 covers merge blocking.

- [x] T002 [US1] Extend `.github/workflows/ci.yml` triggers to `push`/`pull_request` on branches `[main, develop]`
- [x] T003 [US1] Extend the `dependency-review` job in `.github/workflows/ci.yml` to run on PRs targeting both branches (it keys off `pull_request` event — verify no change needed beyond triggers)
- [x] T004 [US1] Add `e2e` job to `.github/workflows/ci.yml`: install playwright workspace deps (`pnpm install` in `playwright/` per its own package manager setup), run `pnpm e2e` in `playwright/`, with `if: always()` teardown step running `pnpm e2e:down`; verify Docker availability assumptions against `playwright/compose.test.yml` and `playwright/scripts/run.ts` before writing the job
- [x] T005 [US1] Add `main-guard` job to `.github/workflows/ci.yml` conditioned on `github.event_name == 'pull_request' && github.base_ref == 'main'` that fails unless `github.head_ref` is `develop` or matches `hotfix/*`
- [x] T006 [US1] Update `.changeset/config.json` `baseBranch` from `main` to `develop`
- [x] T007 [US1] Add `target-branch: "develop"` to every ecosystem entry in `.github/dependabot.yml`

---

## Phase 4: User Story 2 — Promotion-based release with derived versioning (P1)

**Goal**: Manual dispatch → green-check validation → changesets-derived
version PR to develop (auto-merge) → automatic promotion PR → manual merge
→ auto-tag → idempotent publish.

**Independent test**: YAML syntax validation on the feature PR; full
end-to-end validation is quickstart scenario V1 post-cutover.

- [x] T008 [US2] Reshape the `version` job in `.github/workflows/release.yml`: checkout `develop` (not the default ref), add a precondition step that queries the latest commit status/check runs on `develop` via `gh api` and fails unless all required gates are green
- [x] T009 [US2] Change the version PR creation in `.github/workflows/release.yml` to target base `develop` (instead of `main`) and enable auto-merge on it (`gh pr merge --auto --squash`); keep the changeset-fallback logic deriving bump from accumulated changesets with manual input strictly as fallback
- [x] T010 [P] [US2] Create `.github/workflows/promote.yml`: on push to `develop`, compare declared `package.json` version against latest `v*` tag; if different and no open PR with head `develop`/base `main` exists, create it with title `release: vX.Y.Z` and a body listing changes since the last tag (permissions: contents:read, pull-requests:write)
- [x] T011 [P] [US2] Create `.github/workflows/tag.yml`: on push to `main`, read declared version, fail loudly if tag `v<version>` already exists (invariant violation message), otherwise create and push annotated tag (permissions: contents:write)
- [x] T012 [US2] Make the `publish` job in `.github/workflows/release.yml` idempotent: before `gh release create`, check `gh release view` for the tag and skip-create/upload-assets-only when it already exists; verify image push steps are re-runnable

---

## Phase 5: User Story 3 — Dual-track documentation publishing (P2)

**Goal**: One Pages site; prod docs at `/` built from main, dev docs at
`/dev/` built from develop, combined artifact on either trigger.

**Independent test**: `pnpm docs:build` with the env override locally
produces a dev-base build; full validation is quickstart scenario V5.

- [x] T013 [P] [US3] Modify `docs-site/.vitepress/config.ts` to read base path from an environment variable (e.g. `DOCS_BASE`, default `/componode/`) and render a visible non-production banner/badge when a dev flag is set (inspect config first for the least invasive injection point — title suffix or theme notice)
- [x] T014 [US3] Reshape `.github/workflows/docs.yml`: triggers on push to `[main, develop]`; two checkouts (`main` at one path, `develop` at another, both with explicit `ref`), two independent installs+builds (prod with default base, dev with `DOCS_BASE=/componode/dev/` + banner flag), compose dev dist into prod dist's `dev/` subdirectory, deploy combined artifact
- [x] T015 [US3] Change the docs workflow concurrency group in `.github/workflows/docs.yml` to a single shared group (not per-ref) so simultaneous main/develop pushes serialize rather than race-deploy conflicting artifacts

---

## Phase 6: User Story 4 — Scan parity across both branches (P2)

**Goal**: Every scan on main also runs on develop, results in
code-scanning dashboard per branch.

**Independent test**: Post-cutover quickstart scenario V4; on the feature
PR, CodeQL advanced workflow syntax validates by being picked up.

- [x] T016 [P] [US4] Create `.github/workflows/codeql.yml`: advanced configuration, matrix `[javascript-typescript, actions]`, triggers push/PR on `[main, develop]` plus weekly cron, using `github/codeql-action` init/analyze pinned by SHA matching repo conventions, `security-events: write` permission
- [x] T017 [P] [US4] Extend `.github/workflows/scorecard.yml` push triggers to `[main, develop]`

---

## Phase 7: User Story 5 — Emergency hotfix flow (P3)

**Goal**: Hotfix PRs reach main; back-merge to develop is automatic.

**Independent test**: quickstart scenario V3 post-cutover.

- [x] T018 [US5] Create `.github/workflows/backmerge.yml`: on `pull_request` `closed` (merged) targeting `main` with head matching `hotfix/*`, open a PR `main → develop` titled `chore: back-merge <branch>` unless one already exists (permissions: contents:read, pull-requests:write)

---

## Phase 8: Polish & cross-cutting concerns

- [x] T019 [P] Create `docs/branching-and-releasing.md` documenting the two-branch model, release process, hotfix process, publish-failure recovery runbook, and cutover settings steps; register it in the sidebar in `docs-site/.vitepress/config.ts` (check `docs:sidebar:check` passes)
- [x] T020 [P] Update `CONTRIBUTING.md` to describe the two-branch flow: feature PRs target `develop`, releases via promotion, hotfix process
- [x] T021 [P] Update `AGENTS.md`: branch targeting rules (feature branches merge to `develop`), hotfix process, release process summary — only the sections that reference main-as-integration-target
- [x] T022 [P] Create `scripts/cutover-branch-settings.sh` encoding the post-merge settings flips (default branch, rulesets JSON via `gh api`, enable auto-merge, disable CodeQL default setup) with echo-dry-run or explicit confirmation per destructive-operations caution
- [x] T023 Run full verification: actionlint/YAML-parse all workflows, `pnpm lint`, `pnpm typecheck`, `pnpm build`, all `docs:*:check` scripts; fix any drift surfaced
- [x] T024 Validate tasks against quickstart.md scenarios and mark spec.md status complete; confirm no `packages/**` application source was modified (`git diff main -- packages/`)

---

## Dependencies

```text
T001 (setup)
├─ US1 (T002–T007) ─ independent
├─ US2 (T008–T012) ─ independent of US1; T011/T012 depend on T008/T009 conceptually (same file/workflow family)
├─ US3 (T013–T015) ─ independent
├─ US4 (T016–T017) ─ independent
└─ US5 (T018) ───── independent
Polish (T019–T024) after all stories; T023/T024 strictly last
```

## Parallel opportunities

- T010 + T011 (new independent files) in parallel with T008/T009
- T016 + T017 in parallel
- T019 + T020 + T021 + T022 in parallel (different files)
- US3, US4, US5 phases are fully independent of each other

## Implementation strategy

Execute phases in order T001 → US1 → US2 → US3 → US4 → US5 → Polish.
MVP scope: US1 + US2 (the two P1 stories) — but all stories ship in the
single cutover PR per FR-029, since partial cutover leaves the branching
model incoherent.

## Phase 9: Convergence

Findings from the converge assessment (round 1), ordered high-first:

- [x] T025 [F-HIGH] Fix `.github/workflows/scorecard.yml` job condition: after cutover `develop` becomes the default branch, so the current `default_branch == github.ref_name` condition would STOP running scorecard on `main` pushes — violating requirement #5 scan parity in reverse. Condition must cover both `main` and `develop` refs explicitly
- [x] T026 [F-HIGH] Document the one-time bootstrap effect — merging the cutover PR itself triggers `tag.yml` and publishes v1.0.0 as the baseline first release (the repo has never been tagged) — in `specs/084-branch-release-strategy/quickstart.md` cutover Phase 1 AND `docs/branching-and-releasing.md`, framed as a deliberate accepted step
- [x] T027 [F-MED] Fix `cache: pnpm` in `.github/workflows/docs.yml` — checkouts land in `prod-src/`/`dev-src/` subdirectories with no lockfile at the runner root, so setup-node cache resolution needs an explicit `cache-dependency-path` covering both lockfiles
- [x] T028 [F-LOW] Hardening: add `timeout-minutes` to the `e2e` job in `.github/workflows/ci.yml` (a hung compose stack would otherwise burn up to 6h), and key the `publish.yml` concurrency group by resolved tag rather than `github.ref` so two dispatches for different tags cannot deadlock each other

## Phase 10: Review

Findings from code-review round 1 (both axes), ordered CRITICAL/HIGH first:

- [x] T029 [CRITICAL] [code-review: spec] Redesign `.github/workflows/release.yml` chaining: bot auto-merge pushes do not trigger push workflows, so promote.yml may never fire after the version PR lands (FR-017/018 broken). Replace the fire-and-forget auto-merge cascade with in-workflow chaining: after creating the version PR, poll its check runs (bounded, ~45min timeout), merge it with `gh pr merge --squash` when green, then open/refresh the promotion PR `develop → main` in the SAME workflow run. Remove the redundant pre-CI suite (lint/typecheck/test/build — the version PR itself gates these, and develop's state is already validated by the FR-015 precondition). promote.yml stays as a safety net for human pushes
- [x] T030 [HIGH] [code-review: standards] Shell-injection hardening: bind all github context through `env:` instead of `${{ }}` interpolation inside run scripts — `github.head_ref` in ci.yml main-guard, `github.event.pull_request.head.ref` in backmerge.yml, `github.event.inputs.tag` in publish.yml (including downstream steps consuming the tainted output); validate the tag input against strict semver shape, not just `v*` prefix
- [x] T031 [HIGH] [code-review: standards] Fix `gh` repo inference in `.github/workflows/backmerge.yml` — no checkout means no git remote; set `GH_REPO: ${{ github.repository }}` env (apply defensively to all gh-using workflows)
- [x] T032 [HIGH] [code-review: standards] Fix false enforcement claims in `docs/branching-and-releasing.md`: merge-commit-only and no-auto-merge on main are NOT enforceable by GitHub rulesets — document them as procedural controls honestly (merge types are repo-wide settings; the human merging main is trusted to follow them)
- [x] T033 [MED] [code-review: spec] Harden the FR-015 precondition in release.yml: require the named checks (`check`, `e2e`, `Analyze (javascript-typescript)`, `Analyze (actions)`) present on develop HEAD with conclusion `success` — not merely absence of failures
- [x] T034 [MED] [code-review: standards] Fix the `devBannerHead` type error in `docs-site/.vitepress/config.ts` (three-element HeadConfig tuples typed as two-element)
- [x] T035 [MED] [code-review: spec] publish.yml `latest` safety: only update the `:latest` image tag when the version being published is the highest existing `v*` tag — prevents manual dispatch of an old tag from regressing latest
- [x] T036 [LOW] [code-review: spec] promote.yml: filter the existing-PR lookup to same-repository head (avoid fork matches) and add a concurrency group; ci.yml main-guard: for `hotfix/*` heads, verify the branch ancestry actually descends from main (fetch + merge-base check)
- [x] T037 [LOW] [code-review: standards] docs.yml: scope `pages: write`/`id-token: write` to the deploy job rather than workflow-top where the build job also receives them
