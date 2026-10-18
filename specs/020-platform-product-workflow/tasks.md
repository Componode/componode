# Tasks: Platform Product Workflow

**Input**: Design documents from `/specs/020-platform-product-workflow/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/api.md, quickstart.md

**Tests**: Constitution VI (Test-First) is non-negotiable — every story's
test tasks are written first and must FAIL before its implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are repo-relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared contracts needed by every story.

- [X] T001 Add `promoteToPlatformSchema` to `packages/core/src/schemas/product.ts` — `.strict()` object with optional `name` (1–200), `slug` (slugPattern, max 100), `description` (max 2000, nullable), `lobOwnerId`/`teamOwnerId` (uuid, nullable), `links`, `tags`, `criticality`, `sunsetAt` (same shapes as `createProductSchema`), and `consumerIds` (`z.array(z.string().uuid()).max(500)`); `type` is NOT accepted — the created product is always `PLATFORM`. Add `PlatformCandidate`, `ComponentDependent`, and `PromoteToPlatformResult` types to `packages/core/src/contracts/digital-product.ts` matching data-model.md. Re-export both from `packages/core/src/index.ts` (and `contracts/index.ts` / `schemas/index.ts` if they enumerate exports).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Service scaffold + shared query helper used by all stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Create `packages/backend/src/services/platform-promotion-service.ts` with the service skeleton, the local `notFound`/`conflict` error helpers (mirroring `product-edge-service.ts` conventions — `statusCode` + `code` on thrown Errors), and the shared `listComponentDependents(componentId)` query: `product_depends_on_component` ⋈ `digital_products` selecting `{id, name, slug, type}`, filtered `lifecycle != 'RETIRED'`, ordered by name. US1 uses the file's helpers; US2/US3 use this function directly.

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Spot shared components that should be platforms (Priority: P1) 🎯 MVP

**Goal**: `GET /components/platform-candidates` lists `ACTIVE` components with
direct `DEPENDS_ON` edges from ≥2 distinct non-`RETIRED` products; a
"Platform candidates" section on the dashboard renders them.

**Independent Test**: Wire two products to one component — the endpoint
returns it with `dependerCount: 2` and the dashboard card lists it. Works
with zero promotions ever performed.

### Tests for User Story 1 — write FIRST, ensure they FAIL

- [X] T003 [P] [US1] Integration tests for `GET /api/v1/components/platform-candidates` in `packages/backend/test/integration/platform-workflow.test.ts` (testcontainers): (a) component with direct edges from 2 active products is listed with `dependerCount: 2` and both products in `dependents`; (b) dependerCount 1 not listed; (c) `RETIRED` product dependents excluded and a `RETIRED` component never listed; (d) a product reaching the component only via a `ComponentGroup` edge does NOT count; (e) a `PLATFORM`-type dependent DOES count; (f) ordering by dependerCount desc then name; (g) empty catalog → `{candidates: []}`; (h) route resolves as the static candidates route, not `GET /components/:id`; (i) unauthenticated → 401.
- [X] T004 [P] [US1] Frontend unit test for the candidates card in `packages/frontend/src/test/unit/platform-candidates.test.tsx`: renders "«name» — depended on by N products" rows with component links AND the dependent product names as `/products/{slug}` links; section hidden when `candidates` is empty; loading/error states follow existing card conventions.

### Implementation for User Story 1

- [X] T005 [US1] Implement `listPlatformCandidates()` in `packages/backend/src/services/platform-promotion-service.ts`: one grouped Kysely query — `product_depends_on_component` ⋈ `components` (lifecycle != 'RETIRED') ⋈ `digital_products` (lifecycle != 'RETIRED'), `COUNT(DISTINCT productId) >= 2`, returning `{component: {id,name,slug,category,provider}, dependerCount, dependents: [{id,name,slug,type}]}` ordered dependerCount desc then component name. Parameterized queries only (ADR-084).
- [X] T006 [US1] Register `GET /components/platform-candidates` in `packages/backend/src/routes/components.ts` — `verifySession` only (any authenticated role); returns `200 {candidates}`. Confirm `find-my-way` resolves it ahead of `/components/:id` (static precedence).
- [X] T007 [US1] Add `PlatformCandidate` type to `packages/frontend/src/api/types.ts` and `usePlatformCandidates()` hook (queryKey `["platform-candidates"]`) to `packages/frontend/src/api/hooks/components.ts`.
- [X] T008 [US1] Render a "Platform candidates" section in `packages/frontend/src/pages/dashboard.tsx` after the attention block: Card listing each candidate as "«component name» — depended on by N products" linking to `/components/{id}`, AND listing that candidate's `dependents[]` as links to `/products/{slug}` so any role can inspect which products depend (FR-003 — inspection must not be gated behind the EDITOR-only dialog); hidden when the list is empty or on error; follows the page's existing section/Card conventions.
- [X] T009 [US1] Add `GET /components/platform-candidates` to `docs/openapi.yaml` (no `x-permission`; authenticated — no `security: []`) and regenerate `docs/api.md` via `pnpm --filter @componode/backend docs:api`.

**Checkpoint**: User Story 1 fully functional — candidates visible on the
dashboard; independently demoable.

---

## Phase 4: User Story 2 — Promote a shared component into a governed platform (Priority: P2)

**Goal**: `POST /components/:id/promote-to-platform` atomically creates a
`PLATFORM` product, wires its `DEPENDS_ON` edge, and converts selected
consumer edges to `CONSUMES_FROM`; the promote dialog offers name/metadata/
owner fields plus an all-checked consumer checklist.

**Independent Test**: Promote a candidate with two consumers — afterwards a
`PLATFORM` product exists depending on the component, both consumers show
"Consumes from" the platform, and audit carries every change.

### Tests for User Story 2 — write FIRST, ensure they FAIL

- [X] T010 [P] [US2] Integration tests for `GET /api/v1/components/:id/dependents` in `packages/backend/test/integration/platform-workflow.test.ts`: returns each non-`RETIRED` product with a direct edge (`{id,name,slug,type}`, name-ordered); excludes `RETIRED` products and group-only reach; `[]` when none; `404 NOT_FOUND` for unknown component; any authenticated role including VIEWER → 200, unauthenticated → 401.
- [X] T011 [P] [US2] Integration tests for `POST /api/v1/components/:id/promote-to-platform` in `packages/backend/test/integration/platform-workflow.test.ts`: (a) happy path — 201, product `type:PLATFORM`/`lifecycle:ACTIVE`, `product_depends_on_component(platform, component)` inserted, each consumer's row deleted and `product_consumes_from(consumer, platform)` inserted, audit has entity `created` + `DEPENDS_ON_COMPONENT added` + per-consumer `removed`/`added` pair; (b) `consumerIds` subset — unchecked consumer keeps its `DEPENDS_ON` edge; (c) stale `consumerIds` → `400 VALIDATION_FAILED` with `details.offendingIds` and ZERO writes; (d) retired component → `409 CONFLICT`; (e) explicit taken slug → `409 SLUG_TAKEN`, derived-slug collision → `-2` suffix; (f) zero-consumer component → 201 consumerless platform; (g) unknown component → 404; (h) VIEWER → `403 AUTH_FORBIDDEN`; (i) unknown body field → 400 (strict schema); (j) a consumer that also reaches the component via a `ComponentGroup` edge keeps the group edge intact and still expands to the component after its direct edge is rewritten; (k) after a full rewrite the component no longer appears in `GET /components/platform-candidates` (FR-010/SC-006).
- [X] T012 [P] [US2] Frontend unit test for the dialog in `packages/frontend/src/test/unit/promote-dialog.test.tsx`: pre-fills name/slug from the component; consumer checklist all-checked by default and unchecked consumers are excluded from the POST body (`consumerIds`); owner selects optional; submit POSTs and navigates to `/products/{new slug}`; API error renders via `describeApiError`.

### Implementation for User Story 2

- [X] T013 [US2] Implement `promoteComponentToPlatform(componentId, rawInput, actor)` in `packages/backend/src/services/platform-promotion-service.ts` per data-model.md §Transaction invariants: parse `promoteToPlatformSchema`; inside ONE `db.transaction()` — component exists (404) and `lifecycle != 'RETIRED'` (409 `CONFLICT`); resolve consumer set (`consumerIds` ?? all active direct consumers; each provided id must be in that set else 400 with `details.offendingIds`); name = `input.name ?? component.name`; slug = `input.slug ?? toSlug(name)` with derived-collision suffixing `-2`, `-3`… and explicit-collision → 409 `SLUG_TAKEN`; insert `digital_products` (uuidv7 id, `type:'PLATFORM'`, `lifecycle:'ACTIVE'`, owners/metadata) + `writeEntityChange` `created`; insert platform `product_depends_on_component` edge + `writeEdgeChange` `added`; per consumer delete the `depends_on` row and insert `product_consumes_from` (`onConflict doNothing`) writing both edge audit rows. Return `{product, consumers}`.
- [X] T014 [US2] Register `GET /components/:id/dependents` (verifySession; 404 when component missing) and `POST /components/:id/promote-to-platform` (`verifySession` + `requireRole("product:create")`; `201 {product, consumers}`) in `packages/backend/src/routes/components.ts`, reusing `sendServiceError`/`validationFailed` conventions.
- [X] T015 [US2] Add `ComponentDependent`, `PromoteToPlatformResult`, `PromoteToPlatformInput` to `packages/frontend/src/api/types.ts` and `useComponentDependents(id)` (queryKey `["component-dependents", id]`) + `usePromoteComponent()` (POST `components/{id}/promote-to-platform`; on success invalidate `["platform-candidates"]`, `["component-dependents"]`, `["components"]`, `["products"]`, plus the dashboard summary's actual queryKey — verify it in `packages/frontend/src/api/hooks/dashboard.ts` before writing the invalidation list) to `packages/frontend/src/api/hooks/components.ts`.
- [X] T016 [US2] Create `packages/frontend/src/components/products/promote-to-platform-dialog.tsx`: `Dialog` per existing conventions; fields name (pre-filled from component), slug (placeholder "auto-derived"), description, `OwnerPickers` reuse; consumer checklist fed by `useComponentDependents(componentId)` — every row checked by default; confirm POSTs `{name, slug?, description?, lobOwnerId?, teamOwnerId?, consumerIds: checkedIds}`; on success `navigate(\`/products/${product.slug}\`)`; errors shown via `describeApiError`.
- [X] T017 [US2] Wire a **Promote** button per candidate row in the dashboard section from T008 (`packages/frontend/src/pages/dashboard.tsx`): visible for EDITOR+ (`useSession` role check per existing pages), opens `PromoteToPlatformDialog` for that component.
- [X] T018 [US2] Add `GET /components/{id}/dependents` and `POST /components/{id}/promote-to-platform` to `docs/openapi.yaml` with the exact request/response/error contract in `contracts/api.md` (`x-permission: "product:create"` on the POST) and regenerate `docs/api.md`.

**Checkpoint**: User Stories 1 AND 2 both work — full guided workflow
detect → promote → rewrite is demoable end to end.

---

## Phase 5: User Story 3 — Promote a component on demand (Priority: P3)

**Goal**: The same promotion flow is reachable from any non-`RETIRED`
component's detail page, regardless of depender count.

**Independent Test**: From a component detail page, run the promotion flow
and verify the identical resulting graph as US2 — including a zero-consumer
promotion.

### Tests for User Story 3 — write FIRST, ensure they FAIL

- [X] T019 [US3] Frontend unit test in `packages/frontend/src/test/unit/promote-dialog.test.tsx` (extends the file T012 creates — sequential, not parallel): the component-detail "Promote to platform" button renders for EDITOR+ on an `ACTIVE` component, is absent for VIEWER and for `RETIRED` components, and opening it shows the same dialog with an empty consumer checklist when the component has no dependents.

### Implementation for User Story 3

- [X] T020 [US3] Add a "Promote to platform" `Button` beside "Edit metadata" in `packages/frontend/src/pages/component-detail.tsx`, gated on `canEdit && component.lifecycle === 'ACTIVE'`, opening `PromoteToPlatformDialog` for the component (uses the T015 dependents hook for its checklist).

**Checkpoint**: All user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs sync and full verification.

- [X] T021 [P] Update `docs/digital-products.md` — the "Promote shared things to platforms" paragraph (§ How the pieces grow over time) must match implemented behavior: candidate threshold (≥2 direct dependents), consumer checklist with opt-out, component-detail entry point, owner prompt.
- [X] T022 Update `docs/roadmap.md` — move `020-platform-product-workflow` to Shipped (ADR-017 implemented: candidate detection + atomic promotion + owner prompt + opt-out rewrite) and revise the Next list so `021-catalog-bootstrap` heads the queue.
- [X] T023 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and `pnpm --filter @componode/backend docs:api:check` — fix all failures.
- [X] T024 Walk `specs/020-platform-product-workflow/quickstart.md` scenarios 1–3 against the running app; confirm every expected outcome.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Phase 2.
  - US2's dialog needs US1's card only for one of its two entry points — the
    promotion endpoint itself is independent; US3 reuses US2's dialog.
  - Stories proceed in priority order P1 → P2 → P3 for this feature.
- **Polish (Phase 6)**: Depends on all three stories.

### User Story Dependencies

- **US1 (P1)**: Needs T001–T002. No story dependencies.
- **US2 (P2)**: Needs T001–T002. Reuses US1's candidates card container for
  the dashboard Promote button; otherwise independent.
- **US3 (P3)**: Needs US2's `PromoteToPlatformDialog` (T016) — the only true
  cross-story dependency.

### Parallel Opportunities

- T003 ∥ T004 (backend test file vs. frontend test file)
- T005 ∥ T007 (service vs. frontend types/hooks)
- T010 ∥ T011 ∥ T012 (three test files/sections)
- T015 ∥ T016 (hooks vs. dialog component — T016 consumes T015's names;
  define hook signatures from contracts/api.md first, then parallelize)
- T021 ∥ T022 (independent docs)

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → shared schema + service scaffold.
2. Phase 3 → detection live: endpoint + dashboard card.
3. **STOP and VALIDATE**: candidates appear/disappear exactly per the
   counting rules. Ship-able read-only value.

### Incremental Delivery

1. US1 → MVP (detection worklist).
2. US2 → the flagship ADR-017 transaction + dialog.
3. US3 → on-demand entry point.
4. Polish → docs, verification, quickstart walkthrough.
