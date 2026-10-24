# Tasks: Self-Service Profile Update

**Input**: Design documents from `/specs/030-self-service-profile/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/users-me.md

**Tests**: Included — test-first is non-negotiable (constitution VI).

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

- Core contracts: `packages/core/src/schemas/`, tests `packages/core/test/schemas/`
- Backend: `packages/backend/src/`, tests `packages/backend/test/integration/`
- Frontend: `packages/frontend/src/`, tests `packages/frontend/src/test/unit/`
- Docs: `docs/openapi.yaml`, `researches/ux-rewrite-gaps.md`

## Phase 1: Setup

- [x] T001 Verify clean baseline on `030-self-service-profile`: `pnpm install` then `pnpm --filter @componode/backend test -- users` passes before any change

## Phase 2: Foundational (blocking prerequisite)

- [x] T002 Write failing schema test in `packages/core/test/schemas/user.test.ts` covering `updateSelfSchema`: accepts `{displayName, email}` subset combos, rejects privileged/unknown keys (`role`, `isActive`, `teamId`, `username`, `password`, `id`) via `.strict()`, enforces email format and `displayName` ≤100 chars (mirrors `updateUserSchema` rules)
- [x] T003 Add `updateSelfSchema` + `UpdateSelfInput` export in `packages/core/src/schemas/user.ts` (zod object, `.strict()`), confirm T002 passes

## Phase 3: User Story 1 — Member updates own profile (P1)

**Goal**: any authenticated user PATCHes `{displayName, email}` to
`/api/v1/users/me` and gets their updated record; the profile settings
page submits through it for all roles.

**Independent test**: sign in as non-admin, PATCH `/users/me`, reload —
values persist; profile page editable with no admin fallback note.

- [x] T004 [US1] Write failing integration tests in `packages/backend/test/integration/users.test.ts` (reuse testcontainers + `loginAs` + csrf helpers): non-admin `PATCH /api/v1/users/me` with `{displayName, email}` → 200 and `GET /users/me` reflects values; empty `{}` body → 200 no-op; unauthenticated → 401 `AUTH_NO_SESSION`
- [x] T005 [US1] Add `PATCH /users/me` handler in `packages/backend/src/routes/users.ts` — `preHandler: [app.verifySession]` only, parse body with `updateSelfSchema` (400 `VALIDATION_FAILED` on failure), call `updateUser(req.user.id, parsed.data, toActor(req))`, 404 when session user is gone — mirroring `GET /users/me` error shapes; confirm T004 passes
- [x] T006 [P] [US1] Add `useUpdateSelf()` in `packages/frontend/src/api/hooks/users.ts` — `api("/users/me", { method: "PATCH", body: {displayName?, email?} })`; on success invalidate `["auth", "session"]` and `["users"]`
- [x] T007 [US1] Write failing component test in `packages/frontend/src/test/unit/ux-settings-profile.test.tsx`: non-admin session renders editable profile form whose save calls `/users/me`
- [x] T008 [US1] Update `packages/frontend/src/ux/app/settings/profile.tsx` to use `useUpdateSelf` for all roles (drop the `user.role === "ADMIN"` fork); flip `profileSelfEdit` to `true` in `packages/frontend/src/ux/lib/flags.ts` and remove the read-only fallback/fieldset/footerNote so the form is always editable; confirm T007 passes

## Phase 4: User Story 2 — Self-edit cannot escalate (P2)

**Goal**: privileged or unknown fields are rejected; nothing partially
applies; no route can address another record.

**Independent test**: PATCH `/users/me` with each privileged key → 400
with the record unchanged; admin `PATCH /users/:id` unchanged.

- [x] T009 [US2] Write failing integration tests in `packages/backend/test/integration/users.test.ts`: `PATCH /users/me` bodies containing `role`, `isActive`, `teamId`, `username`, `password`, or `id` each → 400 `VALIDATION_FAILED` and the user record is unchanged afterward; a non-admin's admin-path `PATCH /users/:id` still → 403 (boundary unchanged)
- [x] T010 [US2] Confirm T009 passes against the strict schema from T003 — add hardening only if a case fails (e.g., verify Fastify resolves static `/users/me` over `/users/:id` for PATCH: send PATCH to `/api/v1/users/me` as non-admin and assert it does not hit the admin route)

## Phase 5: User Story 3 — Self-edits audited (P3)

**Goal**: self-service updates write entity-change audit records
attributed to the caller, identical in shape to admin updates.

**Independent test**: non-admin self-update → activity feed shows the
change with that user as actor.

- [x] T011 [US3] Write failing integration test in `packages/backend/test/integration/users.test.ts` (or `audit-feed.test.ts` if it fits the harness better): after a non-admin `PATCH /users/me`, the audit feed contains a `user` entity change whose actor is the caller and whose `changes` list the modified fields
- [x] T012 [US3] Confirm T011 passes via the existing `updateUser` → `writeEntityChange` path; only if it fails, fix attribution rather than duplicating audit logic

## Phase 6: Polish & cross-cutting

- [x] T013 Add `patch` under `/users/me` in `docs/openapi.yaml` — no `x-permission` (authenticated-only, same as `GET /users/me`), request `{displayName?, email?}`, responses 200 `{user}` / 400 / 401 / 404 per `contracts/users-me.md`; run `pnpm docs:api` to regenerate `docs/api.md`; confirm the backend openapi contract tests pass
- [x] T014 Mark G14 **Resolved by spec 030** in `researches/ux-rewrite-gaps.md` (keep the entry, update status per registry convention)
- [x] T015 Update `docs/roadmap.md` shipped/next entries if the feature completes in this change (per AGENTS.md roadmap sync)
- [x] T016 Run full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green

## Dependencies

- T001 → T002/T003 (foundational schema) → Phase 3–5
- T005 depends on T003 (schema) and T004 (failing test)
- T008 depends on T006 (hook) and T007 (failing test)
- Phases 3 → 4 → 5 are sequential by priority but share the same route;
  US2/US3 are test-only phases that harden/verify what US1 built
- Phase 6 runs after all story phases

## Parallel execution

- T006 can run in parallel with T004/T005 (frontend hook vs backend route — different files)
- T013 can run in parallel with Phase 5 (docs vs audit test)

## Implementation strategy

- **MVP**: Phases 1–3 (US1) — the endpoint + flag flip alone resolves the gap
- US2/US3 add verification depth without new surface
- Phase 6 keeps ADR-104 and the gap registry consistent with the shipped code

## Phase 7: Review

- [x] T017 Add integration cases in `packages/backend/test/integration/users.test.ts`: an EDITOR-role user self-updates via `PATCH /users/me` → 200, and an ADMIN user self-updates via `PATCH /users/me` → 200 (US1/AC4, SC-001 — all roles covered, not just VIEWER) (code-review: spec)
- [x] T018 Fix displayName clearing in `packages/frontend/src/ux/app/settings/profile.tsx`: send `displayName` verbatim (allowing `""` to clear, matching the API/admin-path semantics — the schema accepts empty displayName) while keeping `email` as `|| undefined` (empty email is not clearable via the API); add a component case in `packages/frontend/src/test/unit/ux-settings-profile.test.tsx` asserting a cleared displayName submits `""` (spec edge case: clearing follows the same rules as the admin update path) (code-review: spec)
- [x] T019 Normalize cleared displayName to a single representation in `packages/backend/src/services/user-service.ts`: `""` → `null` inside `updateUser` (persons.displayName is nullable, createUser already stores null, and `displayName ?? username` fallbacks in audit/avatar surfaces break on `""`); add an integration case in `packages/backend/test/integration/users.test.ts` asserting PATCH `{displayName: ""}` → 200 with `user.displayName === null` (code-review: standards)
