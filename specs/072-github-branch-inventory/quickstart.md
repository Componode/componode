# Quickstart: validating the GitHub branch/release inventory

**Feature**: `072-github-branch-inventory` | **Date**: 2026-11-12

End-to-end validation that the importer brings and presents full branch/version inventory. Two paths: unit-level (fast) and live/mock E2E.

## Prerequisites

- `pnpm install` at repo root (workspace already built once).
- For live validation: a GitHub PAT (`repo` + `read:org` scopes) and an org with repos that have multiple branches — e.g. `Componode/componode` (7 branches, only `main`+dependabot) or `Componode/v0-componode-dpam` (5 branches).
- For E2E: the Playwright stack (`pnpm e2e` in `playwright/` brings up mocks + app).

## 1. Unit validation (importer package)

```bash
cd packages/importer-github
pnpm test        # vitest — inventory shape, toggles, pagination, degradation
pnpm typecheck && pnpm lint && pnpm build
```

Expected: new tests prove (a) `details.branches` lists **every** mocked branch incl. `main`/unmapped names with `protected`/`isDefault`/`sha`; (b) `includeBranchInventory:false` omits the key while mapped branch instances still emit; (c) `includeBranchInstances:false` suppresses `branch:*` instances; (d) `details.releases`/`tags` paginate fully; (e) a 403 on `/branches` yields a `capabilities.branches=FORBIDDEN` marker and the run still completes; (f) `includeBranchActivity` adds `lastActivityAt` via per-branch `getBranch`.

## 2. Live validation (hub + real GitHub)

1. Run the stack (`docker compose up` or dev mode per `docs/deployment.md`/`docs/quickstart.md`).
2. Create/edit the GitHub importer config: `org` = `Componode`, token with `repo`+`read:org`, defaults for new toggles.
3. Trigger a run; wait for COMPLETED.
4. Open `http://localhost:3000/components/componode-3` (or the repo's slug) → the Details card shows a **GitHub** section:
   - Repo facts: default branch `main`, fork/archived flags, size, license, timestamps.
   - **Branches** table: all 7 branches (`main` + 6 `dependabot/*`) with SHA, protected badge, `default` badge on `main`, GitHub links.
   - **Releases/tags** tables populated from the repo's real releases/tags.
   - Instances table unchanged: still only environment-mapped branch instances (likely none for these repos — correct per spec-011).
5. Repeat for `v0-componode-dpam`: 5 branches visible.
6. Toggle `includeBranchActivity` on → re-run → `lastActivityAt` column populates (cost: +N calls/repo).
7. Toggle `includeBranchInventory` off → re-run → inventory gone from details (wholesale replace clears it), instances unaffected.

## 3. E2E validation (Playwright mock)

`playwright/mocks/github/server.ts` gains `/releases`, `/tags`, `/languages`, multi-branch fixtures, and env `protection_rules`. A journey spec (importers or journeys dir) asserts via API + UI:

- After a mock run, `GET /api/v1/components/{id}` → `details.branches` contains every fixture branch incl. non-environment names; `details.releases`/`tags` populated; env instance `rawConfig.githubEnvironment` carries protection rules.
- Component page renders the GitHub section (branches table rows visible).

Run: `cd playwright && pnpm e2e -- --grep <spec-name>` (targeted) or full `pnpm e2e` before PR.

## 4. Regression checks

- `docs:importers` regenerated region matches `config.ts` (run `pnpm docs:importers` then `docs:importers:check` if available); `docs:oracle:check` + `docs:sidebar:check` green.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for `importer-github` + `frontend`; root `pnpm build`.
- Existing github importer tests still pass (spec-011 instance behavior preserved by default-on `includeBranchInstances`).
