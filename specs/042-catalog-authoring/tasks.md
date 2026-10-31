# Tasks: Catalog Authoring

**Input**: Design documents from `/specs/042-catalog-authoring/`
**Tests**: Included — test-first (constitution VI).

## Phase 1: G29 backend — POST /components (US1)

- [x] T001 Integration test: `POST /components` creates with uuid v7 + audit event; slug conflict → controlled 4xx; validation errors; EDITOR required (VIEWER 403) — `packages/backend/test/integration/components.test.ts`
- [x] T002 Implement `POST /components` in `routes/components.ts`: `createComponentSchema` (Zod, writable fields per the Component contract), `createComponent` service (slug uniqueness → controlled error, uuid v7, audit event `component.create` via `toActor`), `requireRole("component:create")`; add `"component:create": "EDITOR"` to `PERMISSIONS`
- [x] T003 `docs/openapi.yaml` + `docs:api` regen for the new endpoint (ADR-104)
- [x] T004 ADR-054 amendment ratifying `component:create` in the permission matrix (+ index back-pointer)

## Phase 2: G29 frontend — create dialogs (US1)

- [x] T005 `useCreateComponent`/`useCreateComponentGroup` mutations if absent; "Add manually" dialog on `ux/app/components/index.tsx` (name, slug auto-derived editable, type, description, team-owner select per the schema); inline error surface; navigate/invalidate on success
- [x] T006 "New group" dialog on `ux/app/component-groups/index.tsx` wired to `POST /component-groups`
- [x] T007 Remove `manualEntityCreate` from `ux/lib/flags.ts`; unit test for create-dialog form behavior

## Phase 3: G31 — edge authoring on product detail (US2)

- [x] T008 Product detail relations: "Add relation" control (kind select; target search — products for composes/consumes-from filtered PLATFORM-only for consumes-from; components/groups for depends-on) + remove affordance on existing edges, via `useAddEdge`/`useRemoveEdge`; `409 CYCLE` + other errors surfaced with server message; gated on the edge permission
- [x] T009 Unit test: add-edge flow calls the hook, error path renders the message

## Phase 4: G32 — suggestions decided-history (US3)

- [x] T010 `ux/app/suggestions.tsx`: Pending/History tabs — History lists decided rows (status + decided timestamp, no pending actions, empty state) via `useSuggestions(status)`; remove `suggestionsHistory` flag
- [x] T011 Unit test: history view renders decided rows without accept/dismiss actions

## Phase 5: Governance + ship

- [x] T012 Mark G29/G31/G32 RESOLVED by spec 042 in `researches/ux-rewrite-gaps.md`; update `docs/ux.md` references (flag table, open decisions) + `docs/roadmap.md` (042 Shipped)
- [x] T013 `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; commit, push, PR — lint/typecheck/tests verified green (frontend 186 tests, backend integration + contract suites); commit/push/PR intentionally left to the caller

## Phase 6: Review (code-review findings vs `main`)

- [x] T014 Replace hand-rolled error mapping in `POST /components` route with `sendServiceError` — controlled-code validation + status-consistent fallback (code-review: standards, ADR-071)
- [x] T015 `useRemoveEdge` must also invalidate `["components"]`, `["component-groups"]`, `["dashboard"]` — removal leaves dependents/dashboard stale (code-review: spec, US2/AC1)
- [x] T016 Gate candidate-pool queries in `edge-authoring.tsx` on dialog open (`enabled`) — `useProducts({})` fetches on every detail view today (code-review: spec+standards)
- [x] T017 Import `CreateComponentInput` from `@componode/core` in `api/hooks/components.ts` instead of redeclaring (code-review: standards)
- [x] T018 Extract the duplicated slugify/SLUG_RE helper to `ux/lib/` shared by both create dialogs (code-review: standards)

## Dependencies

- Phase 1 precedes T005; Phases 2–4 parallel; Phase 5 last.
