# Tasks: Detail Reads + Feed Names

**Input**: `/specs/033-detail-reads-feed-names/` (spec, plan, contracts/)

**Stories**: US1 feed names (P1, gap G11) · US2 detail reads (P2, gaps
G7/G8/G9). Independent — either ships alone.

## Phase 1: US1 — Feed names (G11)

- [x] T001 [US1] Failing integration test `packages/backend/test/integration/audit-feed-names.test.ts` (testcontainers + loginAs harness per existing audit tests): seed a product + component + group + team/LOB; write entity + edge changes via services; assert `GET /audit/activity` rows carry `entityName`, edge rows carry `fromEntityName`/`toEntityName`, `component_instance` renders `name · environment`, `user` rows resolve `displayName ?? username`, deleted-entity and `settings`/`auth` rows return `entityName: null`; assert `GET /audit/entities/:type/:id` and `GET /importer-configs/:id/runs/:runId/changes` carry the same fields
- [x] T002 [US1] Contract fields in `packages/core/src/contracts/audit.ts`: `EntityChange += entityName?: string | null`; `EdgeChange += fromEntityName?: string | null, toEntityName?: string | null` (additive, nullable)
- [x] T003 [US1] Read-time name resolution in `packages/backend/src/services/audit-query-service.ts`: `ENTITY_NAME_SOURCES` map per contracts/feed-names.md; collect `(entityType → Set(id))` from entity rows + edge from/to on the paginated page; one `where id in (…)` per touched table (`component_instance` resolves `componentId` → `components.name` + `environment`); attach in `getActivityFeed`, `getEntityHistory`, `getRunChanges`; green T001
- [x] T004 [US1] Failing mapper tests in `packages/frontend/src/test/unit/ux-mappers.test.ts`: named entity row renders name; edge row renders `fromEntityName`/`toEntityName`; `entityName: null` falls back to `type:id`; run-change mapper uses `entityName` then falls back
- [x] T005 [US1] Mapper impl in `packages/frontend/src/api/mappers/dashboard.ts` (`entityName ?? entityType:entityId` entity rows; edge entityName from `fromEntityName`, summary names `toEntityName`) and `operations.ts` (`mapRunChange`: `c.entityName ?? c.entityId ?? c.entityType`); green T004

## Phase 2: US2 — Detail reads (G7/G8/G9)

- [x] T006 [US2] Failing integration test `packages/backend/test/integration/detail-reads.test.ts`: `GET /teams/:id` and `GET /lobs/:id` by id AND by slug, 404 unknown, 401 unauth; `GET /component-groups/:id` by slug, 404 unknown; UUID-shaped slug still resolves via slug fallback
- [x] T007 [US2] `getOrgEntity(table, idOrSlug)` id-or-slug resolution in `packages/backend/src/services/org-service.ts` (UUID-format → id first, slug fallback; else slug) + `GET ${base}/:id` inside `register()` in `packages/backend/src/routes/org.ts` — verifySession only, `NOT_FOUND` on miss; green T006 (org half)
- [x] T008 [US2] `getComponentGroup(idOrSlug)` same resolution in `packages/backend/src/services/component-group-service.ts`; green T006 (group half)
- [x] T009 [US2] Hooks: `detail` in the `orgHooks` factory (`useTeam`/`useLob`) in `packages/frontend/src/api/hooks/org.ts`; `useComponentGroup(idOrSlug)` in `packages/frontend/src/api/hooks/component-groups.ts`
- [x] T010 [US2] Rewire detail pages to direct reads: `packages/frontend/src/ux/app/teams/$slug.tsx`, `lobs/$slug.tsx`, `component-groups/$slug.tsx` — pass the route slug to the detail hook; retire list-and-match resolution on these pages

## Phase 3: Docs + gate

- [x] T011 openapi.yaml: `GET /teams/{id}`, `GET /lobs/{id}` (verifySession — no `x-permission`), `GET /component-groups/{id}` param doc (id-or-slug), `entityName`/`fromEntityName`/`toEntityName` on feed-item schemas; `pnpm docs:api`; route-coverage contract test green
- [x] T012 `researches/ux-rewrite-gaps.md`: G7/G8/G9/G11 → Resolved by spec 033; `docs/roadmap.md` shipped bullet + Next queue drops 033
- [x] T013 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green

## Dependencies & parallel

- US1 and US2 touch disjoint files — phases can run in either order or
  in parallel; both land before Phase 3.
- T001 before T002/T003 (test-first); T004 before T005; T006 before
  T007–T008.
- T009/T010 parallel-safe after T007/T008.
- MVP = Phase 1 alone (feed names — the user-visible half).

## Phase 4: Review

- [x] T014 Fix `getTeamMembers` in `packages/backend/src/services/org-service.ts`: after id-or-slug existence check, filter members by `team.id` (resolved row), not the raw `teamId` param — a slug request currently returns `200 {members:[]}`; add a regression case to `detail-reads.test.ts` (slug → members populated) (code-review: standards — HIGH)
- [x] T015 Replace raw-identifier fallbacks with clean kind labels per FR-005/SC-003 (`entityName ?? entityType` on entity rows and run changes; `fromEntityType`/`toEntityType` on edge endpoints — never `type:id` or a bare uuid); update `mapActivityItem`/`mapRunChange` and their tests in `ux-mappers.test.ts`; fix FR-007's contradictory `entityType:entityId` wording in spec.md to match (code-review: spec — HIGH)
- [x] T016 Extract a shared `isUuid`/`resolveIdOrSlug` helper (backend `src/utils/` or `src/lib/`) and replace all five UUID_RE copies — org-service.ts, component-group-service.ts, and the two actor-filter inline regexes in audit-query-service.ts (code-review: standards — MEDIUM)
- [x] T017 Zod-validate `:id` path params on the new/changed GET routes (org.ts `register()` GET, component-groups.ts GET) per ADR-095 boundary posture (code-review: spec — LOW)
- [x] T018 Remove the dead `key` param from `orgHooks` in `packages/frontend/src/api/hooks/org.ts` (drop `void key`, update factory call sites) (code-review: standards — LOW)
- [x] T019 Merge `fetchNames`/`fetchLabels` in audit-query-service.ts via a column parameter (code-review: standards — LOW)
- [x] T020 Note the detail-read identifier contract (id-or-slug on teams/lobs/groups vs slug-only on products/components) in `specs/033-detail-reads-feed-names/contracts/detail-reads.md` (code-review: standards — LOW)

## Phase 5: Review (round 2)

- [x] T021 `mapActivityItem`: name fallback uses friendly kind label when mapped, else raw `entityType` (deleted team must not render "other"); `mapRunChange`: map `component_instance`→`instance`, `digital_product`→`product` kinds and use the mapped kind as the name fallback (code-review: spec — MEDIUM)
- [x] T022 `GET /teams/:id/members` accepts slug via getOrgEntity — add Zod `:id` validation and switch its openapi param to `IdOrSlug` (code-review: standards — MEDIUM)
- [x] T023 Add a real `ActivityFeedItem` schema (oneOf entity/edge items incl. `entityName`/`fromEntityName`/`toEntityName`) in openapi.yaml and reference it on `/audit/activity` + `/audit/entities/{entityType}/{entityId}` (code-review: spec — LOW)
- [x] T024 Document `400 VALIDATION_FAILED` on the three detail GETs + members route in openapi.yaml (code-review: standards — LOW)
- [x] T025 Fix stale `type:id` fallback wording in researches/ux-rewrite-gaps.md G11 and plan.md D7 (code-review: spec — LOW)
