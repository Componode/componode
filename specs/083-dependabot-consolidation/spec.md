# Feature Specification: Dependabot PR Consolidation & Merge

**Feature Branch**: `083-dependabot-consolidation`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Assess the open Dependabot PRs, review if they are
easy to merge and what needs to be tested after, and for the ones that will be
merged create a new branch to concentrate all of them." Assessment outcome
(user-confirmed scope): consolidate all eight mergeable PRs — #281
(prod-patch group), #282 (dev-dependencies group), #283
(@vitejs/plugin-react 6), #284 (@testing-library/jest-dom 8), #285 (vite 8),
#286 (jsdom 31), #221 (lucide-react 1), #261 (node 26 alpine) — onto a single
branch, with #262 closed as superseded by #282.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintainer lands the dependency queue as one reviewed PR (Priority: P1)

The repository has nine open Dependabot PRs, every one of them touching
`pnpm-lock.yaml`. Merging them sequentially guarantees lockfile conflicts and
eight separate CI/review cycles; several are also coupled (the React plugin
bump only builds on the Vite 8 bump) or stale. The maintainer needs a single
branch that carries every approved bump, one regenerated lockfile, and one
green CI run, after which the individual bot PRs can be closed.

**Why this priority**: It is the entire point of the feature — replacing a
conflict-prone, partially-red PR queue with one verified change.

**Independent Test**: `git diff main...HEAD` on the consolidation branch
contains every manifest version change from the eight source PRs and a single
coherent `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` succeeds.

**Acceptance Scenarios**:

1. **Given** the eight approved Dependabot PRs, **When** the consolidation
   branch is produced, **Then** each PR's manifest bump is present and no
   dependabot branch merge conflicts remain.
2. **Given** the merged manifests, **When** dependencies are installed with
   `pnpm install --frozen-lockfile`, **Then** installation succeeds against
   the regenerated single lockfile.
3. **Given** the consolidation PR is open, **When** CI completes, **Then**
   the `check`, `dependency-review`, and `CodeQL` statuses are green.

---

### User Story 2 - The frontend toolchain lands on one coherent Vite major (Priority: P1)

Vite 8 (#285), @vitejs/plugin-react 6 (#283), vitest 5.1 (inside #282),
jsdom 31 (#286), and @testing-library/jest-dom 8 (#284) are one coupled
toolchain: plugin-react 6 imports a Vite-8-only export and fails standalone
against Vite 7. The maintainer needs them to land together so the frontend
build and test runner stay internally consistent.

**Why this priority**: #283 is unmergeable alone; bundling the whole
toolchain is the only path that keeps every intermediate state green.

**Independent Test**: `pnpm build` and `pnpm test` succeed in
`packages/frontend` with vite 8, plugin-react 6, vitest 5.1, jsdom 31, and
jest-dom 8 installed together.

**Acceptance Scenarios**:

1. **Given** plugin-react 6 alongside vite 7 (the #283 failure mode),
   **When** vite 8 is applied on the same branch, **Then** the frontend
   production build completes without `ERR_PACKAGE_PATH_NOT_EXPORTED`.
2. **Given** vitest 5.1 and jsdom 31, **When** the frontend unit suite runs,
   **Then** all tests pass within their configured timeouts.

---

### User Story 3 - Majors land with their required adaptations (Priority: P2)

Two bumps change public surface: lucide-react 1 (#221) removed brand icons
and may have dropped deprecated icon aliases the frontend imports, and the
Node 24 → 26 Alpine base-image bump (#261) moves the production runtime two
majors while `.nvmrc` and `engines` still target 24. The maintainer needs any
code fallout fixed and the runtime divergence explicitly recorded so a
follow-up can align the dev toolchain.

**Why this priority**: Both were assessed as mergeable-with-work rather than
trivial; they ship only if the fallout is mechanical and small.

**Independent Test**: `pnpm typecheck` over `packages/frontend` reports no
missing lucide-react exports, and both Dockerfiles reference
`node:26.13.1-alpine` pinned to a registry digest.

**Acceptance Scenarios**:

1. **Given** lucide-react 1 installed, **When** the frontend typechecks and
   builds, **Then** every icon import resolves (renames applied where
   exports were removed).
2. **Given** the two Dockerfiles bumped to node 26, **When** the change is
   reviewed, **Then** each `FROM` line remains digest-pinned and the
   `.nvmrc`/`engines` divergence is documented in the PR body for a
   follow-up.

---

### Edge Cases

- The dev-dependencies group carries vitest 5.1.1, whose CI run showed a
  single 5000 ms test-timeout failure on a deliberately large schema
  stress test; if it reproduces locally the test's timeout is raised rather
  than the assertion weakened.
- prettier 3.10 or eslint 10.15 may introduce formatting/rule drift; lint
  must pass unmodified-code or with the minimal mechanical fixes.
- vitepress-openapi 0.2.16 (inside #282) regenerates API docs differently;
  the generated-docs consistency checks must pass, regenerating outputs if
  the tool's rendering changed.
- lucide-react 1 may have removed deprecated aliases actually imported by
  the frontend (e.g. `Loader2Icon`, `CheckCircle2Icon`); unresolved exports
  are renamed to their v1 equivalents — if the fallout is larger than
  mechanical renames the bump is dropped from this batch.
- Peer-dependency gaps (e.g. @tailwindcss/vite or testcontainers against
  vite 8 / vitest 5.1) surface at install; they are resolved inside the
  regenerated lockfile or the offending bump is excluded and its PR left
  open.
- Node 26 in the Docker images is unverified by CI (no image build job);
  the PR body must call this out.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single branch MUST carry the manifest version changes of all
  eight approved Dependabot PRs: #281, #282, #283, #284, #285, #286, #221,
  and #261.
- **FR-002**: `pnpm-lock.yaml` MUST be regenerated once on the consolidation
  branch and be consistent with every modified `package.json` (verified by
  `pnpm install --frozen-lockfile`).
- **FR-003**: The vite 8 and @vitejs/plugin-react 6 bumps MUST land in the
  same change; neither may be merged independently of the other.
- **FR-004**: Any code or config fallout from the applied majors (removed
  lucide-react exports, test timeouts, lint/format drift) MUST be corrected
  inside the consolidation change.
- **FR-005**: Both `Dockerfile` and `Dockerfile.agent` MUST move to
  `node:26.13.1-alpine` while preserving the digest pin
  (`image@sha256:...`).
- **FR-006**: The branch MUST pass the full repository verification gate:
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
  `pnpm audit --prod --audit-level=high`, and all generated-docs consistency
  checks (`docs:api:check`, `docs:importers:check`, `docs:schema:check`,
  `docs:sidebar:check`, `docs:oracle:check`).
- **FR-007**: The existing Playwright workload MUST pass against the updated
  stack (`pnpm e2e` in `playwright/`), covering the frontend surface the
  vite/lucide/jsdom majors touch.
- **FR-008**: PR #262 MUST be closed as superseded by #282; each absorbed
  Dependabot PR MUST be closable with a pointer to the consolidation PR
  after it merges.
- **FR-009**: The consolidation PR body MUST enumerate every absorbed bump,
  the runtime divergence introduced by #261 (`.nvmrc`/`engines` remain on
  Node 24 while images run Node 26), and the post-merge verification that
  was run.

### Key Entities

- **Consolidation branch**: the single feature branch carrying every
  approved bump plus one regenerated lockfile.
- **Absorbed PR**: a Dependabot PR whose manifest changes are reproduced on
  the consolidation branch and that is closed unmerged after it lands.
- **Verification gate**: the ordered lint → typecheck → test → build →
  audit → docs-checks → e2e sequence defined by CI and AGENTS.md.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Exactly one PR replaces eight open Dependabot PRs; after merge,
  the Dependabot queue contains zero unmerged PRs from this batch.
- **SC-002**: 100% of the CI checks required by branch protection pass on
  the consolidation PR on a clean run (no retried jobs).
- **SC-003**: `pnpm audit --prod --audit-level=high` reports zero high-or-
  above vulnerabilities on the merged dependency set.
- **SC-004**: Zero merge-conflict resolutions are needed in `pnpm-lock.yaml`
  after the single regeneration (no residual conflict markers or duplicated
  dependency entries).

## Assumptions

- The assessment already reviewed each PR's release notes and CI state;
  patch/group bumps are treated as safe per AGENTS.md dependency rules, and
  the three majors included were explicitly approved for bundling by the
  maintainer.
- Dependabot PRs are closed unmerged after the consolidation lands;
  Dependabot will confirm on its next run that the versions are satisfied.
- The `.nvmrc`/`engines` alignment to Node 26 is deliberately out of scope —
  a dedicated follow-up — while the container images move first.
- No application feature behavior changes; regressions would only surface
  through the existing test, build, and e2e suites.
