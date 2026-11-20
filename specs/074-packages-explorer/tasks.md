# Tasks: Packages Explorer (Phase 1b)

**Input**: Design documents from `/specs/074-packages-explorer/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D7), data-model.md, contracts/packages-api.md, quickstart.md

**Tests**: Test-first is non-negotiable (constitution VI). Each story lists failing test tasks BEFORE implementation tasks. Playwright coverage ships in Phase 6 per AGENTS.md.

**Organization**: US1 = packages list (P1), US2 = consumers expander (P1), US3 = entry points (P2).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Core leaf contracts + query schemas every later task imports.

- [x] T001 [P] Create `packages/core/src/contracts/packages.ts` — `PackageListItem` (`purl`, `name`, `ecosystem`, `versionCount`, `versions: {version, componentCount}[]`, `componentCount`, `catalogComponent: {id, slug, name} | null`, `pendingSuggestionCount`), `PackageConsumerListItem` (`component: {id, slug, name, category}`, `version`, `scope`, `direct`, `lastReportedAt`), `PackageSearchHit` (`purl`, `name`, `ecosystem`, `componentCount`) — field shapes verbatim from data-model.md; export from `packages/core/src/index.ts`
- [x] T002 [P] Create `packages/core/src/schemas/packages.ts` — `listPackagesQuerySchema` extending `listParamsBaseSchema`: `ecosystem`/`scope` CSV filters (`splitCsvParam`; `scope` piped through `z.enum(BOM_DEPENDENCY_SCOPES)`), `catalog: z.enum(["linked","suggested","none"]).optional()` (D6 inert), `sort: z.enum(["name","components","versions","ecosystem"]).default("components")`, `order` override `listOrderSchema.default("desc")`, `.strict()`; `listPackageConsumersQuerySchema`: `purl: z.string().min(1).max(500)` required, `version: z.string().max(200).optional()`, `sort: z.enum(["name","version","scope","lastReportedAt"]).default("name")`, base `page`/`pageSize`/`order`, `.strict()`; unit tests `packages/core/test/packages-schemas.test.ts` (defaults, CSV, strict rejection of unknown params)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The stored, indexed package identity both endpoints group/match on (research D1). **CRITICAL — blocks all user stories.**

- [x] T003 `packages/backend/test/purl-identity.test.ts` — migration backfills `purlIdentity` = `normalizePurlIdentity(purl)` for existing versioned/cased/qualified purls (unparseable → verbatim fallback); `processBomEntries` writes `purlIdentity` on insert and preserves it on conflict-update; index exists. Fails before T004/T005.
- [x] T004 Migration `packages/backend/src/db/migrations/034_bom_entries_purl_identity.ts` — add `purlIdentity` `text` nullable → per-row backfill loop (`SELECT id, purl` → `UPDATE … SET "purlIdentity" = normalizePurlIdentity(purl) ?? purl` via parameterized `sql` templates; `packageurl-js` can't run in SQL so the loop runs in TS inside `up()`) → `ALTER COLUMN "purlIdentity" SET NOT NULL` → `CREATE INDEX bom_entries_purl_identity_idx`; `down()` drops index + column
- [x] T005 `packages/backend/src/db/types.ts` — `BomEntryRow` gains `purlIdentity: string`; `packages/backend/src/services/bom-service.ts` `processBomEntries` insert values gain `purlIdentity: normalizePurlIdentity(entry.purl) ?? entry.purl` (insert-only — `purl` is an upsert key so identity cannot change on conflict)
- [x] T006 `playwright/data/seed-app-flows.ts` — the `bomRow` pg INSERT gains the `purlIdentity` column (compute via `normalizePurlIdentity` — import from `@componode/core` if resolvable in the seed script, else a local equivalent MUST be justified in the PR); NOT NULL breaks seeding without this

**Checkpoint**: `pnpm --filter @componode/backend test` migration tests green; seeded rows carry identities.

---

## Phase 3: User Story 1 — Operator finds which components contain a package (P1) 🎯 MVP

**Goal**: `/packages` server-paginated rollup — one row per version-free purl with ecosystem, top-5 versions-in-use chips, component count; search/filters/sort all URL-driven; sidebar item + flag ON.

**Independent Test**: seed two+ components sharing `pkg:npm/lodash` at two versions; open `/packages` (one lodash row, `2 versions`, correct component count); exercise `?q=`, filters, sorts, pagination, URL reload.

### Tests for User Story 1

- [x] T007 [P] [US1] `packages/backend/test/packages-service.test.ts` — `listPackages`: one row per `purlIdentity` across versions AND casing (`pkg:npm/Lodash@x` + `pkg:npm/lodash@y` merge); `componentCount`/`versionCount` over ACTIVE components only (RETIRED excluded, D5); `search` matches name/verbatim purl/`purlIdentity`; `ecosystem`/`scope` entry-level filters before grouping; sort whitelist + default `components desc` + `name asc`/`purlIdentity asc` tiebreak (D7); top-5 `versions[]` by componentCount + `versionCount` overflow (D3); `catalogComponent: null`, `pendingSuggestionCount: 0`
- [x] T008 [P] [US1] `packages/backend/test/packages-routes.test.ts` — `GET /packages`: `{data, pagination}` envelope, `.strict()` rejects unknown params (`VALIDATION_FAILED`), unauthenticated → 401, empty inventory → `200 {data: []}`
- [x] T009 [P] [US1] `packages/frontend/src/test/unit/packages-page.test.tsx` — row rendering (name + purl, `{version} × {n}` chips, "+N more", component count); URL `q`/`ecosystem`/`scope`/`sort`/`order`/`page` round-trip; filter change resets page; `q` <2 chars hint, not sent (UX-PKG-07); no-inventory empty (Admin sees Importers link, Viewer does not) vs filtered-empty (Clear filters); flag-off → no page content

### Implementation for User Story 1

- [x] T010 [US1] `packages/backend/src/services/packages-service.ts` — `listPackages(query)`: inner filtered subquery over `bom_entries ⋈ components` (`lifecycle = 'ACTIVE'`; `search` ILIKE on `name`/`purl`/`purlIdentity`; `ecosystem`/`scope` IN; `catalog` parsed-but-ignored per D6) → `GROUP BY "purlIdentity", ecosystem` → representative `name` via `(array_agg(name ORDER BY "lastReportedAt" DESC))[1]` (sql template, parameterized — ADR-084), `count(DISTINCT version)` `versionCount`, `count(DISTINCT "componentId")` `componentCount` → `paginateQuery` on the grouped subquery (`components`→`componentCount`, `versions`→`versionCount` sort map; `name`/`purlIdentity` asc tiebreak) → second grouped query `GROUP BY "purlIdentity", version` for the page's keys → top-5 `versions[]` sliced in JS (null versions excluded from chips)
- [x] T011 [US1] `packages/backend/src/routes/packages.ts` — `GET /packages` (`verifySession`, `listPackagesQuerySchema.safeParse`, `validationFailed` on error, `200` send); register route file wherever `searchRoutes`/`componentRoutes` are wired (`app.ts` / server bootstrap)
- [x] T012 [US1] `packages/frontend/src/ux/lib/view-types.ts` — `PackageView`; `api/mappers/packages.ts` — contract → view mapper (chips data, "+N more" = `versionCount - versions.length`); `api/hooks/packages.ts` — `usePackages(listState)` mapping URL `q` → API `search` (073 convention)
- [x] T013 [US1] `packages/frontend/src/ux/app/packages/index.tsx` — page per UX-PKG-01/02/03/06/07: `PageHeader` title "Packages" + verbatim subtitle ("Where every package and version is used across the catalog. Inventory only: Componode does not scan for vulnerabilities."); `ListToolbar` (search; `ecosystem`, `scope` filters; *In catalog* filter control rendered **only under `bomCuration`** — URL param still accepted); table (Package = name + `MonoValue` purl; Ecosystem; Versions in use = top-5 chips `{version} × {componentCount}` + "+N more"; Components count) with expander slot for US2; `ListPagination`; empty states (no-inventory with Admin-only Importers link via session role; filtered-empty with Clear filters); `q` <2 chars → hint + skip fetch; `useListState` keys `q`,`ecosystem`,`scope`,`catalog`,`sort`,`order`,`page`,`pageSize`
- [x] T014 [US1] `packages/frontend/src/ux/lib/flags.ts` — `packagesExplorer: true` + G37 doc comment; `ux/lib/nav.ts` — `BlocksIcon` import, Packages item in Catalog section **after Component groups** (no `badgeKey`), `SEGMENT_LABELS.packages = "Packages"` — rendered only while flag on; `routes.tsx` — `{ path: "packages", element: authed(<UxPackagesPage />) }` import + entry (all roles; page itself returns the hidden/not-found treatment when flag off)

**Checkpoint**: US1 independently shippable — `/packages` browses/searches/filters/paginates real data behind a flag shipped ON.

---

## Phase 4: User Story 2 — Operator expands a package to see its consumers (P1)

**Goal**: Row-expand to a paginated consumers list (`component, version, scope` merged rows) with version-chip filtering and BOM-tab deep links; reusable `package-consumers` component.

**Independent Test**: seed `pkg:npm/pw-shared` on ≥3 components across 2 versions; expand the row (consumers paginate); click a version chip (`version` param narrows list); follow a component link (`?tab=bom&q={purl}` lands filtered).

### Tests for User Story 2

- [x] T015 [P] [US2] `packages/backend/test/packages-consumers.test.ts` — `GET /packages/consumers`: rows merge per `(componentId, version, scope)`; `direct` = `bool_or` over group (D2); `lastReportedAt` = max; `purl` param normalized (versioned/verbatim/unparseable fallback, D1); `version` param narrows; ACTIVE-only (D5); missing `purl` → `VALIDATION_FAILED`; unknown purl → `200 {data: []}`; pagination envelope
- [x] T016 [P] [US2] `packages/frontend/src/test/unit/package-consumers.test.tsx` — expander renders component link (`/components/{slug}?tab=bom&q={purl}`), category, version, scope, direct/transitive, `lastReportedAt`; version-chip click sets `version` filter; >pageSize paginates inside row; fetch failure → inline retry, not page error

### Implementation for User Story 2

- [x] T017 [US2] `packages/backend/src/services/packages-service.ts` — `listPackageConsumers(query)`: normalize `query.purl` (`normalizePurlIdentity(purl) ?? purl`) → `GROUP BY c.id, c.slug, c.name, c.category, e.version, e.scope` over `bom_entries e ⋈ components c` (ACTIVE, `purlIdentity` match, optional `version`) selecting `bool_or(e.direct)`, `max(e."lastReportedAt")` → `paginateQuery` (sort map `name`/`version`/`scope`/`lastReportedAt`→max)
- [x] T018 [US2] `packages/backend/src/routes/packages.ts` — `GET /packages/consumers` (`verifySession`, `listPackageConsumersQuerySchema.safeParse`; missing/empty `purl` → `VALIDATION_FAILED`; `200` send)
- [x] T019 [US2] `packages/frontend/src/ux/components/catalog/package-consumers.tsx` — reusable paginated list, props `{purl, version?}` + `onVersionFilter` callback: columns component name (link to `?tab=bom&q={purl}`), category, version (muted when null), scope badge, direct/transitive tag, `RelativeTime` last reported; `usePackageConsumers` hook in `api/hooks/packages.ts` + `PackageConsumerView` mapper; inline retry row on fetch failure (UX-BOM-12 parity); Phase 2 Library detail *Used by* reuses this component unchanged
- [x] T020 [US2] Packages table expander — row expand (same pattern as the component-detail Instances table) renders `PackageConsumers` with `version` state set by chip click; expansion state client-only (not URL)

**Checkpoint**: US1 + US2 — the "which components use X" question is fully answered in-product.

---

## Phase 5: User Story 3 — Operator reaches a package from anywhere (P2)

**Goal**: `Ctrl+K` **Packages** result group + BOM row-menu **See where it's used** deep link — both flag-gated.

**Independent Test**: `Ctrl+K` `lodash` → Packages group top-5 → lands `/packages?q=…`; BOM tab row menu → `/packages?q={purl}`; flag off → both absent.

### Tests for User Story 3

- [x] T021 [P] [US3] `packages/backend/test/search-packages.test.ts` — `GET /search` `packages[]` group: prefix ILIKE on `name`/`purlIdentity`, top-5, `componentCount` ACTIVE-only, absent when no matches, existing groups unchanged
- [x] T022 [P] [US3] `packages/frontend/src/test/unit/packages-entrypoints.test.tsx` — palette **Packages** group renders `{name} · {ecosystem} · {n} components` and navigates `/packages?q={purl}`; BOM row menu shows *See where it's used* and navigates `/packages?q={purl}`; flag-off renders neither

### Implementation for User Story 3

- [x] T023 [US3] `packages/backend/src/services/search-service.ts` — `SearchResults` gains `packages: PackageSearchHit[]`; grouped query prefix-matching `name`/`purlIdentity` (`{term}%`), `count(DISTINCT componentId)` ACTIVE-only, `LIMIT 5`; `packages/frontend/src/api/hooks/search.ts` — extend the consumed `SearchResults` type
- [x] T024 [US3] `packages/frontend/src/ux/components/app/command-menu.tsx` — **Packages** `CommandGroup` (flag-gated via `flags.packagesExplorer`): `CommandItem` per hit formatted `{name} · {ecosystem} · {n} components`, `onSelect` → `/packages?q={purl}` (encode)
- [x] T025 [US3] `packages/frontend/src/ux/components/catalog/component-bom.tsx` — row menu gains *See where it's used* (`DropdownMenuItem`, all roles, rendered only while `flags.packagesExplorer`) navigating to `/packages?q={row.purl}`; *Copy purl* unchanged

**Checkpoint**: all three entry points live; UX verification Phase-1b items 1–2 pass.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Governance, docs, e2e coverage, full verification.

- [x] T026 [P] ADR-131 amendment note in `researches/adrs/ADR-131-*.md` — record the stored `purlIdentity` column (derived `normalizePurlIdentity`, backfilled migration 034, insert-written; verbatim `purl` unchanged as the upsert key and display/export value; the column is the Phase-2 `resolvedComponentId` join target); add the amendment line to `researches/architecture-decisions.md` if the index tracks amendments
- [x] T027 [P] `researches/ux-rewrite-gaps.md` — new `## G37 — Packages explorer — RESOLVED by spec 074` entry matching the G36 format (surface: `/packages` page + sidebar item + Ctrl+K group + row-menu deep links; capability: `GET /packages` + `GET /packages/consumers` + `/search` group; flag `packagesExplorer`; fallback hidden)
- [x] T028 `docs/ux.md` — §4 route map row (`/packages` | Packages explorer / where-used | — all roles); §7 flags table row (`packagesExplorer` | `/packages` page, sidebar item, `Ctrl+K` Packages group, BOM row-menu deep link | Hidden | G37); §9/vocabulary: register **Where used** if the section enumerates feature terms
- [x] T029 `docs/openapi.yaml` — `/packages` + `/packages/consumers` paths (params, response schemas, `security`/`x-permission` consistent with `verifySession` — copy the BOM list endpoint's conventions; ADR-104 contract test enforced) + `SearchResults` schema gains `packages`; run `pnpm --filter @componode/backend docs:api` to regen `docs/api.md`; `docs:oracle:check` + `docs:sidebar:check` green
- [x] T030 [P] `docs/roadmap.md` — `074-packages-explorer` shipped entry (packages explorer: where-used rollup over `bom_entries`, `purlIdentity` identity, consumers drill-down, `/packages` + palette + row-menu entry points, `packagesExplorer` flag — Phase 2 curation still deferred); revise the Next entry
- [x] T031 `playwright/data/seed-app-flows.ts` — extend BOM fixtures (on top of T006): a shared package (`pkg:npm/pw-shared-lib` at two versions) seeded on ≥2 components (e.g. `bomStaleComp` + one more) so the spec exercises multi-consumer rows and version-chip filtering
- [x] T032 `playwright/tests/journeys/packages.spec.ts` — journeys per FR-018 + quickstart: list renders/searches/filters/paginates with URL round-trip; expand → consumers rows + version-chip narrowing + component deep link; `Ctrl+K` Packages group; BOM row-menu navigation; no-results Clear-filters; Viewer read-only; run `pnpm e2e` subset green
- [x] T033 Full verification — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for changed packages (core, backend, frontend) + root build + `pnpm audit --prod --audit-level=high`; quickstart.md scenarios 1–5 spot-check; AGENTS.md done-criteria sweep (openapi ✅, importer docs n/a, ADR amendment ✅, roadmap ✅)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: contracts + schemas — no dependencies.
- **Phase 2 (Foundational)**: migration + write-path + seed fix — depends on T001 for `normalizePurlIdentity` usage (already exists in core; contracts not strictly required) — **BLOCKS all user stories** (`purlIdentity` must exist before any endpoint reads it).
- **Phases 3–5 (US1–US3)**: all depend on Phase 2; US2's expander UI (T019/T020) depends on US1's page/table (T013); US3 touches shared files (search-service, component-bom) but not US1/US2 outputs — US1 → US2 sequential, US3 independent after Phase 2.
- **Phase 6 (Polish)**: depends on all stories complete.

### Within Each Story

- Test tasks ([P]) MUST fail before implementation tasks run (constitution VI).
- Service before route before frontend wiring.

### Parallel Opportunities

- T001 ∥ T002 (different core files).
- T007 ∥ T008 ∥ T009 (backend service, backend route, frontend page tests).
- T015 ∥ T016; T021 ∥ T022 (backend ∥ frontend tests).
- T026 ∥ T027 ∥ T030 (separate docs files).

---

## Implementation Strategy

### MVP First

Phase 1 → Phase 2 → Phase 3 (US1) — `/packages` list alone already answers "do we have X anywhere?" and is demoable.

### Incremental Delivery

US1 → US2 → US3 in order (US2 completes the headline question; US3 is discovery polish); Phase 6 always last.

### Notes

- `catalog` query param ships schema-accepted/service-inert and the *In catalog* filter control is `bomCuration`-gated — Phase 2 flips behavior without a contract change (D6).
- Every direct `bom_entries` INSERT in tests/seeds MUST set `purlIdentity` (NOT NULL) — T003/T006 cover the known writers; converge should re-grep.
- The seed's two `LIBRARY`-category fixture components are Phase-1 artifacts, unrelated to the Phase-2 `LIBRARY` taxonomy — do not "fix" them here.

---

## Phase 7: Convergence

- [x] T034 Gate the "In catalog" table column (head + cell) and `colSpan` on `flags.bomCuration` — currently rendered unconditionally in `ux/app/packages/index.tsx` per FR-007 (missing)
- [x] T035 Flag-gate the Packages sidebar item and Ctrl+K Navigate entry on `flags.packagesExplorer`, and guard `usePackages` with `enabled` so the query never fires when the flag is off — per FR-012/US1-AC5 (missing)
- [x] T036 Cap the Ctrl+K packages group at 5 results regardless of `limit` — per US3-AC1/D4 (contradicts)
- [x] T037 Use `BOM_SCOPE_META` labels for consumer scope (all 8 scopes, not a 3-value fallback) and offer the full scope domain in the page filter `values` — per FR-008/UX-PKG-04 (contradicts/partial)
- [x] T038 Scope the `version` URL param to the expanded row: row-expand clears it, chip sets expanded+version together, and the consumers panel resets its inner page on version change — per US2/AC2/AC3 and FR-008 (partial/unrequested side-effect)
- [x] T039 Add missing unit coverage per T009/T016/T022/constitution VI: flag-off page, "+N more" overflow, Admin-only Importers link, filter-resets-page, consumers inline retry, palette/BOM-menu flag-off, and backend search assertions (no-match → absent group, ≤5 cap) (partial)
- [x] T040 Extend `packages.spec.ts` with ecosystem/scope filter + pagination exercise per FR-018 (partial)
- [x] T041 Align `contracts/packages-api.md` `/search` section with the shipped `SearchHit` shape (`{name} · {ecosystem} · {n} components`, href `/packages?q=`), remove the unused `PackageSearchHit` core export + dead `toPackageConsumerView` (contradicts/dead code)
- [x] T042 Render `RelativeTime` for `lastReportedAt` and `CATEGORY_LABELS` for component category in `package-consumers.tsx` per T019 (partial)

## Phase 8: Convergence round 2

- [x] T043 [converge R2, CRITICAL] Register `packageRoutes` in `packages/backend/test/unit/api-docs-contract.test.ts` (import + `app.register` plugin list) — the ADR-104 contract test currently fails because openapi.yaml documents `/packages` + `/packages/consumers` but the test app never registers them
- [x] T044 [converge R2] Complete T039 coverage gaps: unit tests for the Ctrl+K Packages `CommandGroup` (render + flag-off hidden), the BOM row-menu "See where it's used" flag-off path, and an Admin-positive assertion for the empty-state Importers link
- [x] T045 [converge R2] Restore the `onVersionFilter` path per T019/US2: make the Version cell in `package-consumers.tsx` clickable (sets the row's version filter) so versions beyond the top-5 chips are reachable — no dead ends
- [x] T046 [converge R2] Add `.omit({ search: true })` to `listPackageConsumersQuerySchema` — `?search=` currently passes strict validation but is silently ignored and undocumented (convention: suggestions.ts, audit.ts)
- [x] T047 [converge R2] Use the shared `validationFailed(reply, issues)` helper in `routes/packages.ts` instead of the inlined error envelope
- [x] T048 [converge R2] Fix `docs/ux.md` §7: `packagesExplorer` fallback is a gap notice on `/packages` (nav entries hidden), not "Hidden"

## Phase 9: Code review round 1

- [x] T049 [code-review: spec] US1-AC5 + FR-017 + SC-005: flag-off must render **zero explorer surface** — change the `/packages` page's flag-off branch from the gap notice to a `<Navigate to="/" replace>` redirect; fix the G37 registry entry and `docs/ux.md` §7 cell to record `fallback = hidden`; update the flag-off unit test (redirect + still no fetch)
- [x] T050 [code-review: spec] FR-009 × FR-010: 1-char `q` with zero inventory must show the *no-inventory* state, not *no-match* — `searched` in `index.tsx` counts `query.trim().length >= 2`
- [x] T051 [code-review: spec] UX-PKG-06: "Clear filters"/reset must also clear `?version=` — it currently survives `list.reset`, leaving an invisible stale consumers filter
- [x] T052 [code-review: spec] FR-018 flag-off e2e coverage: make `flags` read a `localStorage` override at module load (`componode.flag.<name>`), and extend `packages.spec.ts` with a flag-off journey (sidebar item absent, `/packages` redirects — zero surface) via `page.addInitScript`
- [x] T053 [code-review: spec] US1 ecosystem filter is silently incomplete (options derived from current page only): add `facets: { ecosystems: string[] }` to `GET /packages` (distinct ecosystems over ACTIVE inventory) — core contract/schema, service, openapi, contract doc, mapper, page options, tests
- [x] T054 [code-review: standards, hard] docs/ux.md badge rule: render consumer scope via `<BomScopeBadge>` (status-badge.tsx) in `package-consumers.tsx` — drop the hand-rolled `scopeLabel`
- [x] T055 [code-review: standards] Send the **trimmed** search in `packagesListParams` — `"  ab"` currently goes out verbatim
- [x] T056 [code-review: standards] `packages-service.ts`: replace `sql`bom_entries.scope`` with the plain `"bom_entries.scope"` reference (matches `ecosystem` two lines up); extract the duplicated `iso` coercion into `db/timestamps.ts` and reuse in bom-service + packages-service; drop the index from the consumers row key; share `CONSUMER_PAGE_SIZE` from the hooks file; pluralize the palette hit detail (`component`/`components`) + update contract doc and search test
- [x] T057 [code-review: spec, dispositioned] `?version=` URL param kept deliberately — FR-006 constrains toolbar state and FR-008 expansion state; the version chip is a shareable deep-link filter consistent with the repo's URL-driven list convention. Note in plan.md deviations.

## Phase 10: Convergence round 3 (sanity — verification findings)

- [x] T058 [converge R3, HIGH] Clear-filters `q` survived on every list page via TWO same-tick clobbers: (a) page-local `?version=` writes used raw `setSearchParams` from a stale snapshot — `useListState` gains `mutateParams` so they compose through the pending-write channel; (b) `useDebouncedParam` re-committed the stale debounced text after `reset()` cleared the URL — commits now require a user edit (`dirtyRef`) since the last URL→input sync (UX-PKG-06; found by e2e empty-states journey) (contradicts)
- [x] T059 [converge R3] `packages.spec.ts` Ctrl+K journeys press the shortcut before React mounts the listener (60s flake on chromium-desktop) — wait for the rendered sidebar Search button first (partial)
