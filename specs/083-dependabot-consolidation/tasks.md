# Tasks: Dependabot PR Consolidation & Merge

**Input**: Design documents from `/specs/083-dependabot-consolidation/`

**Prerequisites**: plan.md, spec.md

**Tests**: No new test files — this is a dependency-merge feature. The
regression net is the existing suite (`pnpm test`), the Playwright workload
(`pnpm e2e`), and the mechanical checks below.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Materialize the eight dependabot branches locally and record
each one's exact manifest diff before touching anything.

- [x] T001 Fetch all eight dependabot head branches and record each tip SHA plus its non-lockfile file list: `dependabot/npm_and_yarn/prod-patch-23c82059ba` (#281), `dependabot/npm_and_yarn/dev-dependencies-4682077e46` (#282), `dependabot/npm_and_yarn/vitejs/plugin-react-6.3.0` (#283), `dependabot/npm_and_yarn/testing-library/jest-dom-8.0.0` (#284), `dependabot/npm_and_yarn/vite-8.3.8` (#285), `dependabot/npm_and_yarn/jsdom-31.0.1` (#286), `dependabot/npm_and_yarn/lucide-react-1.64.0` (#221), `dependabot/docker/node-26.13.1-alpine` (#261) — `git fetch origin <branch>` then `git diff --stat main...FETCH_HEAD` per ref
- [x] T002 Capture the exact `FROM` lines (including `@sha256:` digests) from PR #261's diff of `Dockerfile` and `Dockerfile.agent` for reuse in T009

---

## Phase 2: Foundational (merge mechanics — blocks everything)

**Purpose**: Get every approved bump onto `083-dependabot-consolidation`
with ONE coherent lockfile and any mechanical code fallout repaired.

**⚠️ CRITICAL**: Cherry-pick order matters — vite 8 (T004) must precede
plugin-react 6 (T005). For every cherry-pick conflict on `pnpm-lock.yaml`,
resolve by keeping the branch version (`git checkout --ours pnpm-lock.yaml`);
the file is regenerated in T010 anyway. For conflicts on `package.json`
manifests, resolve by hand so all pending bumps coexist.

- [x] T003 Cherry-pick the tip commit of `origin/dependabot/npm_and_yarn/prod-patch-23c82059ba` (#281, prod-patch group — 9 prod bumps)
- [x] T004 Cherry-pick the tip commit of `origin/dependabot/npm_and_yarn/vite-8.3.8` (#285, vite 7.3.7→8.3.8 in `package.json` and `packages/frontend/package.json`)
- [x] T005 Cherry-pick the tip commit of `origin/dependabot/npm_and_yarn/vitejs/plugin-react-6.3.0` (#283, @vitejs/plugin-react 5.2.0→6.3.0 in `packages/frontend/package.json`)
- [x] T006 [P] Cherry-pick the tip commits of `origin/dependabot/npm_and_yarn/testing-library/jest-dom-8.0.0` (#284) and `origin/dependabot/npm_and_yarn/jsdom-31.0.1` (#286) — different manifest lines, low conflict odds; resolve per the lockfile rule
- [x] T007 Cherry-pick the tip commit of `origin/dependabot/npm_and_yarn/dev-dependencies-4682077e46` (#282, dev-deps group — 13 bumps across 15 manifests); resolve manifest conflicts so all bumps coexist
- [x] T008 Apply the lucide-react 0.468.0→1.64.0 version change to `packages/frontend/package.json` (PR #221 is stale — edit the version directly rather than cherry-picking its old-base commit)
- [x] T009 Update the `FROM` lines in `Dockerfile` and `Dockerfile.agent` to the node:26.13.1-alpine lines captured in T002, preserving `@sha256:` digest pins
- [x] T010 Regenerate `pnpm-lock.yaml` coherently: `pnpm install` at repo root, then verify `pnpm install --frozen-lockfile` exits clean
- [x] T011 [US3] Conditional lucide fix — run `pnpm --filter @componode/frontend typecheck`; for every "has no exported member" error against `lucide-react`, rename the import to its v1 name (e.g. `Loader2Icon`→`LoaderCircleIcon`, `CheckCircle2Icon`→`CircleCheckIcon`, `EllipsisIcon`→`MoreHorizontalIcon` — confirm each target exists in the installed package); if fallout is larger than mechanical renames, revert the #221 bump and leave its PR open
- [x] T012 [US3] Conditional timeout fix — run `pnpm --filter @componode/core test`; if `test/schemas/bootstrap.test.ts` "accepts large wellformed documents — size limits are the API's, not the schema's" hits the 5000 ms timeout under vitest 5.1.1, raise that test's timeout to 15000 in the `it(...)` options

**Checkpoint**: All eight PRs' changes on branch, lockfile coherent,
typecheck/tests locally green or fallout catalogued.

---

## Phase 3: User Story 1 — One reviewed PR (Priority: P1) 🎯 MVP

**Goal**: Prove the consolidated branch carries every approved bump and
installs reproducibly.

**Independent Test**: `git diff main...HEAD` covers all eight PRs' manifest
changes; `pnpm install --frozen-lockfile` succeeds.

- [x] T013 [US1] Audit the consolidated diff: for each of the eight PRs, confirm its manifest bump is present via `git diff main...HEAD -- '**/package.json'` and `git diff main...HEAD -- Dockerfile Dockerfile.agent`; list any missing bump explicitly
- [x] T014 [US1] Verify `pnpm install --frozen-lockfile` passes from a clean state and `git status` shows no lockfile churn after it
- [x] T015 [US1] Run `pnpm audit --prod --audit-level=high`; result must be zero findings

**Checkpoint**: US1 verified — the branch IS the batch.

---

## Phase 4: User Story 2 — Coherent Vite 8 toolchain (Priority: P1)

**Goal**: Prove vite 8 + plugin-react 6 + vitest 5.1 + jsdom 31 + jest-dom 8
work together.

**Independent Test**: `pnpm build` and `pnpm test` pass in
`packages/frontend` with the new toolchain.

- [x] T016 [US2] Run `pnpm --filter @componode/frontend build` — must complete with no `ERR_PACKAGE_PATH_NOT_EXPORTED` (the #283 standalone failure mode)
- [x] T017 [US2] Run `pnpm --filter @componode/frontend test` — all unit tests pass under vitest 5.1.1 + jsdom 31 + jest-dom 8
- [x] T018 [US2] Run `pnpm --filter @componode/frontend lint` and `pnpm --filter @componode/frontend typecheck` — clean (prettier 3.10 / eslint 10.15 drift fixed mechanically if it appears)

**Checkpoint**: The coupled toolchain majors are proven together.

---

## Phase 5: User Story 3 — Majors with adaptations (Priority: P2)

**Goal**: Close out the conditional fallout and record the Node 26
divergence.

**Independent Test**: frontend typecheck has no lucide errors; both
Dockerfiles show digest-pinned node 26.

- [x] T019 [US3] Confirm T011 and T012 outcomes: if either conditional fix was needed it is committed; if #221 fallout exceeded mechanical renames the bump is reverted and documented
- [x] T020 [US3] Verify `Dockerfile` and `Dockerfile.agent` both read `FROM node:26.13.1-alpine@sha256:...` and note the `.nvmrc`/`engines` (Node 24) divergence for the PR body

**Checkpoint**: All three stories' work is on the branch.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Full repository gate + bookkeeping before the PR.

- [x] T021 Run the full workspace gate in CI order: `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`
- [x] T022 Run the generated-docs checks: `pnpm --filter @componode/backend docs:api:check`, `docs:importers:check`, `docs:schema:check`, `docs:sidebar:check`, `docs:oracle:check`; if `vitepress-openapi` 0.2.16 changed rendering, regenerate the affected `<!-- GENERATED -->` regions with the owning `docs:*` script
- [x] T023 Run the Playwright workload: `cd playwright && pnpm e2e` (requires Docker; if Docker is unavailable locally, document that and rely on a targeted frontend smoke instead) — ran full suite: 379 passed / 9 failed / 2 skipped; re-ran the 5 failing specs against a `main`-built stack and reproduced the identical 9 failures ⇒ all pre-existing workload drift (missing `bom_component_suggestions` registry entry, seed-count drift in pagination, component-bom timeouts, product-map narrow overflow, packages row expansion), zero new failures from this batch. Node 26 fallout found + fixed: `corepack` removed from Node ≥25 images → `npm install -g pnpm@9.15.2` in both Dockerfiles.
- [x] T024 Commit all remaining work (message file + `git commit -F`), `git push -u origin 083-dependabot-consolidation`
- [x] T025 Open the PR with `gh pr create --body-file` — body enumerates every absorbed bump (plan.md table), the Node 26 `.nvmrc` divergence, post-merge verification run, and "closes after merge" notes for #221 #261 #281 #282 #283 #284 #285 #286
- [x] T026 Close PR #262 as superseded by #282 with a pointer comment to the consolidation PR

---

## Phase 7: Review Findings

**Purpose**: Fixes from the two-axis code review (vs `main`) — run after Phase 6.

- [x] T027 Pin `lucide-react` and `vitepress-openapi` resolution to the assessed versions (1.64.0 / 0.2.16): `^`-ranges floated the lockfile to 1.78.0 / 0.2.19, both published <24 h ago — violates the ≥7-day supply-chain preference and escaped the per-PR assessment. Manifest `^` ranges preserved; re-verified frozen install, frontend typecheck + 572 tests, frontend build.
- [x] T028 Fix `pnpm docs:build` failure from vitepress-openapi ≥0.2.6 packaging (client bundle now externalizes `vitepress`; SSR resolves the server entry which lacks `useData`) — added `vite.ssr.noExternal: ["vitepress-openapi"]` to `docs-site/.vitepress/config.ts`; build completes and all docs checks still pass.
- [x] T029 Disclose in the PR body: the two version pins, the `noExternal` fix, the `corepack`→npm fix, the `.nvmrc`/`@types/node`-26 divergence, the bundled-majors deviation (sanctioned per plan.md Constraints), and the 9 pre-existing e2e failures (identical on `main`, incl. `bom_component_suggestions` registry drift)

---

## Dependencies & Execution Order

- **Phase 1 → 2 → verification phases**: strictly sequential — lockfile
  regen (T010) requires all manifest changes landed (T003–T009).
- **Within Phase 2**: T004 MUST precede T005 (plugin-react 6 needs vite 8);
  T006's two cherry-picks are order-free. T011/T012 are conditional on what
  T010's install + checks surface.
- **US phases (3–5)**: verification gates; run in order but each is
  independently checkable once Phase 2 is done.
- **Phase 6**: after all stories verified.

## Implementation Strategy

Single-pass chore: Setup → apply all bumps → one lockfile regen → fix
predicted fallout (T011/T012) → verify per story → full gate → PR.
No parallel staffing benefit; the only [P] task is T006's pair of
independent cherry-picks.

## Notes

- If any cherry-pick conflicts beyond the lockfile are unresolvable cleanly,
  fall back to applying that PR's version changes by editing manifests
  directly (T008 shows the pattern).
- Dependabot PRs are closed unmerged AFTER the consolidation PR merges;
  do not close them early.
