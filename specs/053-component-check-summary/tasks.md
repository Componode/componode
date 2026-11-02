# Tasks: Component Check Summary

**Input**: Design documents from `/specs/053-component-check-summary/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test-first is non-negotiable (Constitution VI) — every story phase
writes failing tests before implementation.

**Organization**: Phases 3–5 map to spec user stories US1–US3; Phase 2 is the
shared backend payload both P1 stories depend on.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup — core contract surfaces

- [x] T001 [P] Add `UrlCheckSummary` to `packages/core/src/contracts/url-check.ts` — `{window: "24h", availability: number | null, p95: number | null, coverageGap: number, counts: {success: number; failure: number; missed: number}}` with the same formula comments as `UrlCheckMetrics` (missed counts as unsuccessful; percentile over SUCCESS only) — and extend `UrlCheckListItem` with `summary: UrlCheckSummary` (always present) and `recent: UrlCheckObservation[]` (≤12, scheduledAt desc); export `UrlCheckSummary` from `packages/core/src/index.ts`

## Phase 2: Foundational — bounded backend read path

**Purpose**: the extended list payload that US1 and US2 both consume.
No story work can begin until the payload exists.

- [x] T002 Write failing integration tests in `packages/backend/test/integration/url-checks-summary.test.ts` hitting `GET /components/:componentId/url-checks`: (a) each item carries `summary` with `window:"24h"`, `availability` = SUCCESS/(SUCCESS+FAILURE+MISSED) counting MISSED as unsuccessful, `p95` over SUCCESS durations only, `coverageGap` = MISSED/scheduled, and `counts`; (b) `recent` returns ≤12 observations `scheduledAt` desc per check; (c) a zero-observation check returns `summary.availability:null`, `p95:null`, `coverageGap:0`, `counts` all zero, `recent:[]`; (d) an all-MISSED window reports low availability with `coverageGap:1` distinguishable from endpoint failure; (e) a multi-check fixture returns correct per-check `summary`/`recent` in the single response
- [x] T003 Extend `listChecks` in `packages/backend/src/services/url-check-service.ts` with two constant-cost queries per research.md R2/R3: (1) `GROUP BY urlCheckId` over `url_check_observations` for `urlCheckId IN (:checks)` and `scheduledAt >= now()-24h` selecting `countAll().filterWhere` per outcome plus `percentile_cont(0.95) within group (order by case when outcome = 'SUCCESS' then "durationMs" end)` as `p95` (sql tagged template — no `sql.raw`/`sql.fragment`, ADR-084); (2) `row_number() over (partition by "urlCheckId" order by "scheduledAt" desc)` subquery filtered `rn <= 12`, rows mapped through `observationToApi`; merge both into each `UrlCheckListItem` — query count stays constant regardless of check count (FR-010)

**Checkpoint**: the list endpoint returns `summary` + `recent` for every check — US1 and US2 can proceed.

## Phase 3: US1 — Compact windowed summary per check row (P1)

**Goal**: each table row shows 24h availability and p95 latency, window- and
vantage-labeled, consistent with the detail page's definitions.
**Independent test**: render the card against a stubbed `useUrlChecks`
payload with summary data — every row shows both figures with "(24h)"
labeling without opening any detail page.

- [x] T004 [US1] Write failing unit tests in `packages/frontend/src/test/unit/url-checks.test.tsx`: (a) a row with `summary{availability:0.975,p95:340}` renders the availability percentage and `340 ms` under "(24h)"-labeled headers; (b) the card description still phrases vantage as "reachable from …"; (c) summary values render per row for a multi-check payload
- [x] T005 [P] [US1] Add `UrlCheckSummaryView` (`{windowLabel, availability, p95, coverageGap, counts}`) to `packages/frontend/src/ux/lib/view-types.ts`, extend `UrlCheckView` with `summary: UrlCheckSummaryView` and `recent: UrlCheckObservationView[]`, and map the new fields in `mapUrlCheckListItem` in `packages/frontend/src/api/mappers/monitoring.ts` preserving `null` → no-data semantics (never fabricate `0`/`100`)
- [x] T006 [US1] Render the summary cells in `packages/frontend/src/ux/components/catalog/url-checks-card.tsx`: new `Availability (24h)` and `p95 (24h)` `<TableHead>`s; availability formatted as a percentage, p95 as `N ms`; window label lives in the column header, vantage phrasing stays in the card description (FR-003)

**Checkpoint**: US1 independently delivers the at-a-glance summary.

## Phase 4: US2 — Bounded read path for the whole table (P1)

**Goal**: the dot strip rides the list payload; zero per-check observations
requests.
**Independent test**: render the card with a `useUrlCheckObservations` spy —
it is never invoked by table rows while dots still render from `check.recent`.

- [x] T007 [US2] Write failing unit test in `packages/frontend/src/test/unit/url-checks.test.tsx`: with a multi-check payload, `useUrlCheckObservations` is not called when `UrlChecksCard` renders, and the `Recent` column still shows one dot per `check.recent` entry oldest→newest
- [x] T008 [US2] Rework `RecentOutcomes` in `packages/frontend/src/ux/components/catalog/url-checks-card.tsx` to consume `check.recent` (reversed to oldest→newest) and delete the per-row `useUrlCheckObservations` call and its now-unused import; the shared `OutcomeDots` component is unchanged (detail page still uses it with its own history query)

**Checkpoint**: the table loads fully through the single list request.

## Phase 5: US3 — Honest empty, partial, and degraded states (P2)

**Goal**: no fabricated figures; coverage gaps distinguishable from endpoint
failures in the compact cells.
**Independent test**: fixtures for zero-observation, all-missed, and
all-failure windows — each renders its specified presentation.

- [x] T009 [US3] Write failing unit tests in `packages/frontend/src/test/unit/url-checks.test.tsx`: (a) zero-observation check shows the explicit no-data presentation in both summary cells — never `0%` or `100%`; (b) `counts.missed > 0` renders the availability figure with a warning-toned missed-slots annotation whose tooltip names the monitor-side coverage gap; (c) an all-failure window shows its true low availability with a `—` p95; (d) a disabled check keeps its disabled presentation without implying active probing
- [x] T010 [US3] Implement the state presentations in `packages/frontend/src/ux/components/catalog/url-checks-card.tsx`: no-data cell for `availability === null` (and for p95 `null`), the `· N missed` warning annotation + tooltip when `summary.counts.missed > 0`, all consistent with the detail page's coverage-gap phrasing

## Phase 6: Polish & cross-cutting

- [x] T011 [P] Update `docs/openapi.yaml` — `UrlCheckListItem` gains `summary` (`$ref` new `UrlCheckSummary` schema per data-model.md) and `recent` (array of `UrlCheckObservation`, ≤12); run `pnpm docs:api` so `docs/api.md` regenerates (ADR-104)
- [x] T012 [P] Update `docs/url-checks.md` — document the two compact columns, the fixed 24-hour window, the missed-slots coverage-gap annotation, and that the table reads through a single bounded list request (no per-row fetches)
- [x] T013 [P] Amend `researches/adrs/ADR-124-url-check-execution-surfaces.md` — Amendment 2: the component list read-path now embeds `summary` (24h availability/p95/coverageGap/counts) and `recent` (≤12 observations); update the API-surface enumeration so the ADR stays the accurate contract record
- [x] T014 [P] Update `docs/roadmap.md` — mark `053-component-check-summary` shipped and revise the Next entry per AGENTS.md roadmap sync (G3 remains the queued url-check gap)
- [x] T015 Run `pnpm docs:oracle:check` and `pnpm prettier --check` on touched docs; fix drift
- [x] T016 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in `packages/core`, `packages/backend`, `packages/frontend` and root `pnpm build`; confirm feature-051/052 monitoring tests still pass unchanged

## Phase 7: Convergence

- [x] T017 Add `SATURATED` to the `errorType` enums on `UrlCheckLatest` and `UrlCheckObservation` in `docs/openapi.yaml` — spec 052's error type is observable through `latest`, `recent`, and the observations read but undocumented per FR-011 (partial)

## Dependencies

- Phase 1 (T001) blocks Phase 2 — backend maps the contract type.
- Phase 2 (T002→T003) blocks Phases 3–5 — the frontend consumes the payload.
- US1 (Phase 3), US2 (Phase 4), US3 (Phase 5) touch the same two frontend
  files — run sequentially; tasks inside each phase are test → implement.
- Phase 6 depends on all story phases.

## Parallel Example

- T001 (core) is the only [P] in Phase 1.
- T005 (view types + mapper) can run parallel with T004's test authoring.
- Phase 6 docs tasks T011–T014 are all [P] — different files.

## Implementation Strategy

MVP = Phase 1 + Phase 2 + US1: the bounded payload plus the summary columns
already delivers the at-a-glance value; US2 removes the fan-out and US3
hardens presentation — each ships independently after the payload lands.
