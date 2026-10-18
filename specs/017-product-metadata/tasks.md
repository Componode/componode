---

description: "Task list for 017-product-metadata implementation"
---

# Tasks: Practical Catalog Metadata

**Input**: Design documents from `/specs/017-product-metadata/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included — constitution VI (test-first) is non-negotiable; each story phase orders tests before implementation.

**Organization**: Tasks grouped by user story; each story is independently testable after the foundational phase.

## Phase 1: Setup

- [x] T001 Run `pnpm install && pnpm typecheck` on `feature/017-product-metadata` to confirm green baseline

## Phase 2: Foundational (blocking all user stories)

*Shared schema/migration work every story depends on.*

- [x] T002 Create migration `packages/backend/src/db/migrations/012_practical_metadata.ts` — on `digital_products` add `links jsonb NOT NULL DEFAULT '[]'`, `tags text[] NOT NULL DEFAULT '{}'`, `criticality text NULL` with `CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW'))`, `sunsetAt timestamptz NULL`; on `components` add `links`, `tags`, `sunsetAt` (same shapes, no `criticality`); GIN indexes `digital_products_tags_gin` and `components_tags_gin`; symmetric `down()`
- [x] T003 [P] Add `CRITICALITIES = ["CRITICAL","HIGH","MEDIUM","LOW"] as const` + `ProductCriticality` type in `packages/core/src/constants/criticality.ts`, exported via `packages/core/src/constants/index.ts` (ADR-079 pattern)
- [x] T004 [P] Create `packages/core/src/schemas/metadata.ts` — `linkSchema` `{title: z.string().min(1).max(80), url: http/https only}`, `linksSchema` array ≤20, `tagSchema` charset `[a-z0-9][a-z0-9._:-]{0,31}` (first char alphanumeric) with lowercase/trim transform, `tagsSchema` array ≤20 with dedupe
- [x] T005 Add `Link` interface plus `links`/`tags`/`criticality`/`sunsetAt` fields to `DigitalProduct` in `packages/core/src/contracts/digital-product.ts` and `links`/`tags`/`sunsetAt` to `Component` in `packages/core/src/contracts/component.ts`
- [x] T006 Export new constant, metadata schemas, and `ProductCriticality`/`Link` types from `packages/core/src/index.ts`
- [x] T007 Backend testcontainers test asserting migration columns, defaults, and CHECK rejection of invalid `criticality` in `packages/backend/test/integration/metadata-migration.test.ts`
- [x] T008 Surface the new fields in `packages/frontend/src/api/types.ts` (Product/Component response types) and the product/component hooks in `packages/frontend/src/api/hooks/` so every UI task can read `links`/`tags`/`criticality`/`sunsetAt`

**Checkpoint**: migration applies cleanly; core package compiles with new types/schemas; frontend types carry the fields.

## Phase 3: User Story 1 — Reference links (Priority: P1) 🎯 MVP

**Goal**: Titled links on products and components, rendered and clickable on detail pages.

**Independent Test**: Create a product with 2 links → detail page shows them in order, clickable.

- [x] T009 [US1] Backend integration test — `POST /products` and `PATCH /products/:id` round-trip `links`; `400 VALIDATION_FAILED` on non-http(s) URL, empty title, title >80 chars, 21st link; assert metadata changes write an `entity_changes` audit row and that a PATCH omitting `links` leaves it unchanged (FR-011/FR-012) in `packages/backend/test/integration/product-links.test.ts`
- [x] T010 [P] [US1] Backend integration test — `PATCH /components/:id` accepts and persists `links` preserving order; assert the `component:update` permission gate still applies (FR-014) in `packages/backend/test/integration/component-metadata.test.ts`
- [x] T011 [P] [US1] Frontend unit test — link editor validation + ordering behavior in `packages/frontend/src/test/unit/links-editor.test.tsx`
- [x] T012 [US1] Add `links: linksSchema.optional()` to `createProductSchema` and `updateProductSchema` in `packages/core/src/schemas/product.ts`
- [x] T013 [US1] Wire `links` through create/update/read/list paths in `packages/backend/src/services/product-service.ts`
- [x] T014 [US1] Generalize component update: extend schema to `updateComponentSchema` (existing `{componentGroupId, teamOwnerId}` plus curated fields) and `assignComponentGroup` → `updateComponent` preserving group-assignment behavior in `packages/core/src/schemas/components.ts` and `packages/backend/src/services/component-group-service.ts`; swap schema in `packages/backend/src/routes/components.ts`
- [x] T015 [P] [US1] Build `LinksEditor` (title+URL rows, add/remove, max 20) and `LinksCard` (renders via `safeUrl()`) in `packages/frontend/src/components/metadata/`
- [x] T016 [US1] Integrate `LinksEditor` into `packages/frontend/src/components/products/product-form.tsx` and the component edit surface
- [x] T017 [US1] Render `LinksCard` on `packages/frontend/src/pages/product-detail.tsx` and `packages/frontend/src/pages/component-detail.tsx`

**Checkpoint**: US1 demoable end-to-end; `pnpm test` green for link paths.

## Phase 4: User Story 2 — Tags + filter (Priority: P1)

**Goal**: Normalized free-form tags on both entities with single-tag list filtering.

**Independent Test**: Tag 2 products `pci`, filter `?tag=pci` → exactly those 2.

- [x] T018 [US2] Backend integration test — `?tag=` exact-match filter on `GET /products` and `GET /components`; write-time normalization (`PCI`, ` pci ` → `pci`) + dedupe; 400 on charset/length/count violations in `packages/backend/test/integration/tag-filters.test.ts`
- [x] T019 [P] [US2] Frontend unit test — tag input normalization display + list filter control in `packages/frontend/src/test/unit/tags-input.test.tsx`
- [x] T020 [US2] Add `tags: tagsSchema.optional()` to product create/update schemas in `packages/core/src/schemas/product.ts`
- [x] T021 [US2] Add `tag: z.string().optional()` to `listProductsQuerySchema` and apply `tags @> ARRAY[tag]` filter in `packages/backend/src/services/product-service.ts`
- [x] T022 [US2] Add `tag` to `listComponentsQuerySchema` + filter in `packages/backend/src/services/component-catalog-service.ts`; add `tags` to `updateComponentSchema` (extends T014 schema)
- [x] T023 [P] [US2] Build `TagsInput` (chips entry, normalization preview) and tag chip/badge renderer in `packages/frontend/src/components/metadata/`
- [x] T024 [US2] Integrate `TagsInput` into `product-form.tsx` + component edit; render tag chips on `product-detail.tsx` + `component-detail.tsx`
- [x] T025 [US2] Add tag filter control to `packages/frontend/src/pages/products.tsx` and `packages/frontend/src/pages/components.tsx` list pages

**Checkpoint**: US2 demoable; tag filter works on both list pages.

## Phase 5: User Story 3 — Criticality (Priority: P2)

**Goal**: `CRITICAL|HIGH|MEDIUM|LOW` on products, filterable, badged.

**Independent Test**: Set `CRITICAL` on one product, filter `?criticality=CRITICAL` → only it appears with badge.

- [x] T026 [US3] Backend integration test — criticality create/update/clear (`null`) round-trip; 400 on non-enum value; `?criticality=` filter; negative assertion that `PATCH /components/:id` rejects/does not persist a `criticality` field (FR-008); `product:update` gate applies (FR-014) in `packages/backend/test/integration/product-criticality.test.ts`
- [x] T027 [P] [US3] Frontend unit test — criticality select + badge rendering in `packages/frontend/src/test/unit/product-criticality.test.tsx`
- [x] T028 [US3] Add `criticality: z.enum(CRITICALITIES).nullable().optional()` to product create/update schemas in `packages/core/src/schemas/product.ts` and wire through `packages/backend/src/services/product-service.ts`
- [x] T029 [US3] Add `criticality` filter to `listProductsQuerySchema` + service filter in `packages/backend/src/services/product-service.ts`
- [x] T030 [US3] Add criticality select to `product-form.tsx`; badge on `product-detail.tsx` header and `products.tsx` list rows per `docs/ux.md` badge conventions

**Checkpoint**: US3 demoable; component detail shows no criticality anywhere.

## Phase 6: User Story 4 — Sunset date (Priority: P2)

**Goal**: Optional `sunsetAt` on products and components with three-state badge; never auto-transitions.

**Independent Test**: `sunsetAt` +60d → neutral badge; past date on ACTIVE → red "Sunset overdue".

- [x] T031 [US4] Backend integration test — `sunsetAt` set/clear (`null`) round-trip on product and component; 400 on malformed date; PATCH omitting `sunsetAt` leaves it unchanged (FR-011); clearing with `null` persists (contracts/api.md) in `packages/backend/test/integration/sunset.test.ts`
- [x] T032 [P] [US4] Frontend unit test — badge derivation: >30d neutral, ≤30d amber "Sunset in {n}d", past+ACTIVE red "overdue", RETIRED suppresses overdue in `packages/frontend/src/test/unit/sunset-badge.test.tsx`
- [x] T033 [US4] Add `sunsetAt: z.string().datetime().nullable().optional()` to product schemas and `updateComponentSchema`; wire through `product-service.ts` and component update service
- [x] T034 [US4] Build `SunsetBadge` with 3-state derivation + date input in `packages/frontend/src/components/metadata/`; integrate into product + component forms
- [x] T035 [US4] Render `SunsetBadge` on `product-detail.tsx`, `component-detail.tsx`, and `products.tsx`/`components.tsx` list rows

**Checkpoint**: US4 demoable; no lifecycle change occurs when a date passes.

## Phase 7: Polish & Cross-Cutting

- [x] T036 Update `docs/openapi.yaml` — new body fields on `POST/PATCH /products`, `PATCH /components/:id`; `tag`/`criticality` query params on list endpoints; new response fields; run `pnpm --filter @componode/backend docs:api` to regenerate `docs/api.md` (ADR-104; contract test must pass)
- [x] T037 [P] FR-015 regression test — curated `links`/`tags`/`sunsetAt` on a component survive an importer reconcile upsert in `packages/backend/test/integration/metadata-importer-safety.test.ts`
- [x] T038 [P] Update `docs/digital-products.md` (metadata section) and `CONTEXT.md` (new field vocabulary: links/tags/criticality/sunsetAt)
- [x] T039 Update `docs/roadmap.md` — move `017-product-metadata` to Shipped
- [x] T040 Run full gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and walk every `quickstart.md` scenario

## Dependencies

```text
Phase 1 (Setup) → Phase 2 (Foundational) → {US1, US2, US3, US4} → Phase 7 (Polish)

US1 (links):        Foundational only
US2 (tags):         Foundational only
US3 (criticality):  Foundational only
US4 (sunsetAt):     Foundational only
T014 (component update generalization) is shared by US1/US2/US4 — earliest story owns it.
```

## Parallel Execution

- **Foundational**: T003 ∥ T004 ∥ T005 (different files, then T006/T008 aggregate)
- **Per story**: backend test ∥ frontend test (T009 ∥ T011, T018 ∥ T019, T026 ∥ T027, T031 ∥ T032); UI components ∥ service wiring (T015 ∥ T013)
- **Stories**: after Phase 2, any agent can take a different story — only shared file is `product-service.ts`/`product.ts` schemas (serialize schema edits within a story)

## Implementation Strategy

**MVP**: Phase 1 + Phase 2 + Phase 3 (US1 links) — a complete, demoable
increment (links end-to-end). Then US2 (tags), US3, US4 in order. Polish is
the merge gate.

**Suggested checkpoint per phase**: `pnpm lint && pnpm typecheck && pnpm test`
must stay green; ADR-104 openapi sync (T036) and roadmap update (T039) gate
the PR.

## Phase 8: Convergence

- [x] T041 Surface field-level validation messages in forms — map the first `details` issue (zod) to a readable message in `ProductForm` and `ComponentMetadataForm` instead of generic "Invalid input" per US1/AC3 + US2/AC4 (partial)
- [x] T042 Normalize the `tag` query param (trim + lowercase via the tag normalization) in `listProductsQuerySchema` and `listComponentsQuerySchema` so `?tag=PCI` matches stored `pci` per FR-005/FR-006 (partial)
- [x] T043 Add regression assertions that `PATCH /products/:id` and `PATCH /components/:id` with `links: []` / `tags: []` persist empty collections (not null/error) per spec Edge Cases (partial)
- [x] T044 Annotate the type-change-guard comment in `packages/backend/src/services/product-service.ts` noting the PLATFORM COMPOSES-parent restriction is rescinded by ADR-109 and relaxed by 018-edge-rule-ergonomics per ADR-109 (contradicts)
- [x] T045 Correct test-path references in `specs/017-product-metadata/tasks.md` (was `packages/backend/src/test/integration/`) to `packages/backend/test/integration/` per tasks.md accuracy (unrequested)
