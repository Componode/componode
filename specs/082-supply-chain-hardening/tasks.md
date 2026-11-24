# Tasks: Supply-Chain Hardening (OpenSSF Scorecard Remediations)

**Input**: Design documents from `/specs/082-supply-chain-hardening/`

**Prerequisites**: plan.md, spec.md

**Tests**: Not applicable — no executable surface changes; verification is
the grep/oracle assertions in Phase 4 (constitution VI scope noted in
plan.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Paths are repo-root relative

---

## Phase 1: Setup

- [x] T001 Create branch `082-supply-chain-hardening` from `main`; create
  `specs/082-supply-chain-hardening/{spec,plan,tasks}.md`; point
  `.specify/feature.json` at `specs/082-supply-chain-hardening`; add the
  `082-supply-chain-hardening` bullet to `docs/roadmap.md` and append to
  the shipped-prose paragraph (081's entry is in flight on its own branch —
  append after the last shipped entry on main, 080; order reconciles at
  merge)

---

## Phase 2: User Story 1 - Actions SHA pins + token permissions (Priority: P1) 🎯 MVP

**Goal**: zero mutable action references; least-privilege default token

**Independent Test**: `grep -rn 'uses:.*@v[0-9]' .github/workflows` → 0;
every `uses:` has a 40-hex SHA + `# vX.Y.Z` comment

### Implementation for User Story 1

- [x] T002 [P] [US1] `ci.yml`: add top-level `permissions: contents: read`
  after `on:`; pin `actions/checkout` (×2) → v7.0.1, `pnpm/action-setup` →
  v6.1.1, `actions/setup-node` → v7.1.0,
  `actions/dependency-review-action` → v5.0.1 (SHAs in plan.md)
- [x] T003 [P] [US1] `release.yml`: add top-level
  `permissions: contents: read` (job-level `contents: write`,
  `pull-requests: write`, `packages: write` stay); pin `actions/checkout`
  (×2) → v7.0.1, `pnpm/action-setup` (×2) → v6.1.1, `actions/setup-node`
  (×2) → v7.1.0, `docker/setup-qemu-action` → v4.4.0,
  `docker/setup-buildx-action` → v4.4.1, `docker/login-action` → v4.8.0,
  `docker/build-push-action` → v7.4.0
- [x] T004 [P] [US1] `scorecard.yml`: bump existing pins to
  Dependabot-proposed versions — `actions/checkout` → v7.0.1 (#277),
  `ossf/scorecard-action` → v2.6.0 (#278), `actions/upload-artifact` →
  v7.0.2 (#280); pin `github/codeql-action/upload-sarif@v3` → v4.39.4
  (#279)
- [x] T005 [P] [US1] `docs.yml`: pin `actions/checkout` → v7.0.1,
  `pnpm/action-setup` → v6.1.1, `actions/setup-node` → v7.1.0,
  `actions/upload-pages-artifact` → v5.0.0, `actions/deploy-pages` → v5.0.1
  (top-level `permissions` block already present — unchanged)

**Checkpoint**: all 19 `uses:` SHA-pinned; both new top-level permissions
blocks in place

---

## Phase 3: User Story 2 - Container image digest pins (Priority: P1)

**Goal**: every `FROM` and compose `image:` carries `@sha256:`

**Independent Test**: `grep -rn '^FROM ' Dockerfile* playwright/Dockerfile*`
→ all lines contain `@sha256:`; compose `image:` lines likewise

### Implementation for User Story 2

- [x] T006 [P] [US2] Pin `FROM node:24.22.2-alpine` in `Dockerfile`,
  `Dockerfile.agent`, `playwright/Dockerfile.mocks` →
  `@sha256:a34ab6d7…867c8` (multi-arch index digest)
- [x] T007 [P] [US2] Pin `FROM mcr.microsoft.com/playwright:v1.64.1-noble`
  in `playwright/Dockerfile.runner` → `@sha256:2f05f8a7…768f`; the base
  image ships apt-packaged Node 26 without a corepack shim, so keep
  `npm install -g pnpm@9.15.2` with an explanatory comment
- [x] T008 [P] [US2] Pin compose images — `docker-compose.yml`:
  `postgres:16.11-alpine`, `caddy:2-alpine`;
  `playwright/compose.test.yml`: `postgres:16.11-alpine`, `caddy:2-alpine`,
  `dexidp/dex:v2.44.0` (Scorecard's Pinned-Dependencies check covers
  compose files)

**Checkpoint**: 4 `FROM` + 5 `image:` digest pins verified against
registry

---

## Phase 4: User Story 3 - LICENSE + SECURITY.md (Priority: P1) & verification

### Implementation for User Story 3

- [x] T009 [P] [US3] Add `LICENSE` at repo root — verbatim Apache License
  2.0 (fetched from apache.org; ends "END OF TERMS AND CONDITIONS" +
  APPENDIX) per ADR-002
- [x] T010 [P] [US3] Add `SECURITY.md` at repo root — supported versions
  (latest release + `main`), GitHub private vulnerability reporting
  (no mailto — no contact in repo), 72h ack / 30–90 day fix windows,
  scope notes (self-hosted; OIDC/importer credentials in scope)

### Verification

- [x] T011 `grep -rn 'uses:.*@v[0-9]' .github/workflows` → zero; every
  `uses:` 40-hex SHA; `git diff main -- .github/workflows` shows all pins
- [x] T012 `grep -rn '^FROM ' Dockerfile* playwright/Dockerfile*` → all
  `@sha256:`; compose `image:` lines pinned
- [x] T013 `pnpm --filter @componode/backend docs:oracle:check` green;
  `pnpm lint` green
- [x] T014 Commit `chore(security): scorecard supply-chain hardening …
  (spec 082)` + push branch; do NOT open a PR

---

## Dependencies & Execution Order

- Phase 1 (T001) first; US1/US2/US3 then fully parallel — disjoint files.
- Verification (T011–T014) last.

### Parallel Opportunities

- T002–T005 (one file each), T006–T008, T009–T010 all independent.

---

## Implementation Strategy

Single-pass chore: resolve all SHAs/digests up front (recorded in
plan.md), edit files, run grep + oracle verification, commit, push. No
PR, no Dependabot merges, no `packages/**` edits.
