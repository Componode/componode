# SWE Session Handoff

## Assignment

Implement the isolated Componode Playwright user-testing workload described by this folder and tracked in [`../specs/055-playwright-workload/tasks.md`](../specs/055-playwright-workload/tasks.md). This handoff is for later sessions using Devin's SWE model. This planning session has not implemented the test runner, mocks, Docker stack, or seed code.

## Mandatory first gate

The new `055-playwright-workload` worktree starts at commit `81fc186` (`053-component-check-summary`). The active `054-url-check-onboarding` worktree contains uncommitted work that was intentionally not copied.

Before implementing or running journeys that depend on first-instance recovery, composite URL Check auth fields, or the updated Credential/Import Agent role rules:

1. Confirm that the 054 feature changes have been committed and made available to the 055 worktree.
2. Do not copy, stash, cherry-pick, merge, or rebase the active user's uncommitted 054 changes without their direction.
3. Record the 054 integration commit and any resulting rebase/merge in `playwright/README.md`.
4. If 054 is not available, continue only with independent workload scaffolding and mark dependent tasks blocked.

## Required reading

Read these before implementation:

- Repository `AGENTS.md`, `.specify/memory/constitution.md`, and `CONTEXT.md`.
- `specs/055-playwright-workload/spec.md`, `plan.md`, and `tasks.md`.
- `playwright/implementation-plan.md`.
- `playwright/coverage-matrix.md` and `playwright/data/fixture-matrix.md`.
- `playwright/contracts/mock-api-contracts.md` and `playwright/research/official-references.md`.
- The relevant importer setup guides under `docs/importers/` and provider documentation linked by the mock contracts.

## Work protocol

1. Verify the current directory is the separate 055 worktree and `git status` does not show changes from the 054 worktree.
2. Work from the dependency-ordered tasks. Mark a task complete only after its acceptance criterion and verification pass; add discovered work to `tasks.md`.
3. Follow test-first practice: write or update the failing assertion, confirm it fails for the intended reason, implement, then refactor.
4. Keep all Playwright code, mocks, fixtures, test-only configuration, references, and operating documentation under `playwright/`.
5. Keep required spec-kit artifacts under `specs/055-playwright-workload/`. No additional product or CI changes are in scope.
6. Add dependencies only inside the standalone `playwright/` pnpm workspace. Pin versions, check release age against the repository policy, and commit that workspace's lockfile.
7. Keep runtime egress blocked. A mock failure must fail locally; it must never fall through to a real GitHub, Alibaba Cloud, Docker host, OIDC provider, or URL Check target.
8. Use the workload Compose project name `componode-pw`; preflight must fail if a prior debug stack exists, and cleanup must target only this project and its volumes.
9. Keep fake credentials, generated CA keys, enrollment tokens, browser storage state, reports, and traces in ignored paths beneath `playwright/`. Never print secret values or place them in fixtures, screenshots, or report attachments.
10. Keep the initial suite serial. Do not parallelize mutable importer scenarios or share credentials between independent runs.
11. Do not add CI jobs, push, create a PR, or propose a PR to `main`.

## Implementation order

The full task IDs and completion states live in `tasks.md`. The intended sequence is:

1. Satisfy the 054 integration gate and verify the 055 worktree.
2. Create the standalone workspace, local-secret ignore rules, and preflight/cleanup runner.
3. Build the internal Compose network and app/PostgreSQL/Caddy baseline; prove isolation before adding user data.
4. Add deterministic identities, seed operations, table coverage, and API pagination checks.
5. Implement provider mocks and importer journeys. Use GitHub for the single complete cross-run source-reconciliation scenario.
6. Add browser journeys for roles, authentication, organization, catalog, source administration, OIDC, and monitoring.
7. Add Hub and real Import Agent probe coverage, failure evidence, accessibility scans, browser smoke projects, and final documentation.
8. Run the full verification checklist and update every task and coverage entry.

## Completion gate

The handoff is complete only when the tasks are checked, the coverage matrix has no unexplained gaps, the normal developer stack remains unchanged after a full run, runtime network egress is blocked, no secrets appear in tracked files or artifacts, reports are generated, and the run/debug/cleanup instructions have been exercised from a clean checkout.
