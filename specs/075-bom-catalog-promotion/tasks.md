# Tasks: BOM Catalog Promotion (Phase 2)

**Input**: Design documents from `/specs/075-bom-catalog-promotion/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D12), data-model.md, contracts/ (2 files), quickstart.md

**Tests**: Test-first is non-negotiable (constitution VI). Each story lists failing test tasks BEFORE implementation tasks. Playwright coverage ships in Phase 8 per AGENTS.md.

**Organization**: US1 = Add to catalog (P1), US2 = Link to existing (P1), US3 = matching pass + live contract fields (P1), US4 = dependency suggestions queue (P1), US5 = catalog legibility (P2).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Leaf contracts, constants, mappings, and query schemas every later task imports.

- [x] T001 [P] `packages/core/src/constants/component-providers.ts` — add the 13 ecosystem providers (`NPM`, `PYPI`, `MAVEN`, `NUGET`, `GOLANG`, `CARGO`, `RUBYGEMS`, `PACKAGIST`, `GHCR`, `ECR`, `DEBIAN`, `RPM`, `ALPINE`) with `COMPONENT_PROVIDER_META` labels/descriptions verbatim from the research table; add `COMPONENT_PROVIDER_GROUPS` (`"platforms"` = existing 11, `"package-registries"` = new 13) exported for the grouped filter. New `packages/core/src/constants/bom-component-suggestion.ts` — `BOM_SUGGESTION_REASONS` (`PURL_EXACT` | `PURL_NAME_MATCH` | `CATALOG_SLUG_MATCH`), `BOM_SUGGESTION_STATUSES` (`PENDING` | `ACCEPTED` | `DISMISSED` | `SUPERSEDED`), reason badge meta (`PURL_EXACT`→"Exact package match", `PURL_NAME_MATCH`→"Name match", `CATALOG_SLUG_MATCH`→"Catalog name match") and score ranking (`PURL_EXACT` > `CATALOG_SLUG_MATCH` > `PURL_NAME_MATCH`)
- [x] T002 [P] `packages/core/src/constants/package-mapping.ts` — `mapEcosystemToProvider(ecosystem, purl?)` per the research table (`npm`→`NPM`, `pypi`→`PYPI`, `maven`→`MAVEN`, `nuget`→`NUGET`, `golang`→`GOLANG`, `cargo`→`CARGO`, `gem`→`RUBYGEMS`, `composer`→`PACKAGIST`, `deb`→`DEBIAN`, `rpm`→`RPM`, `apk`→`ALPINE`; `docker`/`oci`→`DOCKER`|`GHCR`|`ECR` resolved from the purl's registry hostname; unmapped→`OTHER`) and `mapCdxTypeToCategory(cdxType)` (`library`,`framework`,`machine-learning-model`→`LIBRARY`; `container`→`CONTAINER`; `device`,`firmware`,`operating-system`,`platform`,`application`→`COMPUTE`; `service`→`API`; `file`,`data`→`STORAGE`; other→`LIBRARY`) + `isLossyMapping(cdxType, ecosystem)` returning the `mappedFrom` note data. Both pure, exported via `packages/core/src/index.ts`
- [x] T003 [P] `packages/core/src/contracts/bom-component-suggestion.ts` — `DependencySuggestion` (`id`, `parentComponentId`, `childComponentId`, `bomEntryId`, `reason: BomSuggestionReason | null`, `score: number | null`, `status`, `createdAt`, `decidedAt`, `decidedBy`), `DependencySuggestionQueueItem` (+ `parentComponent {id,slug,name,category}`, `childComponent {id,slug,name,category}`, `decidedByName`), `DependencySuggestionGroup` (`childComponent`, `purl`, `pendingCount`, `versions`, `reasons[]`, `topScore`, `bulkAcceptable`), `DependencyBulkResult` (`decided`, `failed`, `edges`, `failedIds`); `contracts/bom-curation.ts` — `AddToCatalogPreview` (`name`, `identity`, `category`, `provider`, `providerGroup`, `resourceType`, `consumerCount`, `versions[]`, `mappedFrom {cdxType, ecosystem, note} | null`, `existingComponent {id,slug,name,category,provider} | null`), `CurationResult` (`component`, `linked`, `alreadyLinked`, `suggestionsStaged`); `contracts/component-relationships.ts` — `relationships` gains `libraryCounts: { dependsOn: number; dependedOnBy: number }`; `contracts/packages.ts` — update `catalogComponent`/`pendingSuggestionCount` doc comments (now live); export all from index
- [x] T004 [P] `packages/core/src/schemas/bom-curation.ts` — `addToCatalogBodySchema` (`purl: z.string().min(1).max(500)`, `linkConsumers: z.boolean()`), `linkPackageBodySchema` (+ `componentId: z.string().uuid()`), `previewQuerySchema` (`purl` required), `packageVersionsQuerySchema` (`purl` required + optional `page`/`pageSize`), all `.strict()`; `schemas/suggestions.ts` — `listSuggestionsQuerySchema` gains `kind: z.enum(["edge","dependency"]).default("edge")`; `dependencyGroupsQuerySchema` (`sort: z.enum(["score","components","name"]).default("score")`, `page`/`pageSize`/`order`, `.strict()`); `dependencyBulkBodySchema` (`childComponentId: z.string().uuid()`, `action: z.enum(["accept","dismiss"])`); `schemas/components.ts` — `listComponentsQuerySchema` gains `libraries: z.enum(["1","true"]).optional()`; `schemas/packages.ts` — `catalog` doc note updated (live)
- [x] T005 [P] `packages/core/test/` — unit tests for T001–T004: provider group partitions (exactly 11/13, union = `COMPONENT_PROVIDERS`), `mapEcosystemToProvider` incl. `docker`/`oci` hostname resolution (`ghcr.io`→`GHCR`, `*.ecr.*.amazonaws.com`→`ECR`, else `DOCKER`) and unmapped→`OTHER`, `mapCdxTypeToCategory` full table, `isLossyMapping`, slug-token derivation (`@scope/name` → `scope-name`), schema defaults (`kind: "edge"`), `.strict()` rejection of unknown fields

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The suggestion table, provider CHECK, RBAC action, and the shared write primitives every story consumes. **CRITICAL — blocks all user stories.**

- [x] T006 [P] `packages/backend/test/bom-suggestions-migration.test.ts` — migration 035 creates `bom_component_suggestions` with all columns/CHECKs (`reason` nullable enum, `status` default `PENDING` enum), `UNIQUE (parentComponentId, childComponentId)`, cascade FKs, `decidedBy`→persons SET NULL; migration 036 widens `components_provider_check` to all 24 providers (insert `NPM`/`DEBIAN` succeeds, garbage rejected); `down()` restores. Fails before T007/T008.
- [x] T007 `packages/backend/src/db/migrations/035_bom_component_suggestions.ts` — create table per data-model.md verbatim (uuid PK, `bomEntryId`/`parentComponentId`/`childComponentId` FKs `ON DELETE CASCADE`, nullable `reason` CHECK, `score` int NULL, `status` CHECK default `PENDING`, `createdAt` default now, `decidedAt`, `decidedBy` FK `ON DELETE SET NULL`, `UNIQUE (parentComponentId, childComponentId)`, indexes on `(childComponentId, status)` + `(bomEntryId)` + `(status)`); `db/types.ts` — `BomComponentSuggestionRow` + `bom_component_suggestions` table entry
- [x] T008 `packages/backend/src/db/migrations/036_ecosystem_providers.ts` — drop/re-add `components_provider_check` over all 24 `COMPONENT_PROVIDERS` values (exact `015_alibaba_cloud_provider.ts` pattern); `down()` restores the 11-provider CHECK
- [x] T009 `packages/backend/src/plugins/rbac.ts` — add `"component:edge:add": "EDITOR"` (curation writes: add/link/decide/bulk). Extend the rbac unit test if one exists mapping permissions→roles
- [x] T010 `packages/backend/src/services/bom-suggestion-store.ts` — shared write primitives used by curation + match pass + queue service: `stageBomSuggestions(pairs, trx?)` — chunked (≤500) `INSERT … ON CONFLICT (parentComponentId, childComponentId) DO UPDATE reason/score … WHERE status='PENDING'` + changed-only guard (idempotent rescan); `supersedeBomPairs(trx, parentId, childIds)` — PENDING→`SUPERSEDED` (reason/score NULL) + tombstone insert for absent covered pairs; `acceptBomPairs(trx, pairs)` — PENDING→`ACCEPTED` with `decidedAt`/`decidedBy`; `findComponentByPackageIdentity(identity)` — verbatim `externalId` equality + `normalizePurlIdentity`-compare over `externalId ILIKE 'pkg:%'` candidates, all providers/categories (D2); `allocateLibrarySlug(type, name)` — `pkg-{type}-{name}` slugified, `-2`,`-3`… suffix loop until free
- [x] T011 [P] `packages/backend/test/bom-suggestion-store.test.ts` — stage inserts PENDING + refreshes reason/score on re-stage but never touches ACCEPTED/DISMISSED/SUPERSEDED; supersede flips PENDING + tombstones absent pairs idempotently; acceptBomPairs stamps decider; `findComponentByPackageIdentity` matches verbatim and versioned `pkg:` externalIds across providers/categories, misses non-purl externalIds; slug allocator suffixes on collision (`pkg-npm-lodash`, `pkg-npm-lodash-2`)

**Checkpoint**: migrations apply/rollback clean; `pnpm --filter @componode/backend test` T006 + T011 green.

---

## Phase 3: User Story 1 — Curator adds a package to the catalog (P1) 🎯 MVP

**Goal**: Preview-driven Add to catalog creating one `LIBRARY` component per version-free purl, with atomic link-all or stage-suggestions outcomes; reachable from BOM-tab and `/packages` row menus (Editor, `bomCuration` ON).

**Independent Test**: seed `pkg:npm/lodash` on 3 components; preview → confirm **Link all 3** → 1 component + 3 edges atomically; repeat **Only add** on a second package → 0 edges + 3 staged suggestions (quickstart A).

### Tests for User Story 1

- [x] T012 [P] [US1] `packages/backend/test/bom-curation-preview.test.ts` — `GET /packages/add-to-catalog/preview?purl=`: derived name/identity/category/provider/providerGroup/resourceType; `consumerCount` counts distinct ACTIVE consumers (RETIRED excluded); `versions[]` all reported versions w/ counts; `existingComponent` surfaces a cross-provider normalized-identity match; `mappedFrom` non-null on lossy cdxType (`firmware`→`COMPUTE`) and unmapped ecosystem→`OTHER`; unparseable purl → verbatim identity; unknown identity → `404`; unauthenticated → `401`
- [x] T013 [P] [US1] `packages/backend/test/bom-curation-add.test.ts` — `POST /packages/add-to-catalog`: creates component (uuidv7, `externalId`=normalized identity, slug `pkg-{type}-{name}`, mapped category/provider, `resourceType`=`{type}:package`, audit event); `linkConsumers:true` → exactly N `component_depends_on_component` rows, `alreadyLinked` counts pre-existing edges (preserved), covered PENDING suggestions→`ACCEPTED`; `linkConsumers:false` → `suggestionsStaged` = consumer count, zero edges; `resolvedComponentId` set on every entry of the identity either way; `409` when identity already exists; atomicity — injected mid-transaction failure leaves no component/edges (e.g. transient error injection or forced conflict path); non-EDITOR → `403`
- [x] T014 [P] [US1] `packages/frontend/src/test/unit/bom-add-to-catalog-dialog.test.tsx` — dialog title/description verbatim per UX-ADD-01; preview DescriptionList shows Name/Category/Provider(+group)/Identity/Used-by-N link; radio outcomes with helper text (UX-ADD-03); primary label states count ("Add and link 9 components"); `mappedFrom` note renders on lossy mapping; failure → inline error + Retry, nothing created; success → toast + View action; hidden for Viewer and `bomCuration` OFF

### Implementation for User Story 1

- [x] T015 [US1] `packages/backend/src/services/bom-curation-service.ts` — `previewAddToCatalog(purl)`: normalize (`normalizePurlIdentity(purl) ?? purl`), aggregate consumers/versions over `bom_entries ⋈ components` ACTIVE-only, representative `name`/`cdxType`/`ecosystem` from latest entry, `findComponentByPackageIdentity` for `existingComponent`, `isLossyMapping` for `mappedFrom` (`404` when no entries); `addPackageToCatalog({purl, linkConsumers}, actor)`: `findComponentByPackageIdentity` guard → `409` w/ `existingComponent`; single `db.transaction()`: insert component (fields per data-model.md, `writeEntityChange` audit) → `resolvedComponentId` on all identity entries → per distinct ACTIVE consumer `INSERT component_depends_on_component … ON CONFLICT DO NOTHING` (count `linked`/`alreadyLinked`) + `acceptBomPairs`/`supersedeBomPairs` bookkeeping **or** `stageBomSuggestions` `PURL_EXACT` rows when `linkConsumers:false`; return `CurationResult`
- [x] T016 [US1] `packages/backend/src/routes/packages.ts` — `GET /packages/add-to-catalog/preview` (`verifySession`, `previewQuerySchema`) and `POST /packages/add-to-catalog` (`verifySession`, `requireRole("component:edge:add")`, `addToCatalogBodySchema`; `sendServiceError` mapping for 404/409)
- [x] T017 [US1] `packages/frontend/src/api/` — types + mappers (`AddToCatalogPreviewView`, `CurationResultView`) + hooks (`useAddToCatalogPreview(purl)`, `useAddToCatalog()` mutation invalidating `["packages"]`, `["bom"]`, `["suggestions"]` queries)
- [x] T018 [US1] `packages/frontend/src/ux/components/catalog/bom-add-to-catalog-dialog.tsx` — `FormSection` + `DescriptionList` dialog per UX-ADD-01..07: title "Add {name} to the catalog", verbatim sentence ("Creates one Library component that every component using {name} can depend on. Versions stay on each component's own bill of materials."), preview fields + "Used by N components" link to `/packages?q=`, radio group outcomes, count-bearing primary label, `mappedFrom` muted note, atomic error inline + Retry, success toast "Added {name} to the catalog" + View
- [x] T019 [US1] Entry points — `packages/frontend/src/ux/components/catalog/component-bom.tsx` row menu gains **Add to catalog** (Editor + `flags.bomCuration`, only when `resolvedComponent`/`pendingSuggestionId` null); `packages/frontend/src/ux/app/packages/index.tsx` row menu same item; both open the dialog with `purl = purlIdentity`; add `catalog` filter control to the BOM toolbar under flag (param already in URL schema)

**Checkpoint**: US1 independently shippable — preview → atomic add+link → toast, verified by quickstart scenario A.

---

## Phase 4: User Story 2 — Curator links a package to an existing component (P1)

**Goal**: When normalized-identity equality finds an existing component (any provider/category), the same entry points open **Link to existing component** — never a duplicate create.

**Independent Test**: seed a component with `externalId=pkg:pypi/requests` under provider `OTHER`; open the row-menu action on `requests` → Link mode shows the match; both outcomes verified (quickstart B).

### Tests for User Story 2

- [x] T020 [P] [US2] `packages/backend/test/bom-curation-link.test.ts` — `POST /packages/link`: links to the given `componentId`; `linkConsumers:true` → edges atomically + `resolvedComponentId` repoints to the component; `false` → staged suggestions; 404 unknown `componentId`; `409` RETIRED target; pre-existing edges preserved (`alreadyLinked`); covered PENDING→`ACCEPTED`; non-EDITOR → `403`
- [x] T021 [P] [US2] `packages/frontend/src/test/unit/bom-add-to-catalog-link.test.tsx` — preview with `existingComponent` renders **Link to existing component** mode (matched component shown, no create fields), same radio outcomes + count label ("Link all 9 components"); row-menu item reads **Link to existing component** when a match exists

### Implementation for User Story 2

- [x] T022 [US2] `packages/backend/src/services/bom-curation-service.ts` — `linkPackageToComponent({purl, componentId, linkConsumers}, actor)`: 404 unknown, 409 RETIRED; same single-transaction consumer edge/suggestion/`resolvedComponentId` semantics as `addPackageToCatalog` minus the component insert
- [x] T023 [US2] `packages/backend/src/routes/packages.ts` — `POST /packages/link` (`verifySession`, `requireRole("component:edge:add")`, `linkPackageBodySchema`)
- [x] T024 [US2] `packages/frontend/src/ux/components/catalog/bom-add-to-catalog-dialog.tsx` — Link mode branch on `existingComponent` (title "Link {name} to {component}", matched-component summary, identical outcomes/submit via `useLinkPackage()` hook); row-menu labels switch on preview match state

**Checkpoint**: US1+US2 — create and dedupe paths both atomic; no duplicate identity can be created.

---

## Phase 5: User Story 3 — Run completion stages dependency suggestions + live fields (P1)

**Goal**: Completed runs resolve BOM entries to catalog components and stage `PENDING` suggestions — never edges — while the Phase-1/1b contract fields (`resolvedComponent`, `pendingSuggestionId`, `catalogComponent`, `pendingSuggestionCount`, `catalog` filters) go live.

**Independent Test**: seed a Library; complete a run reporting its package → exact resolution + `PURL_EXACT` suggestion, zero edges; name-only match → suggestion without resolution; decided pairs never re-staged (quickstart C).

### Tests for User Story 3

- [x] T025 [P] [US3] `packages/backend/test/bom-match-service.test.ts` — scoped pass over run components: `PURL_EXACT` sets `resolvedComponentId` + stages suggestion; `PURL_NAME_MATCH`/`CATALOG_SLUG_MATCH` stage without touching `resolvedComponentId`; already-edged pairs → `SUPERSEDED` tombstones; decided pairs skipped; already-PENDING refreshed idempotently (staged:0 on unchanged re-run); FAILED/CANCELLED/INTERRUPTED runs invoke nothing
- [x] T026 [P] [US3] `packages/backend/test/bom-catalog-fields.test.ts` — `GET /components/:id/bom` rows carry `resolvedComponent` + `pendingSuggestionId`; `catalog=linked|suggested|none` filters correctly (suggested precedence when both); `GET /packages` rows carry `catalogComponent` + `pendingSuggestionCount`; `catalog` filter applies at group level
- [x] T027 [P] [US3] `packages/frontend/src/test/unit/bom-in-catalog.test.tsx` — In-catalog cell states: Linked (link to component), Suggested (link to `/suggestions?kind=dependency`), empty; column absent when `bomCuration` OFF; `/packages` Catalog column same states under flag

### Implementation for User Story 3

- [x] T028 [US3] `packages/backend/src/services/bom-match-service.ts` — `generateBomMatches({componentIds})`: load unresolved `bom_entries` (NULL `resolvedComponentId`) for scope → candidate components (`externalId` identity set + name/slug indexes) → classify each entry (`PURL_EXACT` via `findComponentByPackageIdentity`; else name-match on normalized component names; else slug-match) → exact: set `resolvedComponentId` → collect (consumer, library, reason, score) pairs → `supersedeBomPairs` for already-edged + `stageBomSuggestions` for the rest; `runBomMatchPass` failure-isolated wrapper logging + `metrics` (parallel `bomMatch*` counters or the `suggestion*` family label — pick one, consistent)
- [x] T029 [US3] `packages/backend/src/services/import-run-service.ts` — invoke `runBomMatchPass({ componentIds: [...yieldedComponentIds] }, { runId })` after the `runSuggestionPass` block (completed path only); `remote-run-service.ts` — same hook in its completion path (verify the agent-mediated call site mirrors the hub one)
- [x] T030 [US3] `packages/backend/src/services/bom-service.ts` — `toListItem` populates `resolvedComponent` (join `components` on `resolvedComponentId`) and `pendingSuggestionId` (join `bom_component_suggestions` on `bomEntryId` + `status='PENDING'`) in both `listScopedBom` and merged views; `filteredBomRows` activates `query.catalog` (`linked`→`resolvedComponentId NOT NULL`, `suggested`→pending exists (and not linked), `none`→neither)
- [x] T031 [US3] `packages/backend/src/services/packages-service.ts` — `listPackages` second-pass joins `components` on `externalId = purlIdentity` for `catalogComponent` + counts distinct PENDING suggestions for `pendingSuggestionCount`; activates `query.catalog` at group level
- [x] T032 [US3] `packages/frontend/src/ux/components/catalog/component-bom.tsx` — In-catalog cell renders Linked (link to `/components/{slug}`) / Suggested (link to `/suggestions?kind=dependency`) / empty per UX-BOM-08; `packages/frontend/src/ux/app/packages/index.tsx` — Catalog column renders `catalogComponent`/`pendingSuggestionCount` states under `bomCuration`

**Checkpoint**: the queue fills from real runs; contract fields tell the truth end-to-end.

---

## Phase 6: User Story 4 — Curator reviews the dependency suggestions queue (P1)

**Goal**: `/suggestions` gains the `kind=edge|dependency` segment — grouped pending rows per library, per-row + guarded bulk decisions, shared History, unchanged product-edge behaviour and nav pill.

**Independent Test**: stage mixed-reason groups; group/expand/accept/dismiss/bulk all verified; bulk accept 409s on non-exact; History + nav pill parity (quickstart D).

### Tests for User Story 4

- [x] T033 [P] [US4] `packages/backend/test/dependency-suggestions.test.ts` — `GET /suggestions?kind=dependency` (pending/decided views, RETIRED-endpoint filtering, sort mapping parity, envelope); `GET /suggestions/dependencies/groups` (one row per `childComponentId`: `pendingCount`, `versions`, `reasons`, `topScore`, `bulkAcceptable`; sort whitelist; pagination); `/suggestions/dependencies/:id/accept` writes the edge (existing edge → `SUPERSEDED`), `/dismiss` permanent, already-decided `409`; `POST /suggestions/dependencies/bulk` `accept` 409s when any pending is non-`PURL_EXACT`, all-exact succeeds atomically (`edges` count), `dismiss` any-reason, partial edge failures reported in `failedIds` without rolling back siblings; non-EDITOR → `403`; `kind` absent → edge queue unchanged
- [x] T034 [P] [US4] `packages/frontend/src/test/unit/suggestions-dependency.test.tsx` — segment control switches `?kind=` (default `edge`, existing URLs intact); dependency pending groups render ("{name} is used by N components", reason badge, versions, purl, Accept-all/Dismiss-all); chevron expands per-component rows; name/slug groups hide Accept-all; confirm dialog states exact count + finality copy; live-region + toast on result; History rows show library/component/decider; Viewer sees no action buttons; nav badge unchanged

### Implementation for User Story 4

- [x] T035 [US4] `packages/backend/src/services/dependency-suggestion-service.ts` — `listDependencySuggestions(query)` (join components both sides + persons, pending excludes RETIRED endpoints, same effective-sort maps), `listDependencyGroups(query)` (GROUP BY `childComponentId` over PENDING + library join; `versions` = distinct entry versions via `bomEntryId`, `bulkAcceptable` = `bool_and(reason='PURL_EXACT')`), `acceptDependencySuggestion`/`dismissDependencySuggestion` (FOR UPDATE lock, PENDING guard, edge insert `ON CONFLICT DO NOTHING` → `SUPERSEDED` when uncreated, audit), `bulkDecideDependencies({childComponentId, action}, actor)` (server-side exact-only accept gate; per-pair edge failure isolation collecting `failedIds`; per-kind pending counts returned for the segment chip)
- [x] T036 [US4] `packages/backend/src/routes/suggestions.ts` — `GET /suggestions` passes `kind` (existing branch unchanged for `edge`); `GET /suggestions/dependencies/groups` (`verifySession`); `POST /suggestions/dependencies/:id/accept|dismiss` + `POST /suggestions/dependencies/bulk` (`verifySession`, `requireRole("component:edge:add")`)
- [x] T037 [US4] `packages/frontend/src/api/` — types/mappers/hooks: `useDependencySuggestions(params)`, `useDependencyGroups(params)`, `useAcceptDependency`/`useDismissDependency`/`useBulkDecideDependencies` mutations with queue + counts invalidation
- [x] T038 [US4] `packages/frontend/src/ux/app/suggestions.tsx` + new `packages/frontend/src/ux/components/catalog/dependency-suggestion-groups.tsx` — `kind` segment control beside Pending/History tabs (URL `kind`, own pending-count chip, product-edge default unchanged); grouped pending cards per UX-SUG-03/04/05/06/07/08 (badge meta, expand, exact-only Accept-all, count-bearing confirm, polite live-region + toast, History rows); subtitle updated to "Relationships Componode inferred from traces, tags, ownership and package inventories. Nothing changes in the catalog until you accept."

**Checkpoint**: the full stage→review→decide→edge loop works with only human actions writing edges.

---

## Phase 7: User Story 5 — The catalog stays legible with thousands of libraries (P2)

**Goal**: `LIBRARY` hidden by default (toggle + count), excluded from coverage, grouped provider filter, Library detail (Used-by + Versions-in-use), Relationships summary node.

**Independent Test**: seed 200+ libraries on one consumer → default list hides them (`libraries=1` reveals), coverage/dashboard unchanged, Relationships shows one summary node with `libraryCounts` (quickstart E).

### Tests for User Story 5

- [x] T039 [P] [US5] `packages/backend/test/library-legibility.test.ts` — `GET /components` excludes `LIBRARY` by default with `librariesHidden` count, `libraries=1` includes; coverage filter + dashboard denominators exclude `LIBRARY`; `GET /components/:id/relationships` returns `libraryCounts` and no LIBRARY nodes in `dependsOn`/`dependedOnBy` lanes (other lanes + `unavailableKinds` unchanged); `GET /packages/versions?purl=` returns all versions + counts
- [x] T040 [P] [US5] `packages/frontend/src/test/unit/library-surfaces.test.tsx` — Show libraries toggle + count (`?libraries=1` round-trip); provider filter renders Platforms/Package registries groups; Library detail shows identity block + Used-by + Versions-in-use (chip filters Used-by), no Instances card; Relationships renders one "N libraries" summary node; direct link to a Library resolves

### Implementation for User Story 5

- [x] T041 [US5] `packages/backend/src/services/component-catalog-service.ts` — default population excludes `category='LIBRARY'` when `libraries` param absent; response gains `librariesHidden` (count of excluded ACTIVE libraries); `catalog-coverage-service.ts` — `coveragePopulationPredicate` gains `components.category != 'LIBRARY'` (feeds Coverage filter + dashboard denominators)
- [x] T042 [US5] `packages/backend/src/services/component-relationship-service.ts` — `dependsOn`/`dependedOnBy` lane queries exclude `components.category='LIBRARY'` neighbours; separate grouped counts populate `libraryCounts` under the same degraded-family handling; `packages-service.ts` + `routes/packages.ts` — `GET /packages/versions` (all `{version, componentCount}` for the identity, sorted `componentCount desc, version asc`)
- [x] T043 [US5] `packages/frontend/src/ux/components/catalog/components-table.tsx` + `ux/lib/domain.ts` — Show libraries toggle (`?libraries=1`, label "Show libraries ({librariesHidden})"); Provider filter groups via `COMPONENT_PROVIDER_GROUPS` (*Platforms* / *Package registries*)
- [x] T044 [US5] `packages/frontend/src/ux/components/catalog/package-details.tsx` (new) + `component-detail.tsx` — LIBRARY category section: identity block (purl `MonoValue`, ecosystem, provider), **Used by** = `PackageConsumers` (reused), **Versions in use** chips from `GET /packages/versions` filtering Used-by; replaces the Instances card for LIBRARY; `component-relationships.tsx` — Libraries summary node ("{count} libraries") linking to `?tab=bom` (consumer) or Used-by (library), collapsed default

**Checkpoint**: 200+ libraries, zero noise — legibility verified by quickstart E + SC-003/SC-004.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: Flag flip, governance docs, ADRs, e2e coverage, full verification.

- [x] T045 [P] `packages/frontend/src/ux/lib/flags.ts` — `bomCuration: flagOverride("bomCuration") ?? true` + G38 doc comment; `researches/ux-rewrite-gaps.md` — `## G38 — BOM catalog curation — RESOLVED by spec 075` entry (surface: Add/Link dialogs, dependency segment, In-catalog column + filter, library detail/lane/toggles; capability: Phase-2 endpoints + `bom_component_suggestions`; flag `bomCuration`; fallback hidden) matching the G36/G37 format — flag flip landed with the frontend implementation (`?? true`); G38 entry present
- [x] T046 [P] `docs/ux.md` — §4 `/suggestions` row gains dependency segment note; §5 conventions for grouped/bulk review if enumerated; §7 flags table `bomCuration` row updated (G38, surfaces list); vocabulary — Add to catalog / Link already in CONTEXT.md, register any missing UI terms
- [x] T047 `docs/openapi.yaml` — every new/changed route from contracts/ (preview, add, link, versions, `kind` + groups + decide/bulk on suggestions, `libraries` param + `librariesHidden`, `libraryCounts`, live `catalog` filters + populated fields); `x-permission: "component:edge:add"` on writes, `security: []`-consistent session markers; run `pnpm --filter @componode/backend docs:api` to regen `docs/api.md`; `docs:oracle:check` + `docs:sidebar:check` green
- [x] T048 [P] `researches/adrs/ADR-132-catalog-promotion-of-bom-entries.md` — new ADR (Editor-only curation, Library identity = normalized version-free purl in `externalId`, `bom_component_suggestions` follows ADR-113 lifecycle, no auto-wiring ever); `ADR-013` Amendment 2 (13 providers + `cdxType`→category mapping + migration 036 CHECK rebuild); `ADR-131` note (`resolvedComponentId` now written by the Phase-2 matching pass + curation endpoints); `researches/architecture-decisions.md` index rows; `specs/023-coverage-and-hygiene/spec.md` — amendment note recording `LIBRARY` exclusion from the coverage population (UX-LIB-02)
- [x] T049 [P] `docs/roadmap.md` — `075-bom-catalog-promotion` shipped entry (catalog promotion: matching pass + `bom_component_suggestions`, Add-to-catalog/Link curation, dependency segment with grouped bulk review, library legibility surfaces, `bomCuration` flag — Phase 3 importer-native edges still deferred); revise the Next entry
- [x] T050 `playwright/` — seed fixtures (libraries, pending suggestion groups of both reason kinds, a 200-library consumer for the summary node) + `playwright/tests/journeys/bom-curation.spec.ts` (add-to-catalog preview→link-all, only-add→suggestions, link-mode dedupe, dependency segment group/expand/bulk-accept/dismiss, show-libraries toggle, library detail, relationships summary node, Viewer hidden-write surfaces, flag-off hiding) — run `pnpm e2e` subset green
- [x] T051 Full verification — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for changed packages (core, backend, frontend) + root build + `pnpm audit --prod --audit-level=high`; quickstart scenarios A–F spot-check; AGENTS.md done-criteria sweep (openapi ✅, ADRs ✅, roadmap ✅, gaps registry ✅, coverage amendment ✅)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: leaf contracts/constants/schemas — no dependencies.
- **Phase 2 (Foundational)**: migrations + RBAC + suggestion-store primitives — depends on T001–T004 for enums/mappings/row types; **BLOCKS all user stories** (`bom_component_suggestions`, provider CHECK, and the shared primitives are consumed everywhere).
- **Phase 3–6 (US1–US4, all P1)**: depend on Foundational. US1↔US2 share `bom-curation-service` + the dialog (US2 extends US1's files — sequence US1 → US2 within the same files, but Link is verifiable alone against a pre-existing component). US3 needs the staging primitives only — independent of US1/US2. US4 needs the suggestion table + primitives — independent of US1–US3's surfaces (it reads whatever rows exist; test fixtures stage rows directly).
- **Phase 7 (US5, P2)**: depends on Foundational (provider groups) and reads library data — independent of the write paths (fixture-created libraries suffice for tests).
- **Phase 8 (Polish)**: depends on all stories (flag flips ON last).

### Parallel Opportunities

- T001–T005 (Setup) all parallel.
- T006 vs T008 (migrations) sequential on migration chain but preparable in parallel; T009/T011 parallel with migrations.
- Backend test tasks ([P]) within each story parallel; frontend test tasks parallel with backend ones.
- US3 (T028–T032) and US5 (T041–T044) can run in parallel with US1/US2/US4 after Phase 2 — different files except `packages-service.ts` (T031) vs `bom-curation` routes (T016/T023) — coordinate if concurrent.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 + Phase 2 → contracts, migrations, primitives green.
2. Phase 3 (US1) → preview + atomic add/link working via API + dialog.
3. **STOP and VALIDATE** — quickstart A.

### Incremental Delivery

1. US2 (Link) → dedupe path complete → validate B.
2. US3 (pass + fields) → queue fills from runs → validate C.
3. US4 (queue UI + bulk) → review loop complete → validate D.
4. US5 (legibility) → validate E; Phase 8 → flag ON, docs, ADRs, e2e, verification.

---

## Phase 9: Convergence

- [x] T052 Fix the `catalog=suggested` BOM-row filter in `packages/backend/src/services/bom-service.ts` so pending-suggestion rows are not excluded when `resolvedComponentId` is set — apply suggested precedence over linked (suggested → pending suggestion exists regardless of resolution; linked → resolved with no pending) matching the In-catalog cell precedence per US3/AC5 + T026 (contradicts)
- [x] T053 Guard dependency-suggestion decisions against RETIRED endpoints in `packages/backend/src/services/dependency-suggestion-service.ts` — reject or skip a suggestion whose consumer is RETIRED on accept (single + bulk), exclude such rows from the bulk pending fetch so "Accept all N" matches the visible group, and report skipped rows in `failed`/`failedIds` per spec Edge Cases (partial)
- [x] T054 Restore the Link-to-existing entry point on `/packages` in `packages/frontend/src/ux/app/packages/index.tsx` — when `catalogComponent` matches the package identity the row menu must still offer the curation action (dialog opens in Link mode) rather than hiding it, so Link-all / stage-suggestions outcomes stay reachable per US2/AC1 + FR-005 (partial)
- [x] T055 Add the dependency segment's own pending-count chip on `/suggestions` (`packages/frontend/src/ux/app/suggestions.tsx`) — per-kind count on the "Component dependencies" segment while the nav pill keeps counting product edges only per US4/AC1 + T038 (partial)
- [x] T056 Sort `GET /packages/versions` rows by `componentCount desc, version asc` in `packages/backend/src/services/packages-service.ts` per contracts/bom-curation-api.md + T042 (partial)
- [x] T057 Handle the zero-ACTIVE-consumer preview case in `packages/backend/src/services/bom-curation-service.ts` — return the preview with `consumerCount: 0` (Link-all degenerates to create-only) instead of 404 when the identity has entries only on RETIRED components per spec Edge Cases (partial)
- [x] T058 Gate the Relationships "N libraries" summary node on `flags.bomCuration` in `packages/frontend/src/ux/components/catalog/component-relationships.tsx` so flag-off hides every curation surface per FR-009 (partial)

---

## Phase 10: Convergence

- [x] T059 Exclude RETIRED components from BOM match-pass candidate selection in `packages/backend/src/services/bom-match-service.ts` — the name/slug candidate query (comment claims "non-retired" but filters nothing) and `findComponentByPackageIdentity` both match RETIRED components, so the pass can set `resolvedComponentId` to a retired component and stage permanently undecidable PENDING rows on retired endpoints per FR-002 + US3/AC2 + spec Edge Cases (partial)
- [x] T060 Evaluate `catalog=suggested`/`none` on the BOM read at the entry's purlIdentity+component scope in `packages/backend/src/services/bom-service.ts` — the `ps.bomEntryId = bom_entries.id` join is row-level, so sibling version/source rows of the same identity misclassify (contract: "pending suggestion exists for the entry's identity") per contracts/bom-curation-api.md + US3/AC5 (partial)
- [x] T061 Prepare match-pass candidates in memory in `packages/backend/src/services/bom-match-service.ts` — `findComponentByPackageIdentity` runs a verbatim query plus a full `externalId ILIKE 'pkg:%'` scan per entry on miss (O(entries × candidates) scans per run); hoist to one candidate map per plan Performance Goals "in-memory candidate prep" (partial)
- [x] T062 Join `catalogComponent`/`pendingSuggestionCount` on `GET /packages` via normalized-identity equality in `packages/backend/src/services/packages-service.ts` — the verbatim `externalId = purlIdentity` join misses components whose externalId only *normalizes* to the purl (the exact cases `findComponentByPackageIdentity` catches) per contracts/packages.ts + contracts/bom-curation-api.md (partial)
- [x] T063 Scope the retired-endpoint guard in `decideOne` (`packages/backend/src/services/dependency-suggestion-service.ts`) to the accept/edge path so DISMISS stays decidable — retired-endpoint PENDING rows are currently unterminable forever per spec Edge Cases + T053 (partial)
- [x] T064 Accept multi-value `catalog` (CSV OR) on `GET /packages` in `packages/core/src/schemas/packages.ts` + `listPackages` per contracts/bom-curation-api.md "Multi-value OR, applied at the group level" (partial)

---

## Phase 11: Convergence

- [x] T065 Restore edge-queue sort parity on the pending dependency queue in `packages/backend/src/services/dependency-suggestion-service.ts` — `?kind=dependency&status=PENDING&sort=decidedAt` orders by the all-NULL `decidedAt` column; the edge queue maps `decidedAt`→`createdAt` on the pending view (`SUGGESTION_PENDING_SORT`) and the contract requires "same pending/decided sort mapping as the edge queue" per contracts/dependency-suggestions-api.md + T033 (partial)
- [x] T066 Make expanded dependency-group rows bounded-complete in `packages/frontend/src/ux/components/catalog/dependency-suggestion-groups.tsx` (plus a per-group `childComponentId` filter on the dependency list endpoint if needed) — the panel buckets a single `status=PENDING&page=1&pageSize=100` fetch, so past the first 100 pending rows a group's per-component expansion renders "could not be listed" and per-row accept/dismiss is unreachable per UX-SUG-04 + US4/AC1 (partial)
- [x] T067 Deduplicate the `catalogComponent` join in `packages/backend/src/services/packages-service.ts` so at most one component renders per package row (prefer verbatim `externalId`, then normalized) — the OR join matches every component whose externalId normalizes to the identity, duplicating the group row and splitting `pendingSuggestionCount` when manually created components carry versioned purls per contracts/bom-curation-api.md (partial)
- [x] T068 Exclude the link target from `consumerPairs`/`resolveAndWire` in `packages/backend/src/services/bom-curation-service.ts` so a target that also consumes the package can never self-wire an edge or stage a self-suggestion — the match pass skips self-pairs ("never self-suggest") but the curation paths do not per FR-004 + spec Edge Cases (partial)
- [x] T069 Document `catalog` as multi-value/CSV on `GET /packages` in `docs/openapi.yaml` — the contract requires "Multi-value OR, applied at the group level" but the param is described as a single string enum while sibling params document "CSV of …" per contracts/bom-curation-api.md + FR-008 (partial)

---

## Phase 12: Convergence

- [x] T070 Match `normalizePurlIdentity` semantics in the `catalogCandidates` subquery in `packages/backend/src/services/packages-service.ts` — the unconditional `lower()` never equals `bom_entries.purlIdentity` for uppercase-bearing identities (packageurl-js preserves case for maven/nuget/cargo/gem/generic/rpm/docker/github; verified `pkg:nuget/Newtonsoft.Json`), and misses pypi `_`→`-` and `%40` encoding — so `catalogComponent`/`pendingSuggestionCount` are null/0 and `catalog=linked|suggested` filters miss such packages per contracts/bom-curation-api.md §GET /packages + US3/AC5 (partial)
- [x] T071 Make expanded dependency-group rows bounded-complete past 100 in `packages/frontend/src/ux/components/catalog/dependency-suggestion-groups.tsx` — the per-group fetch caps at `pageSize:100` with no paging/truncation indicator, so rows 101+ of a large group are unreachable for per-row accept/dismiss (the only path when `bulkAcceptable` is false) per UX-SUG-04 + US4/AC1 (partial)
- [x] T072 Return 404 for an unknown `childComponentId` in `bulkDecideDependencies` (`packages/backend/src/services/dependency-suggestion-service.ts`) — it currently returns 200 with a zeroed result while the contract lists `NOT_FOUND` for unknown `childComponentId` per contracts/dependency-suggestions-api.md §Errors (partial)
- [x] T073 Label the BOM-tab curation row-menu item "Link to existing component" when the package identity already matches a component (or record why the label stays "Add to catalog") — `/packages` switches labels via `catalogComponent` but `component-bom.tsx` cannot detect the match, so the menu says "Add to catalog" while the dialog opens in Link mode per US2/AC1 + spec vocabulary (partial)

---

## Phase 13: Convergence

- [x] T074 Remove the stray `.orderBy("bom_entries.version")` on the `grouped` builder in `listPackageVersions` (`packages/backend/src/services/packages-service.ts`) — Kysely `orderBy` is additive, so the effective ORDER BY is `version ASC, componentCount DESC, version ASC` and `GET /packages/versions` sorts version-asc first instead of the contracted `componentCount desc, version asc` (T056 marked done but the inner order was never cleared); add a multi-version ordering assertion per contracts/bom-curation-api.md §GET /packages/versions (contradicts)
- [x] T075 Reconcile `GET /packages` `catalogComponent`/`catalog=linked` with the documented identity semantics — the field now derives from `bom_entries.resolvedComponentId` (the T070 aggregation), so a component whose `externalId` normalizes to the row's purl but whose entries were never resolved (e.g. a manually created purl externalId whose consumers have not completed a run since — persistent for dormant/one-shot imports) reports `catalogComponent: null`, is missed by `catalog=linked`, and labels the row action "Add to catalog"; either resolve the documented match at read/write time or amend the contract + `docs/openapi.yaml` wording per contracts/bom-curation-api.md §GET /packages + US3/AC5 (partial)

---

## Phase 14: Convergence

- [x] T076 Apply the queue's retired-endpoint rule to the pending-suggestion signals feeding `GET /packages` and the BOM list — `pc` in `packages-service.ts` and `ps` in `bom-service.ts` count/flag PENDING rows whose parent *or* child is RETIRED while `listDependencySuggestions`/`listDependencyGroups` (and the segment's pending chip) hide them, so "N suggested" / "Suggested" can point at queue-invisible rows; also decide whether the `catr` `catalogComponent` leg should exclude RETIRED resolved components for parity with the explicitly non-retired `catv` per contracts/dependency-suggestions-api.md §pending + contracts/bom-curation-api.md §GET /packages + US3/AC5 (partial)
- [x] T077 Count `versions` over all underlying entries per pending (parentComponentId, purlIdentity) pair in `listDependencyGroups` (`packages/backend/src/services/dependency-suggestion-service.ts`) — the single representative `bomEntryId` join contributes only one version per consumer, undercounting a multi-version consumer's spread (or document the representative-entry semantics in the contract + `docs/openapi.yaml`) per contracts/dependency-suggestions-api.md §groups + contracts/bom-component-suggestion.ts "distinct versions reported on the underlying entries" (partial)
- [x] T078 Land a covered PENDING row as `SUPERSEDED` (not `ACCEPTED`) in `resolveAndWire`'s `alreadyLinked` branch (`packages/backend/src/services/bom-curation-service.ts`) — the contract says "pairs already edged → SUPERSEDED" and `decideOne` implements exactly that; the Link-all→ACCEPTED carve-out covers edges the action itself writes per contracts/bom-curation-api.md §POST /packages/add-to-catalog + data-model.md state machine (partial)
- [x] T079 Prefer a non-null `resolvedComponentId` when picking the group's catalog component in `listPackages` (`packages/backend/src/services/packages-service.ts`) — `array_agg(resolvedComponentId ORDER BY lastReportedAt DESC NULLS LAST)[1]` returns the newest entry's value, so one unresolved newest entry hides older resolutions even though the identity resolved (e.g. a new version entry awaiting its first pass) per contracts/bom-curation-api.md §GET /packages (partial)
- [x] T080 Update the `catalogComponent` doc comment in `packages/core/src/contracts/packages.ts` ("component whose externalId normalizes to this purl") to the resolved-then-verbatim semantics T075 landed in contracts/bom-curation-api.md + `docs/openapi.yaml` (partial)
- [x] T081 Wire the `/suggestions?kind=dependency` pending `ListSortSelect` to the groups endpoint's sort whitelist (score|components|name) or hide it on that view — `DependencyGroupsPanel` hardcodes `sort:"score"` so the shared control is inert and offers keys the endpoint rejects per contracts/dependency-suggestions-api.md §groups + UX-SUG-03 (partial)

---

## Phase 15: Convergence

- [x] T082 Decouple suggestion lifecycle from factual-row retention — `bom_component_suggestions.bomEntryId` is `NOT NULL` + `ON DELETE CASCADE` (migration 035), so `deleteAbsentBomEntries` pruning a stale entry (version bump, dropped scope, any completed-run diff-replace) deletes the row's decided suggestion and the `UNIQUE(parent,child)` guard with it; the next match pass then re-stages the pair as actionable `PENDING` — DISMISSED pairs resurrect and ACCEPTED/DISMISSED history silently vanishes. Make `bomEntryId` nullable + `ON DELETE SET NULL` (migration amendment + `db/types.ts` + `listDependencyGroups` rep join + `filteredBomRows` pendingIds join + `supersedeBomPairs` tombstone inserts made NULL-tolerant) or land an equivalent pair-durability mechanism per FR-003 + SC-006 + spec Edge Cases "Re-run after decisions" + Constitution V (contradicts)
- [x] T083 Refresh stale "inert until Phase 2" comments now that the catalog surfaces are live — `packages-service.ts` `listPackages` docstring ("stays inert until Phase 2 … ship as null/0 placeholders"), `schemas/packages.ts` `listPackagesQuerySchema` docstring ("accepted-and-ignored until Phase 2"), and `packages/index.tsx` `PACKAGE_FILTERS` + catalog-filter comments ("stays inert"/"accepted-and-ignored") per contracts/bom-curation-api.md §deltas + US3/AC5 (partial)

---

## Phase 16: Convergence

- [x] T084 Fix the failing stale `catalog` schema test in `packages/core/test/packages-schemas.test.ts` — the case at line 36 ("accepts the inert catalog filter") asserts `q.catalog === "linked"` but T064 made `catalog` a CSV/array param (`splitCsvParam` → `z.array`), so `pnpm --filter @componode/core test` fails 1/11 (received `["linked"]`); assert `toEqual(["linked"])`, add a multi-value (`"linked,suggested"` → both entries) case, and rename the test to the live multi-value semantics per T064 + Constitution VI (contradicts)
- [x] T085 Make the BOM pending classification NULL-rep tolerant and heal the representative pointer on re-stage — `filteredBomRows.pendingIds` (`packages/backend/src/services/bom-service.ts:259`) still inner-joins `bom_entries` on `be.id = s.bomEntryId`, so a PENDING pair whose representative entry was pruned (SET NULL, migration 037) silently drops out of `pendingSuggestionId`/`catalog=suggested` while the queue still shows it pending; and `stageBomSuggestions`' ON CONFLICT (`packages/backend/src/services/bom-suggestion-store.ts:75-93`) refreshes only `reason`/`score`, never restoring `bomEntryId` to a live rep — the NULL never heals even when the pass re-stages the pair from a sibling entry. Update `bomEntryId` on PENDING conflict updates and/or derive the (component, purlIdentity) scope without the rep (e.g. verbatim child `externalId` for PURL_EXACT); amend the `pendingSuggestionId` derivation wording in `data-model.md`/`contracts/bom-curation-api.md` if it changes per T082 + FR-003 + US3/AC5 + contracts/bom-curation-api.md §BOM read (partial)
- [x] T086 Mark `bomEntryId` nullable in `docs/openapi.yaml` — `DependencySuggestion.bomEntryId` (line ~5840) is `type: string, format: uuid` with no `nullable: true`, but the column + core contract are `string | null` post-037 (rows legitimately return NULL after rep pruning); also note the nullable semantics in `contracts/dependency-suggestions-api.md` per ADR-104 + contracts/bom-component-suggestion.ts (partial)
- [x] T087 Add migration-037 coverage to `packages/backend/test/integration/bom-suggestions-migration.test.ts` — nothing asserts the load-bearing T082 behavior: deleting the representative `bom_entries` row must SET NULL `bomEntryId` (suggestion row + pair guard survive; a decided pair stays terminal and is never re-staged) and `down()` must prune NULL rows and restore NOT NULL + CASCADE per Constitution VI + T082 + SC-006 (missing)
- [x] T088 Fix stale pre-037 comments — `packages/backend/src/services/bom-suggestion-store.ts:35` `BomCoveredPair.bomEntryId` says "(column is NOT NULL)" and `packages/backend/test/integration/bom-suggestions-migration.test.ts:5-7` header claims 035 creates the table with "cascades" for the FKs (bomEntryId is SET NULL after 037 applies) per T082 + T083 (partial)

---

## Phase 17: Convergence

- [x] T089 Apply the same NULL-rep fallback to the `versions` count in `listDependencyGroups` (`packages/backend/src/services/dependency-suggestion-service.ts:222-230`) — the `be2` join keys only on `rep.purlIdentity`, so a PENDING row whose representative entry was pruned (bomEntryId SET NULL, migration 037) contributes `versions: 0` even when surviving sibling entries of the same (consumer, identity) pair still report versions; T085 applied `coalesce(rep.purlIdentity, child.externalId)` in `filteredBomRows.pendingIds` for exactly this case — derive the `be2` identity the same way so library children recover the spread (non-purl externalIds still join nothing) per T085 + contracts/dependency-suggestions-api.md §groups "versions = distinct versions reported on the underlying entries" (partial)
- [x] T090 Update the spec contract docs to post-037 semantics — `contracts/dependency-suggestions-api.md` shows `"bomEntryId": "…"` with no note that it is nullable (SET NULL on BOM pruning, decided pairs stay terminal), and `contracts/bom-curation-api.md` §BOM-read deltas (line ~91) + `data-model.md` (line ~68) still describe `pendingSuggestionId` as a "PENDING `bom_component_suggestions.bomEntryId` join" while the implementation derives it at (componentId, purlIdentity) scope via a NULL-tolerant LEFT rep join with `coalesce(rep.purlIdentity, sc.externalId)` — T085 conditioned the wording amendment on the derivation changing (it did) and T086 required the nullable note per T085 + T086 + contracts/bom-curation-api.md §BOM read (partial)

---

## Phase 18: Review (code-review: spec)

- [x] T091 Close the duplicate-identity TOCTOU in `addPackageToCatalog` (`bom-curation-service.ts:307-323`) — `findComponentByPackageIdentity` runs outside the transaction and `components.externalId` has no unique index, so concurrent adds can mint two Libraries with the same identity per FR-005 "MUST never create a duplicate identity" (HIGH)
- [x] T092 `/packages/link` mints `reason: "PURL_EXACT"` unconditionally for any chosen `componentId` (`bom-curation-service.ts:235`) — no server-side check that the target matches the package identity, laundering non-exact pairs past the exact-only bulk-accept gate; classify the reason honestly (exact identity → PURL_EXACT, name → PURL_NAME_MATCH, slug → CATALOG_SLUG_MATCH, none → don't stage or stage with the weakest honest reason) per FR-006 + US4 (HIGH)
- [x] T093 Link-mode radio copy "Only link" (`bom-add-to-catalog-dialog.tsx:228`) actually stages suggestions — contradicts US2's "leave as suggestions" label semantics; align copy with behavior (MEDIUM)
- [x] T094 SC-005 says `GET /components/:id/relationships` reports library deps in `dependsOn`, but lanes exclude LIBRARY by design and surface via `libraryCounts` (contract deliberately reinterprets) — amend spec.md wording or record the reinterpretation explicitly (MEDIUM)
- [x] T095 FR-006 "server-rejected unless every targeted suggestion is PURL_EXACT" — retired-endpoint non-exact rows are filtered before the check and counted `failed` rather than rejecting; justify against the failedIds partial-success contract or change to strict reject (MEDIUM)
- [x] T096 US4-AC2 "offer retry for the failed subset" — bulk failure toast only says "review them one by one" (`dependency-suggestion-groups.tsx:163`); failed rows stay PENDING so re-running bulk retries them — surface that affordance in copy or a retry action (MEDIUM)
- [x] T097 Dashboard headline `components.total`/`deltas.components` still count LIBRARY rows (`dashboard-service.ts`); only coverage math excludes them — verify against SC-003/US5-AC2 scope and justify or exclude (LOW)
- [x] T098 `/packages` `catalogComponent` verbatim join misses versioned `externalId` values that normalize to the identity (e.g. `pkg:npm/lodash@4.x`) — row shows "—"/"Add to catalog" while the dialog enters Link mode; document or extend coverage of the resolved-then-verbatim semantics (LOW)
- [x] T099 `packageSlugToken` exported from core but unused outside tests (backend uses its own `slugify`) — remove dead export or adopt it (LOW, scope creep)

---

## Phase 19: Review (code-review: spec, round 2)

- [x] T100 Dedupe `(parent,child)` pairs inside `stageBomSuggestions` before batching — `generateBomMatches` emits one pair per BOM entry, so duplicate pairs in a single INSERT..ON CONFLICT batch trigger Postgres "cannot affect row a second time" after resolvedComponentId updates commit (HIGH)
- [x] T101 `findComponentByPackageIdentity` ignores RETIRED owners — Add can mint a second component with the same normalized identity; include retired owners in the duplicate guard (MEDIUM)
- [x] T102 Link target can retire between the outer lifecycle check and `resolveAndWire` — re-check `lifecycle` `FOR UPDATE` inside the transaction (MEDIUM)
- [x] T103 Already-wired pairs can be staged as PENDING in `resolveAndWire`'s stage branch — check `component_depends_on_component` and flip covered pairs to SUPERSEDED like the match pass (MEDIUM)
- [x] T104 CATALOG_SLUG_MATCH staged at 0.5 — use the configured reason→score map (LOW)
- [x] T105 `/suggestions/dependencies/:id/accept|dismiss` casts raw `req.params` — malformed UUIDs 500 instead of VALIDATION_FAILED (MEDIUM)
- [x] T106 Normative UX deltas: "View library component" row-menu item on resolved BOM rows; Suggested/cell links filtered to the package's group where contract supports it (MEDIUM)
- [x] T107 FR-011 e2e gaps: journey never opens the curation dialog, no Library detail/relationships-summary coverage, Viewer row-menu assertion doesn't open a menu (MEDIUM)
