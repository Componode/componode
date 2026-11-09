---
description: "Task list for spec 069 — e2e spec debt + list-standards cleanup"
---

# Tasks: Spec-068 follow-ups — e2e spec debt and list-standards cleanup

**Input**: Design documents from `/specs/069-list-standards-followups/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/cleanup-contracts.md, quickstart.md

**Tests**: Test-first per constitution VI — Part A IS failing-test-first
(e2e specs encode stale expectations); refactors keep existing unit +
integration coverage green; Playwright coverage ships in the same change.

**Organization**: Tasks grouped by user story (US1 e2e debt P1, US2 cheap
unifications P2, US3 heavier refactors P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 per spec.md

## Phase 1: Setup

- [X] T001 Run the two targeted e2e specs on the branch point and confirm
  the 10 documented failures reproduce
  (`cd playwright && pnpm e2e -- tests/journeys/product-map.spec.ts
  tests/journeys/component-relationships.spec.ts`) — baseline evidence for
  the test-first cycle; do not fix anything yet.

## Phase 2: Foundational (shared helpers — blocking US2/US3)

- [X] T002 [P] Create shared `facetParam(state, key)` helper +
  unit test in `packages/frontend/src/api/hooks/list-params.ts` (new
  file): returns `state.filters[key]` unless `undefined`, `""`, or `"all"`
  → `undefined` (contract C3, research D6).
- [X] T003 [P] Create the consolidated debounced-param hook in
  `packages/frontend/src/ux/hooks/` (new `use-debounced-param.ts` or
  generalized `use-list-search.ts`): `[input, setInput]` with two-way
  debounce sync, parameterized unset sentinel (`""` search / `"all"`
  filter) and commit callback (contract C3, research D6). Keep
  `useListSearch` working during transition.
- [X] T004 [P] Add a sort-target resolver to
  `packages/backend/src/utils/pagination.ts`: given a service's
  `Record<SortKey, string | RawBuilder>` map, the request `sort`, and a
  fallback key, return the orderable target (or apply `orderBy`
  directly) so services stop hand-writing ternaries (contract C2,
  research D5).

## Phase 3: User Story 1 — A trustworthy e2e workload (Priority: P1) 🎯 MVP

**Goal**: the two stale journey specs assert the shipped UI — topology on
the Map tab, only populated relationship lanes — and pass on every
Playwright project.

**Independent Test**: `cd playwright && pnpm e2e --
tests/journeys/product-map.spec.ts
tests/journeys/component-relationships.spec.ts` → 100% pass.

### Implementation for User Story 1

- [X] T005 [US1] Rewrite `playwright/tests/journeys/product-map.spec.ts`:
  navigate to `/products/{slug}?tab=map` (or click the Map tab trigger);
  keep all existing assertions (Product topology heading, five relation
  families, inspection panel, +N expansion, keyboard operation,
  no-horizontal-overflow, reduced-motion). In the legacy-link test
  (:87), assert the Map tab exists with `aria-selected="true"` on
  `?tab=map`, the empty product shows "No relationships yet", and remove
  the `getByRole('tab', { name: 'Map' })).toHaveCount(0)` assertion
  (FR-001..003, research D1/D2).
- [X] T006 [US1] Update
  `playwright/tests/journeys/component-relationships.spec.ts`: expect only
  lanes populated for `buildRelationshipFixture` (verify the actual set on
  first run — expected: `productDependents` + Instances; `dependedOnBy`,
  `sourcedBy`, `exposedBy`, `dependsOn`, `sourcesFrom`, `exposes` absent
  via `toHaveCount(0)`); delete the `'None'` empty-state block (:94-98);
  keep provenance-label and nested-instance assertions (FR-004, research
  D3).
- [X] T007 [US1] Run the targeted e2e for both spec files and iterate
  until green on every configured project (FR-005).

## Phase 4: User Story 2 — Cheap unifications land (Priority: P2)

**Goal**: one canonical 400-validation helper, one facet-param mapping,
one debounced-filter hook, no speculative type members, one entity-label
registry.

**Independent Test**: `cd packages/backend && pnpm lint && pnpm typecheck
&& pnpm test`; `cd packages/frontend && pnpm lint && pnpm typecheck &&
pnpm test` — plus the grep spot-checks in quickstart.md §2/§3.

### Implementation for User Story 2

- [X] T008 [P] [US2] Migrate every hand-rolled 400 site to
  `validationFailed(reply, issues)` from
  `packages/backend/src/routes/route-helpers.ts` (message "Invalid
  input"): `"Invalid query"` in agents.ts (×3), importers.ts (×4),
  credentials.ts, audit.ts (×2); `"Invalid query parameters"` in
  component-groups.ts, components.ts (×2); file-local `invalid()` in
  docker-targets.ts; hand-rolled `"Invalid input"` sends in
  agent-channel.ts, auth.ts (×4), components.ts, credentials.ts,
  importers.ts, sessions.ts, users.ts, org.ts, products.ts — sweep
  `src/routes/` for `status(400)`/`message: "Invalid` to catch stragglers;
  update any route tests asserting the legacy messages (FR-006,
  contract C1, research D4).
- [X] T009 [P] [US2] Adopt `facetParam` in
  `packages/frontend/src/api/hooks/components.ts`,
  `packages/frontend/src/api/hooks/products.ts`, and
  `packages/frontend/src/api/hooks/audit.ts` — delete the three local
  `facet`/`auditFacet` copies (keep `isoDateParam` and products'
  `missing`-sentinel expansion as-is) (FR-007, contract C3).
- [X] T010 [US2] Consolidate `useDebouncedFilter`
  (`packages/frontend/src/ux/app/activity.tsx:107`) and `useListSearch`
  (`packages/frontend/src/ux/hooks/use-list-search.ts`) onto the T003
  shared hook; update `activity.tsx` call sites and any `useListSearch`
  consumers if the signature changes (FR-007, contract C3).
- [X] T011 [P] [US2] Add `completedAt: string | null` to view-type
  `ImportRun` in `packages/frontend/src/ux/lib/view-types.ts:134`;
  verify `api/mappers/operations.ts` populates it; remove the
  `& { completedAt?: string | null }` intersection and derivation
  workaround in
  `packages/frontend/src/ux/components/patterns/title-with-summary.tsx`
  (:73, :287-290) (FR-008, research D8).
- [X] T012 [P] [US2] Audit every `SummaryRowMap` intersection
  (`title-with-summary.tsx:62-82`): verify `productCount`/`teamCount` on
  org rows (api/types.ts:413-419) and `score`/`status`/`createdAt` on
  suggestion rows (api/mappers/suggestions.ts:24-27) exist on the
  underlying types; promote genuinely-missing fields to the proper view
  types; delete redundant `& { … }` members and any field no payload
  carries (FR-008, research D8).
- [X] T013 [US2] Create `packages/frontend/src/ux/lib/entity-type-labels.ts`
  with the single `ENTITY_TYPE_LABELS` registry (fix
  `importer_config` → `"Importer config"`); update
  `packages/frontend/src/ux/app/activity.tsx` to import it and delete the
  local map (FR-009, research D9).
- [X] T014 [US2] Update affected unit tests:
  `packages/frontend/src/test/unit/spec-068-list-adapters.test.ts` (param
  builders), any hook tests for the consolidated debounced hook, and add
  coverage for `facetParam`/label registry where the suite convention
  calls for it.

## Phase 5: User Story 3 — Heavier standards refactors (Priority: P3)

**Goal**: sort dispatch as auditable per-service maps; docs/ux.md carve-out
for type-only pattern imports; pagination compat shims removed.

**Independent Test**: backend + frontend lint/typecheck/test/build green;
`grep -rn 'sort ===' packages/backend/src/services` shows no ternary
dispatch; `useSuggestions`/`useEntityHistory` have single signatures;
`docs/ux.md` §5 documents the carve-out.

### Implementation for User Story 3

- [X] T015 [US3] Convert sort ternaries to per-service maps in the
  simple-column services: component-group-service.ts,
  docker-target-service.ts, session-service.ts, user-service.ts,
  product-service.ts, importer-config-service.ts,
  credential-service.ts, agent-service.ts — `Record<SortKey, target>` +
  T004 resolver + existing id tiebreak; keys must match each endpoint's
  Zod sort enum (FR-010, contract C2, research D5).
- [X] T016 [US3] Convert component-catalog-service.ts,
  importer-source-service.ts, import-run-service.ts (both chains :1453,
  :1537), org-service.ts (both chains :184, :238) — computed sorts use
  select aliases (`worstStatus`, `instanceCount`, `boundConfigCount`,
  `lastSeenAt`, `memberCount`, etc.) as map values (FR-010).
- [X] T017 [US3] Convert audit-query-service.ts (both chains :452, :554 —
  `ACTOR_SORT`/`ENTITY_TYPE_SORT` `sql` expressions become map values;
  keep the outer-select ordering and `createdAt desc, id asc` tiebreak)
  and edge-suggestion-service.ts (:184 — express `effectiveSort`
  resolution + `SORT_COLUMNS` map; preserve the score branch's
  `createdAt asc, id asc` extra tiebreaks) (FR-010).
- [X] T018 [P] [US3] Amend `docs/ux.md` §5: document the carve-out
  permitting `import type` entity imports in leaf display patterns while
  runtime value imports of `@/api/types` in components stay forbidden;
  grep `packages/frontend/src/ux/components/patterns/` to confirm no
  runtime `@/api/types` imports exist (FR-011, contract C6, research D10).
- [X] T019 [US3] Migrate `useSuggestions` positional callers to the
  options object: `packages/frontend/src/ux/app/products/$slug.tsx:21`
  (`"PENDING", 0, 100` → `{ page: 1, pageSize: 100 }`) and
  `packages/frontend/src/ux/components/app/app-sidebar.tsx:135`
  (`"PENDING", 0, 1` → `{ page: 1, pageSize: 1 }`) (FR-012, contract C4,
  research D7).
- [X] T020 [US3] Drop the dual signatures: remove the positional branch
  in `useSuggestions` (`packages/frontend/src/api/hooks/suggestions.ts`)
  and the `limit`/`offset` translation in `normalizeFeedQuery`
  (`packages/frontend/src/api/hooks/audit.ts:117`) — inline or delete any
  residual normalization; update
  `packages/frontend/src/test/unit/spec-068-list-adapters.test.ts` and
  `entity-history-pagination.test.tsx` to the single signature (FR-012).
- [X] T021 [US3] Verify `useEntityHistory`'s wrapper
  (`packages/frontend/src/ux/hooks/use-entity-history.ts:54`) and all
  `useActivityFeed`/`useEntityHistory` callers use `page`/`pageSize`
  only; grep for stray `limit:`/`offset:` keys in feed queries.

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 Run backend verification: `cd packages/backend && pnpm lint &&
  pnpm typecheck && pnpm test && pnpm build`.
- [X] T023 Run frontend verification: `cd packages/frontend && pnpm lint
  && pnpm typecheck && pnpm test && pnpm build`.
- [X] T024 Re-run targeted e2e (`cd playwright && pnpm e2e --
  tests/journeys/product-map.spec.ts
  tests/journeys/component-relationships.spec.ts`) — must stay green.
- [X] T025 Run docs checks touched by B.1/B.7 (`pnpm docs:sidebar:check`,
  `pnpm docs:oracle:check` from root) and root `pnpm build` for
  workspace integrity.

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (baseline) → all phases (evidence only, non-blocking).
- Phase 2 helpers (T002–T004) → US2 (T009/T010) and US3 (T015–T016).
- US1 (Phase 3) is independent of US2/US3 — different files entirely.
- US2 before US3 within shared frontend files: T009/T014 edit
  `hooks/audit.ts` before T019's `normalizeFeedQuery` removal; T010/T013
  edit `activity.tsx` before US3 (no US3 task touches it).

### User Story Dependencies

- US1 (P1): standalone — Playwright specs only.
- US2 (P2): needs T002/T003 helpers; internally T008–T014 mostly
  parallel-safe across files.
- US3 (P3): needs T004 helper; B.5 tasks sequential after US2's
  `hooks/audit.ts` edits.

### Parallel Opportunities

- T002, T003, T004 run in parallel (different packages/files).
- Within US2: T008 (backend), T009+T011+T012 (different frontend files),
  T013 can run parallel to T009–T012 except T010/T013 share `activity.tsx`
  (sequence those two).
- T015/T016/T017 cover different service files and can be split further
  per service if needed; T018 (docs) is fully parallel.

## Parallel Example: User Story 2

```bash
# Backend + independent frontend files together:
#   T008 route sweep (backend) ∥ T009 param adapters ∥ T011 view types ∥ T012 SummaryRowMap
# Then: T010 debounced-hook consolidation → T013 label registry (activity.tsx order)
# Then: T014 test updates
```

## Implementation Strategy

### MVP First (User Story 1 Only)

Ship T001+T005–T007 first: the e2e suite goes green, restoring a
trustworthy full-workload signal — the highest-value, lowest-risk slice.

### Incremental Delivery

US2 lands as mechanical unifications (each independently revertible);
US3 lands per-service sort maps and hook-signature cleanup last, since
they carry the most review surface.

### Parallel Team Strategy

One agent can take US1 (isolated Playwright files) while another takes
US2 backend/frontend slices; US3 follows once helpers exist.

## Notes

- B.8 (`?status=` on suggestions) needs no task — resolved in clarifications.
- A.3 load flakes: no task — `retries: 1` already mitigates; revisit only
  if flakes recur during T024.
- `docs/openapi.yaml` untouched — no endpoint changes (ADR-104 N/A).
- AGENTS.md done-criteria for ship: roadmap.md update happens at Stage 8.

## Phase 7: Convergence

- [X] T026 Migrate the remaining local `"all"`-sentinel adapters to the
  shared `facetParam` helper so the sentinel→param mapping exists in
  exactly one place (SC-004 / FR-007, partial): `agentsFacet` in
  `packages/frontend/src/api/hooks/agents.ts`, `sourcesFacet` in
  `importer-sources.ts`, `configsFacet` + the inline `status` check in
  `importerRunsListParams` (`importers.ts`), the inline `lifecycle`
  sentinel check in `component-groups.ts`, and the `missing` fallback
  sentinel check in `products.ts` (keep the `"incomplete"` expansion
  branch). Update `spec-068-list-adapters.test.ts` expectations if the
  param builders' call shape changes.

## Phase 8: Review

- [X] T027 Add an "Amended by spec 069" back-pointer to
  `researches/adrs/ADR-103-ux-ui-reference-adoption.md` documenting the
  `docs/ux.md` §5 type-only-import carve-out (precedent: spec 062's
  amendment note at ADR-103:80) per code-review: standards.
- [X] T028 Widen the `docs/ux.md` §5 carve-out wording so it covers all
  type-only (`import type`) `@/api/types` imports under `ux/` — forms,
  detail views, and libs included (~19 sites), not only leaf display
  patterns; runtime value imports stay forbidden per code-review:
  standards.
- [X] T029 Delete the dead `entityTypeLabel()` export from
  `packages/frontend/src/ux/lib/entity-type-labels.ts` — zero call sites;
  `ENTITY_TYPE_LABELS` is the consumed surface (anti-speculative-
  generality, B.6 spirit) per code-review: standards + spec.
- [X] T030 Derive `ACTIVITY_FILTERS.entityType.values` in
  `packages/frontend/src/ux/app/activity.tsx` from
  `Object.keys(ENTITY_TYPE_LABELS)` (prefixed with `"all"`) so the
  filter options and label registry cannot drift per code-review:
  standards.
- [X] T031 Route the run-changes page's `action === "all" ? undefined :
  action` sentinel (`packages/frontend/src/ux/app/importers/
  $id.runs.$runId.tsx:55`) through a shared value-level facet helper —
  extract a `facetValue(v)` primitive from `facetParam` (or equivalent)
  so the sentinel→param mapping exists in exactly one place per
  code-review: spec (SC-004/FR-007).
- [X] T032 Evaluate consolidating the three hand-rolled query
  serializers — `buildQueryString` (hooks/components.ts),
  `buildProductsQs` (hooks/products.ts), `buildComponentGroupsQs`
  (hooks/component-groups.ts) — onto `buildApiQueryString`
  (api/list-query.ts); migrate only where semantics are verified
  equivalent (falsy-vs-empty and boolean-param differences) per
  code-review: standards.
- [X] T033 Evaluate converting `edge-suggestion-service.ts:193-202`
  `effectiveSort` resolution to a record/map; if the view-dependent
  (`decidedView`) branching defeats a clean map, leave the resolution
  inline and note why in the service comment per code-review: standards
  + spec (FR-010 borderline).
- [X] T034 Correct the stale lane enumeration in spec.md US1 AC4
  (lines ~104-109): the fixture populates only `productDependents` +
  Instances; the six component-to-component lanes are asserted absent —
  align the spec text with research D3 / tasks T006 / shipped spec per
  code-review: spec.

## Phase 9: Review (round 2)

- [X] T035 Route the run-errors page's `errorType === "" ? undefined :
  errorType` sentinel (`packages/frontend/src/ux/app/importers/
  $id.runs.$runId.tsx:49`) through `facetValue` for consistency with
  T031 per code-review: standards (round 2 nit).
- [X] T036 Remove the duplicated tiebreak comment in
  `packages/backend/src/services/audit-query-service.ts` (the
  pre-068 feed-semantics note already appears above the query block)
  per code-review: standards (round 2 nit).
- [X] T037 Align `researches/adrs/ADR-103-ux-ui-reference-adoption.md`
  amendment wording ("in components") with the widened `docs/ux.md`
  §5 carve-out scope (all `ux/` modules) per code-review: standards +
  spec (round 2 doc drift).
- [X] T038 Soften the `docs/ux.md` §5 carve-out condition from "when no
  view type exists" to "view types remain preferred where they cover
  the needed fields" — actual usage imports API types for API-only
  fields even where view types exist per code-review: standards
  (round 2 nit).
- [X] T039 Add a cross-reference comment on `ENTITY_KIND` in
  `packages/frontend/src/api/mappers/dashboard.ts` noting it shares
  the entity_type slug domain with `ENTITY_TYPE_LABELS` but is a
  different codomain (AuditEvent.entityKind union, not display labels)
  per code-review: spec (round 2 borderline FR-009).

### Round-2 items evaluated and intentionally not changed

- `suggestions.tsx:104` `params.status ?? "PENDING"` — harmless
  defensive fallback; `options.status` overrides the `view` arg inside
  the hook, and removing the fallback risks an `undefined` spread
  overriding the default. Left as-is.
- `run-detail.tsx` `useListSearch` for the `errorType` filter — correct
  wrapper; unset sentinel `""` matches `errorType` semantics.
  `useDebouncedParam` would be more verbose for identical behavior.
- `api/hooks/search.ts` local `useDebouncedValue` (200 ms) —
  `api/hooks` cannot import `ux/hooks` without inverting the
  api→ux layering; out of B.4's named scope.
- `routes/auth.ts` domain-coded 400s (`AUTH_RESET_TOKEN_INVALID`,
  `OIDC_INVALID_CODE`) — domain error codes are API contract
  (ADR-071/ADR-104); converting them to the generic validation
  envelope would change client-visible codes. Exempt by design.
