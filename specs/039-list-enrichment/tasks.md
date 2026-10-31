# Tasks: List Enrichment

**Input**: Design documents from `/specs/039-list-enrichment/`
**Tests**: Included — integration tests per endpoint (constitution VI).

## Phase 1: Backend — component rollup (P1) 🎯 MVP

- [x] T001 Regression test: `GET /components` returns `worstStatus` (ERROR> GONE>STOPPED>RUNNING) + `lastSeenAt` (max instance lastSeenAt) per row; nulls on zero-instance rows — `packages/backend/test/integration/` (components or catalog test)
- [x] T002 Add `worstStatus` (`eb.case()` correlated EXISTS chain) + `lastSeenAt` (`eb.fn.max`) scalar subqueries to the components list select in `packages/backend/src/services/component-catalog-service.ts` (pattern: `instanceCount` at ~line 151); surface both on the response rows

## Phase 2: Backend — team counts (P1)

- [x] T003 Regression test: `GET /teams` returns `memberCount` + `componentCount` per row (real zero, not missing) — `packages/backend/test/integration/` (team-lob or org test)
- [x] T004 Add `memberCount` (`persons.teamId` countAll) + `componentCount` (`components.teamOwnerId` countAll) subqueries to `selectTeams` in `packages/backend/src/services/org-service.ts` (pattern: `component-group-service.ts:57`); ensure LOB detail read carries them (teams list covers it)

## Phase 3: Contract + types

- [x] T005 Regenerate `docs/openapi.yaml` (ADR-104 — response fields added); run `pnpm --filter @componode/backend test -- api-docs-contract`
- [x] T006 Add `worstStatus`, `lastSeenAt` to the component API type and `memberCount`, `componentCount` to `TeamEntity` in `packages/frontend/src/api/types.ts`

## Phase 4: Frontend wiring + flag flip

- [x] T007 Wire new fields through `mapComponent` (worstStatus/lastSeenAt — prefer backend values; keep instance-derived fallback for detail payloads that already carry instances) in `api/mappers/catalog.ts`
- [x] T008 Flip `componentListHealth`, `componentListLastSeen`, `teamMemberCounts` to `true` in `ux/lib/flags.ts`; keep the honest null fallbacks for zero-data rows; drop the `(t as {...}).memberCount ?? "—"` casts in `org-detail.tsx` now the fields are typed
- [x] T009 Mapper unit test: component with backend `worstStatus`/`lastSeenAt` passes them through; team `memberCount`/`componentCount` flow to the LOB teams table cells

## Phase 5: Governance + ship

- [x] T010 Mark G21 + G22 RESOLVED (spec 039, flags flipped) in `researches/ux-rewrite-gaps.md`; update spec-queue block
- [x] T011 Update `docs/roadmap.md` — 039 under Shipped; Next entry revised (dashboard intelligence G23–G25 next)
- [x] T012 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; commit, push, PR

## Dependencies

- Phase 1, 2 parallel; Phase 3 needs Phase 1+2 field names; Phase 4 needs Phase 3; Phase 5 last.

---

## Phase 6: Review (code-review findings vs `main`)

- [x] T013 Wire teams-list `members`/`components` from the payload counts — the counts map never set `members`, so the column showed "—" forever (code-review: both axes, US2/FR-006)
- [x] T014 Align client severity fallbacks to ratified ERROR>GONE>STOPPED>RUNNING — `PRIORITY` in components-table and `RANK` in catalog.ts ranked GONE last (code-review: spec)
- [x] T015 Document `worstStatus` + `instanceCount` on the Component schema in `docs/openapi.yaml` (code-review: standards, ADR-104)
- [x] T016 Refresh stale flag comments in `ux/lib/flags.ts` (code-review: standards)
- [x] T017 Drop redundant `useAllComponents` fetch on teams index — componentCount now on payload (code-review: standards)
