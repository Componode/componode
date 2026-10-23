# Tasks: Frontend UX Rewrite (v0 Design Baseline)

**Input**: Design documents from `/specs/029-ux-rewrite/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/wiring.md, quickstart.md

**Prototype reference**: `github.com/Componode/v0-componode-dpam` pinned at `9b040bc` (local clone `D:\Repositories\v0-componode-dpam`). Paths below written as `v0:…` refer to that repo.

**Port mechanics** (apply on every ported file, from research.md): drop `"use client"`; `next/link`→`react-router-dom` Link; `next/navigation`→React Router hooks; `next/image`→`<img>`; `radix-ui` unified import→existing `@radix-ui/*` packages; drop `@vercel/analytics`; no server components/actions — data via TanStack Query only.

## Phase 1: Setup

- [x] T001 Verify local clone `D:\Repositories\v0-componode-dpam` is at pinned commit `9b040bc` (`git -C <clone> rev-parse HEAD`) and record the SHA in `specs/029-ux-rewrite/plan.md` if it moved
- [x] T002 [P] Audit prototype imports vs `packages/frontend/package.json`; add missing `@radix-ui/*` packages or other needed deps via `pnpm add` inside `packages/frontend` (`^` ranges, ≥7-day-old releases); do NOT add `@vercel/analytics`, `input-otp`, or `next`
- [x] T003 [P] Create `packages/frontend/src/ux/` skeleton (`app/`, `components/`, `lib/`) and mount a `/ux/*` subtree in `packages/frontend/src/routes.tsx` wrapped in the existing `authed()` guard, rendering a stub index page at `/ux`
- [x] T004 Port design tokens: merge `v0:app/globals.css` token block into the frontend stylesheet (`packages/frontend/src/index.css` or a dedicated `src/ux/styles.css` imported only by the `/ux` tree); resolve `tw-animate-css` vs `tailwindcss-animate` per research.md

## Phase 2: Foundational (blocking all stories)

- [x] T005 Port `v0:components/ui/*` shadcn primitives into `packages/frontend/src/ux/components/ui/` — reuse existing `src/components/ui/*` equivalents where they already exist (merge variants rather than duplicate)
- [x] T006 Port shared patterns into `packages/frontend/src/ux/components/patterns/`: `PageHeader`, `DangerZone`, `ConfirmDialog`, `EntityHistory`, `ActivityFeed`, `ProviderMark`, form shell, list editors (from `v0:components/patterns/`, `v0:components/forms/`)
- [x] T007 [P] Port `v0:lib/domain.ts` (status metadata) and `v0:lib/format.ts` into `packages/frontend/src/ux/lib/`; verify `INTERRUPTED` run status is covered in status metadata
- [x] T008 [P] Create `useValidatedTab` hook in `packages/frontend/src/ux/lib/use-validated-tab.ts` — wraps `useSearchParams`, validates against a tab list, falls back to `tabs[0]`; write unit test first in `src/test/unit/use-validated-tab.test.ts`
- [x] T009 [P] Create `packages/frontend/src/ux/lib/flags.ts` gap-flag registry (all off) AND seed `researches/ux-rewrite-gaps.md` with the 10 gaps from `specs/029-ux-rewrite/data-model.md`
- [x] T010 Port the app shell: `v0:app/(app)/layout.tsx` + `v0:lib/nav.ts` → `packages/frontend/src/ux/ux-shell.tsx` (sidebar, nav, theme via existing `ThemeProvider`); reuse `v0:components/app/*`
- [x] T011 [P] Write failing mapper unit tests for `mapProduct`, `mapComponent`, `mapComponentInstance`, `mapComponentGroup` in `packages/frontend/src/test/unit/mappers.test.ts` — null fallbacks, enum narrowing→neutral badge, `componentCount`/`durationSec` derivations
- [x] T012 Implement the entity mappers in `packages/frontend/src/api/mappers/` (one file per entity) until the tests pass

## Phase 3: [US1] Catalog read paths (P1)

**Goal**: dashboard + products/components/groups list & detail serving live API data with all five states.

**Independent test**: `/ux` → products → product detail → component detail → component-group detail on real data; bogus slug → not-found; `?tab=zzz` → first tab.

- [x] T013 [P] [US1] Port `v0:components/dashboard/*` → `src/ux/components/dashboard/`; wire `/ux` index to `api/hooks/dashboard.ts`
- [x] T014 [P] [US1] Port products list + `v0:components/products/product-detail.tsx` → `src/ux/`; wire `GET /products`, `GET /products/:slug` via existing hooks through `mapProduct`
- [x] T015 [P] [US1] Port components list + `v0:components/catalog/component-detail.tsx` → `src/ux/`; wire `GET /components`, `GET /components/:slug` through `mapComponent`/`mapComponentInstance`
- [x] T016 [P] [US1] Port component-groups list + `v0:app/(app)/component-groups/[slug]/page.tsx`; resolve slug→id in the read hook per contracts/wiring.md; record the slug-lookup gap in `researches/ux-rewrite-gaps.md`
- [x] T017 [US1] Port remaining list surfaces: suggestions queue (`/ux/suggestions`), activity (`/ux/activity`) via existing `suggestions.ts`/`audit.ts` hooks
- [x] T018 [US1] Port `v0:app/(app)/standards` + `standards/wiring` + `design-system` surfaces into `/ux/standards*` (baseline reference pages, `authed` like the rest)
- [x] T019 [US1] State-matrix check per US1 route: loading/empty/error/not-found/forbidden all render; add a smoke test per route in `src/test/unit/` mocking query states

## Phase 4: [US2] Product authoring (P2)

**Goal**: create/edit/import products, promote components, entity history — full mutation wiring.

**Independent test**: create product → edit → bulk import with bad row → promote component → open history.

- [x] T020 [P] [US2] Write failing mapper tests for `PromoteToPlatformInput` assembly and import-result rows in `src/test/unit/mappers.test.ts`
- [x] T021 [US2] Port `v0:components/products/product-form.tsx` → `/ux/products/new` + `/ux/products/:slug/edit`; wire `POST /products` + `PATCH /products/:slug` mutation hooks (create if absent in `api/hooks/products.ts`); slug generated from name, locked after create
- [x] T022 [US2] Port `v0:components/products/import-products.tsx` → `/ux/products/import`; wire the bulk-import endpoint; render per-row API errors. If no bulk endpoint exists: flag behind `flags.ts` + gap entry
- [x] T023 [US2] Port `v0:components/patterns/entity-history.tsx` usage → `/ux/products/:slug/history` + `/ux/components/:slug/history` via `GET /audit?entityKind=…&entityId=…`
- [x] T024 [US2] Port `v0:components/components/promote-form.tsx` → `/ux/components/:slug/promote`; wire `GET /components/:slug/dependents` + `POST /components/:id/promote-to-platform`; if dependents endpoint missing → flag + gap entry

## Phase 5: [US3] Import operations (P3)

**Goal**: importers CRUD + run detail + agents + suggestions fully live.

**Independent test**: create agent-bound importer config → run → open run detail → cancel; rotate agent token (shown once).

- [ ] T025 [P] [US3] Write failing mapper tests for `mapImporterConfig` (`scheduleLabel` from cron, `credentialLabel` join), `mapImportRun` (nullable `startedAt`, `durationSec`, `cancelRequestedAt`→cancelling), `mapImportAgent` in `src/test/unit/mappers.test.ts`
- [ ] T026 [P] [US3] Implement the operations mappers in `src/api/mappers/` until tests pass
- [ ] T027 [US3] Port importers list + `v0:components/importers/importer-detail.tsx` → `/ux/importers*`; run-now/enable/edit/delete wired; history chart behind `flags.historyAggregates` + gap entry
- [ ] T028 [US3] Port `v0:components/importers/importer-form.tsx` → `/ux/importers/new` + `/ux/importers/:id/edit`: scope fields rendered from `ImporterManifest.configSchema` (never hardcoded), `credentialIds` linking, agent execution binding honoring `agentIncompatible`
- [ ] T029 [US3] Port `v0:components/importers/run-detail.tsx` → `/ux/importers/:id/runs/:runId`: phases, errors, cancel with cancelling state; changes feed behind `flags.runChangeFeed` + gap entry
- [ ] T030 [US3] Port `v0:components/agents/*` → `/ux/agents` + `/ux/agents/:id` (overview/policy/sessions/activity tabs): save policy, rotate token (shown once in dialog, never persisted), revoke, delete-while-bound 409; ops panel surfaces `reportedStatus`/`lastHeartbeatAt`/`lastDisconnectReason` null-first-class
- [ ] T031 [US3] Wire `/ux/suggestions` accept/dismiss to the real decisions API (EdgeSuggestion status transitions)

## Phase 6: [US4] Administration (P4)

**Goal**: users/sessions/credentials/teams/lobs/settings/OIDC fully wired; gaps flagged.

**Independent test**: role change on another user OK, own role → 403 surfaced; AGENT_MANAGED credential sends refs only; team/LOB detail via filtered-list strategy.

- [ ] T032 [P] [US4] Write failing mapper tests for `mapUser` (nullable displayName/email), `mapSession` (`current` derived, gap fields), `mapCredential` (masked `keyHints`, `usedBy`, expired rule), `mapAuditEvent` (unknown-union fallback) in `src/test/unit/mappers.test.ts`
- [ ] T033 [P] [US4] Implement the admin mappers in `src/api/mappers/` until tests pass
- [ ] T034 [US4] Port users list + `v0:components/admin/user-detail.tsx` → `/ux/users*` (overview/sessions/activity tabs): role PATCH (self → API 403 shown), deactivate/reactivate, revoke session; "Send password reset" behind `flags.passwordReset` + gap entry; confirm audit `actor` filter param vs backend (else gap entry)
- [ ] T035 [US4] Port sessions list → `/ux/sessions`; device/location/owner columns behind flags + gap entries; `current` derived
- [ ] T036 [US4] Port credentials list + `v0:components/admin/credential-detail.tsx` + `credential-form.tsx` → `/ux/credentials*`: masked `keyHints` only, test-connection, rotate form, revoke, delete-409; `AGENT_MANAGED` sends `{env|file}` refs never values; usage list uses `?credentialId=` when API exposes it (else flag + gap)
- [ ] T037 [US4] Port teams/lobs lists + detail pages → `/ux/teams*`, `/ux/lobs*`: detail resolved via filtered-list strategy per contracts/wiring.md; edit/delete dialogs behind flags + gap entries (endpoints missing)
- [ ] T038 [US4] Port settings section → `/ux/settings/*` (profile, appearance, authentication, security, session-policy, notifications, workspace, advanced) wired to `api/hooks/settings.ts`/`password.ts`
- [ ] T039 [US4] Port `v0:components/auth/oidc-callback.tsx` replacing `packages/frontend/src/pages/oidc-callback.tsx` in place (backend redirects to the fixed path); render `?error=` states
- [ ] T040 [US4] Port the prototype login screen replacing `src/pages/login.tsx` in place (drop the login stub; real session via existing auth hooks); remove `SessionProvider.setRole`, `generateEnrollmentToken()`, `<your-hub-host>` placeholders wherever ported

## Phase 7: [US5] Baseline & polish

**Goal**: shared-pattern reuse verified; baseline documented.

- [ ] T041 [US5] Sweep `src/ux/` for hardcoded colors/status labels and re-implemented patterns; unify onto `ux/lib` metadata + shared patterns
- [ ] T042 [US5] Accessibility pass: every icon-only button has an accessible name; focus order/keyboard preserved (spot-check tabbed pages, dialogs, DangerZone)
- [ ] T043 [US5] Rewrite `docs/ux.md` as the v1.1.0 UX/UI baseline (tokens, patterns, state matrix, `?tab=` convention, mapper rule); record the gap-governance rule (gaps → `researches/` control file → next specs) in `AGENTS.md` or `docs/` development guide per FR-016a

## Phase 8: Cutover & verification

- [ ] T044 Gap audit: every flag in `src/ux/lib/flags.ts` has a detailed entry in `researches/ux-rewrite-gaps.md`; every fixture import is gone from the shipped route set (`grep -r mock-data src/ux` empty)
- [ ] T045 Cutover: `/ux` tree becomes `/` in `routes.tsx`; delete `src/pages/` + retired `src/components/` (keep pieces still imported by `src/ux/`); `/ux` paths redirect or 404 cleanly; update `authed` role mapping on the new route table
- [ ] T046 Full verification: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; walk the quickstart.md scenario list; `docs/roadmap.md` updated (029 shipped under v1.1.0; gap specs listed as next step)

## Dependencies

- Phase 1 → Phase 2 → stories. Story order: US1 → US2 → US3 → US4 → US5 (spec priorities). Within a story: tests → mappers → ports → wiring.
- Phase 8 requires ALL stories complete.

## Parallel examples

- T002/T003/T004 (setup), T007/T008/T009/T011 (foundation), list-page ports in Phase 3 (T013–T016), mapper test/impl pairs (T025/T026, T032/T033), admin page ports (T034–T038).

## Implementation strategy

MVP = through Phase 3 (US1): the staged `/ux` tree already demonstrates the design on live data. Each story merges to `release/1.1.0`-bound branch independently; Phase 8 is the single cutover change. Test-first per constitution VI: mapper tests precede mappers; state smokes precede or accompany each ported route.
