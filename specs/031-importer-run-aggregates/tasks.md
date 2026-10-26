# Tasks: Importer Run Aggregates

**Input**: `/specs/031-importer-run-aggregates/` (spec, plan, contract)

## Phase 1: Backend (US1)

- [x] T001 Failing integration tests in `packages/backend/test/integration/run-aggregates.test.ts` (testcontainers + loginAs + csrf harness per users.test.ts): seed a config row + import_runs across days via direct `db` insert; assert per-day buckets (runs/failed counts, created/updated sums, zero-filled window, outside-window excluded, 401 unauth, empty series for unknown config)
- [x] T002 `listRunDayAggregates(configId, days)` in `packages/backend/src/services/import-run-service.ts`: Kysely `sql` tagged-template `substr("createdAt",1,10)` group-by (parameterized, ADR-084-ok), `count` runs, `sum` assetsCreated/assetsUpdated, `count filter status='FAILED'`; zero-fill to `days` ascending
- [x] T003 Route `GET /importer-configs/:id/run-aggregates` in `packages/backend/src/routes/importers.ts` — verifySession only, `days` clamp 1–90 default 14; green T001

## Phase 2: Frontend (US2)

- [x] T004 `useRunAggregates(configId, days?)` in `packages/frontend/src/api/hooks/importers.ts` → `GET /importer-configs/${id}/run-aggregates?days=`; map to `{day, created, updated, failed}[]`
- [x] T005 Failing component test in `packages/frontend/src/test/unit/ux-importer-card.test.tsx`: flag on + hook data → `RunHistory` renders (not the fallback notice)
- [x] T006 Wire `useRunAggregates` inside `importer-card.tsx` flag branch (replaces `i.history` prop for the live path); flip `historyAggregates` in `flags.ts`; green T005

## Phase 3: Docs + gate

- [x] T007 openapi.yaml `GET /importer-configs/{id}/run-aggregates` (no x-permission; `days` param; 200/401) + `pnpm docs:api`; contract test green
- [x] T008 `researches/ux-rewrite-gaps.md` G1 → Resolved by spec 031; `docs/roadmap.md` shipped bullet + Next queue drops 031
- [x] T009 `pnpm lint && pnpm typecheck` + targeted vitest + `pnpm build` green
