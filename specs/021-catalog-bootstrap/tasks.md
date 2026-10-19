# Tasks: Catalog Bootstrap

**Input**: Design documents from `/specs/021-catalog-bootstrap/`

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

**Purpose**: Shared contracts and request plumbing needed by the stories.

- [X] T001 Add `bootstrapDocumentSchema` + `bootstrapProductItemSchema` in a new `packages/core/src/schemas/bootstrap.ts` — strict objects at every level (ADR-095): `{version: z.literal(1), products: z.array(item)}` where item is `{name (1–200, required), type (productTypeSchema, required), description (≤2000, nullable, optional), owner (strict optional object {lob, team — string|null|optional}), tags (tagsSchema, optional), criticality (productCriticalitySchema nullable, optional), sunsetAt (datetime-with-offset nullable, optional), dependsOn (z.array(z.string()), optional)}`. Add `BootstrapSkippedItem` (`{item: string, reason: string}`) and `BootstrapReport` (`{created, updated, edgesAdded, skipped: BootstrapSkippedItem[]}`) types in `packages/core/src/contracts/` (new `bootstrap.ts`, following existing contract-file conventions). Re-export both schemas and types from `packages/core/src/index.ts` and any enumerating index barrels.
- [X] T002 Register a Fastify `addContentTypeParser` for `application/yaml`, `application/x-yaml`, and `text/yaml` inside `productRoutes` in `packages/backend/src/routes/products.ts` — the parser returns the raw body string (`parseAs: "string"`); `application/json` keeps the default parser (bodies arrive pre-parsed). No app.ts change needed beyond this file.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The bootstrap service scaffold + batch ref-resolution layer that
US1's implementation tasks build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Create `packages/backend/src/services/catalog-bootstrap-service.ts` with the skeleton for `bootstrapCatalog(document: unknown, opts: {dryRun: boolean}, actor: Actor)` plus the resolution layer it will use: (a) `resolveDocument(document)` — YAML-parse strings via the `yaml` package (already a backend dep), `bootstrapDocumentSchema.safeParse`, and a duplicate-derived-slug check (`toSlug` from `product-service.ts`) — any failure throws `{statusCode: 400, code: "VALIDATION_FAILED", details: issues}`; (b) `resolveRefs(items)` — collect all `owner.lob`/`owner.team`/`dependsOn` refs and batch-resolve in O(1) `IN` queries: LOBs and Teams by `slug`; components matched per ref in order slug → `name` → `externalId` with multi-match-at-first-stage = ambiguous; load existing `digital_products` by derived slug (any lifecycle). Return typed resolution maps consumed by the apply loop.

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Bootstrap the product layer from an existing inventory (Priority: P1) 🎯 MVP

**Goal**: `POST /api/v1/products/bootstrap` accepts a YAML/JSON document,
rejects malformed files whole, upserts products by derived slug with merge
semantics, wires resolved `DEPENDS_ON` refs, supports `?dryRun=true`, and
returns `{created, updated, edgesAdded, skipped}` — plus an "Import
products" flow on the Products page.

**Independent Test**: With only components in the catalog, POST the
quickstart document — the product appears with fields set and edges wired;
the report matches resulting state; `?dryRun=true` writes nothing.

### Tests for User Story 1 — write FIRST, ensure they FAIL

- [X] T004 [P] [US1] Schema unit tests in `packages/core/test/schemas/bootstrap.test.ts`: valid minimal/full documents pass; `version: 2` rejected; unknown field at root/item/owner rejected; non-string `dependsOn` entry rejected; empty `products: []` accepted; `owner` with `null` sub-keys accepted; oversized `name`/bad `type`/bad `tags` rejected with per-item `path` (`products.N.field`).
- [X] T005 [P] [US1] Integration tests in `packages/backend/test/integration/product-bootstrap.test.ts` (testcontainers; reuse the `bootstrapAdmin` + session pattern from `products.test.ts`): (a) happy path — YAML body with `Content-Type: application/yaml` creates products with all fields and wires `dependsOn` edges; report `{created, updated, edgesAdded, skipped}` matches DB state; (b) upsert — existing product with the derived slug gets present fields updated, omitted fields preserved, explicit `null`/`[]` clears, `owner: {team}` leaves `lobOwnerId` untouched; a matched `RETIRED` product is updated but stays `RETIRED`; (c) validation — malformed item, unknown field, wrong `version`, duplicate derived slugs, and unparseable YAML each → `400 VALIDATION_FAILED` with per-item details and ZERO writes; (d) refs — unresolved owner/component refs land in `skipped` while the product still applies; ambiguous name/externalId match → `skipped`; resolution order slug → name → `externalId`; `RETIRED` component ref resolves and wires; (e) `?dryRun=true` returns the same shape and writes nothing (verify table counts + audit rows unchanged); (f) idempotent re-run → `created: 0`, `edgesAdded: 0`; (g) JSON body via `Content-Type: application/json` works identically; (h) audit — `digital_product` `created`/`updated` + `DEPENDS_ON_COMPONENT` `added` rows per change attributed to the actor; (i) authz — VIEWER → `403`, unauthenticated → `401`; (j) empty `products: []` → 200 zero-count report; (k) a `type` flip that would invalidate `CONSUMES_FROM` consumers lands that item in `skipped` (`TYPE_CHANGE_BLOCKED`) while other items apply; (l) a byte-identical re-import reports `created: 0, updated: 0, edgesAdded: 0` and writes zero new audit rows (no-op items produce no write).
- [X] T006 [P] [US1] Frontend unit test for the import dialog in `packages/frontend/src/test/unit/import-products.test.tsx`: file selection triggers a `dryRun` POST with the file text and `Content-Type: application/yaml`; preview renders the report counts + skipped list; "Apply" sends the non-dry-run POST; final report renders; `VALIDATION_FAILED` surfaces via `describeApiError`.

### Implementation for User Story 1

- [X] T007 [US1] Implement the apply pipeline in `packages/backend/src/services/catalog-bootstrap-service.ts` per research.md D3: for each item one `db.transaction()` — insert or merge-update `digital_products` (present fields only; never `lifecycle`; reuse the `TYPE_CHANGE_BLOCKED` type-change guard semantics from `updateProduct`), insert `product_depends_on_component` rows `onConflict doNothing` for resolved refs (count `numInsertedRows` into `edgesAdded`), `writeEntityChange` (`created`/`updated`) + `writeEdgeChange` (`DEPENDS_ON_COMPONENT` `added`, reason `"catalog bootstrap import"`) inside the same tx; catch per-item failures → `skipped` `{item: productName, reason}` and continue. Diff merged fields before writing: an item whose update set is empty after diffing (all values identical) produces no write, no audit row, and counts as neither `created` nor `updated`. `dryRun` runs the same resolution/computation with zero writes, counting would-be `created`/`updated`/`edgesAdded` (resolved refs minus already-present edges). Return `BootstrapReport`. Kysely parameterized queries only (ADR-084).
- [X] T008 [US1] Register `POST /products/bootstrap` in `packages/backend/src/routes/products.ts` — `verifySession` + `requireRole("product:create")`; parse `?dryRun=true` (absent/other values = apply); `200` with the report; route the body (string or parsed object) through `bootstrapCatalog`; errors via `sendServiceError`.
- [X] T009 [US1] Add `BootstrapReport`/`BootstrapSkippedItem` types to `packages/frontend/src/api/types.ts` and `useBootstrapProducts()` to `packages/frontend/src/api/hooks/products.ts` — `mutationFn: ({document, dryRun}) => api("/products/bootstrap" + (dryRun ? "?dryRun=true" : ""), {method: "POST", headers: {"Content-Type": "application/yaml"}, body: document})`; on success invalidate `["products"]` and dashboard keys. Verify `apiFetch` honors the header override (it spreads `options.headers` after the JSON default — no client change expected, but confirm in `packages/frontend/src/api/client.ts`).
- [X] T010 [US1] Create `packages/frontend/src/components/products/import-products-dialog.tsx`: `Dialog` per existing conventions; `<input type="file" accept=".yaml,.yml,.json">` → `FileReader`/`file.text()` → automatic dry-run POST showing the preview report (counts + skipped table) → "Apply" sends the real POST → renders the final report; error surface via `describeApiError`; EDITOR-only entry point.
- [X] T011 [US1] Wire an "Import products" `Button` beside "New product" in `packages/frontend/src/pages/products.tsx` (same `editor` gate) opening the dialog; also offer it in the empty-state action area when the catalog has no products.
- [X] T012 [US1] Add `/products/bootstrap` to `docs/openapi.yaml` per `contracts/api.md` (`x-permission: "product:create"`, `dryRun` query param, `application/yaml` + `application/json` request content, `BootstrapReport`/`BootstrapSkippedItem`/`BootstrapDocument` schemas, error responses) and regenerate `docs/api.md` via `pnpm --filter @componode/backend docs:api`.

**Checkpoint**: User Story 1 fully functional — file → preview → apply →
report; independently demoable MVP.

---

## Phase 4: User Story 2 — Create a product from selected components (Priority: P2)

**Goal**: `POST /api/v1/products` accepts optional `componentIds[]` wired
atomically with creation; the components list supports multi-select +
"Create product".

**Independent Test**: Select three components → Create product → submit —
the detail page lists exactly those three as declared dependencies; a bad
id fails the whole request with zero writes.

### Tests for User Story 2 — write FIRST, ensure they FAIL

- [X] T013 [P] [US2] Integration tests in `packages/backend/test/integration/product-bootstrap.test.ts` (same file, new describe block): (a) `POST /products` with `componentIds` → `201`, product exists, one `product_depends_on_component` row + one `DEPENDS_ON_COMPONENT added` audit row per id; (b) a missing/unknown id → `404 NOT_FOUND` with `details.missingIds` and ZERO writes (no product, no edges); (c) a `RETIRED` component id is accepted (existence-only rule, matching the bulk edge path); (d) `componentIds` on a normal create still enforces all existing create rules (slug collision → `409 SLUG_TAKEN`); (e) single-element array works; (f) >100 ids → `400`.
- [X] T014 [P] [US2] Frontend unit tests in `packages/frontend/src/test/unit/components-page-states.test.tsx` (extend — sequential within the file) or a new `create-from-components.test.tsx`: row checkboxes render only for `ACTIVE` components; selection bar shows "N selected" with a "Create product" action gated to EDITOR+; `ProductForm` opened with `componentIds` shows the "wires N components" notice and submits them in the POST body; success navigates to the new product's detail page.

### Implementation for User Story 2

- [X] T015 [US2] Extend `createProductSchema` in `packages/core/src/schemas/product.ts` with `componentIds: z.array(z.string().uuid()).min(1).max(100).optional()` and update `createProduct` in `packages/backend/src/services/product-service.ts`: inside its existing transaction, verify every id exists (`404 NOT_FOUND` + `details.missingIds`, same convention as the bulk edge path), insert the product + `product_depends_on_component` rows + `writeEntityChange`/`writeEdgeChange` rows — atomic.
- [X] T016 [US2] Add `componentIds?: string[]` to `ProductFormInput` in `packages/frontend/src/api/hooks/products.ts` and accept a `componentIds` prop on `ProductForm` in `packages/frontend/src/components/products/product-form.tsx` — when present, show a notice ("This product will be wired to N components") and include them in the create POST.
- [X] T017 [US2] Add row selection to `packages/frontend/src/pages/components.tsx`: a checkbox column for `ACTIVE` rows only, header select-all for the visible ACTIVE set, and a selection action bar ("N selected" + "Create product" `Button`, EDITOR+ via `useSession` role per existing pages) that opens `ProductForm` with the selected ids; on success navigate to `/products/{slug}` and clear the selection.
- [X] T018 [US2] Document the `componentIds` extension on `POST /products` in `docs/openapi.yaml` per `contracts/api.md` (optional `componentIds` array, 1–100 uuids; `404` with `details.missingIds` on unknown ids) and regenerate `docs/api.md` — ADR-104 requires endpoint changes to land in the same commit as their docs.

**Checkpoint**: User Stories 1 AND 2 both work — products can be created
from a file or straight off the component list.

---

## Phase 5: User Story 3 — Wire several dependencies to an existing product at once (Priority: P3)

**Goal**: The `DEPENDS_ON` edge picker multi-selects components into the
existing `componentIds[]` union input; groups remain single-target.

**Independent Test**: On a product detail page, select three components in
the picker → one Add → all three appear as declared dependencies.

### Tests for User Story 3 — write FIRST, ensure they FAIL

- [X] T019 [US3] Frontend unit test updates in `packages/frontend/src/test/unit/edge-picker.test.tsx` (extend the existing file — sequential): in `depends-on` mode components render as a checkbox list and confirm submits `{componentIds: [...]}` once; selecting a group entry submits `{componentGroupId}` and clears component selection (exactly-one-of preserved); `composes`/`consumes-from` modes keep single-select behavior unchanged; components the product already depends on render disabled (non-selectable) rather than hidden.

### Implementation for User Story 3

- [X] T020 [US3] Rework the `depends-on` branch of `packages/frontend/src/components/products/edge-picker.tsx`: components (`lifecycle !== "RETIRED"`) as a checkbox list + groups as single-select entries; submit dispatches `{componentIds: selectedComponentIds}` when components are checked, else `{componentGroupId: groupId}`. Feed the product's currently-declared dependency ids from `product-detail.tsx` into the picker and render those options disabled. Widen `onAdd`'s body type to `Record<string, string | string[]>` and update the `useAddEdge` mutation variable type in `packages/frontend/src/api/hooks/products.ts` accordingly (backend union input is already shipped and documented).

**Checkpoint**: All user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs sync and full verification.

- [X] T021 [P] Update `docs/digital-products.md` — document the three flows: bootstrap import (file shape, upsert-by-slug, two-phase semantics, dry-run, skipped report, `RETIRED`-product update rule), create-product-from-components, and multi-select dependency wiring.
- [X] T022 [P] Update `docs/roadmap.md` — move `021-catalog-bootstrap` to Shipped (ADR-114 import + fast path + bulk picker) and revise Next so `022-edge-suggestions` heads the queue.
- [X] T023 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and `pnpm --filter @componode/backend docs:api:check` — fix all failures.
- [X] T024 Walk `specs/021-catalog-bootstrap/quickstart.md` scenarios 1–3 against the running app; confirm every expected outcome including the malformed-file and dry-run paths.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS US1 (US2/US3 do not
  touch the bootstrap service but follow the same contracts).
- **User Stories (Phase 3–5)**: All depend on Phases 1–2.
  - Stories proceed in priority order P1 → P2 → P3 for this feature.
- **Polish (Phase 6)**: Depends on all three stories.

### User Story Dependencies

- **US1 (P1)**: Needs T001–T003. No story dependencies.
- **US2 (P2)**: Needs T001 only in that it shares `packages/core` conventions —
  its schema edit is independent; no dependency on US1 deliverables.
- **US3 (P3)**: No dependency on US1/US2 — backend bulk input already shipped;
  purely a picker rework.

### Parallel Opportunities

- T001 ∥ T002 (core schema vs. backend route plumbing)
- T004 ∥ T005 ∥ T006 (three test files)
- T007 ∥ T009 (service internals vs. frontend types/hooks — hook signatures
  come from contracts/api.md)
- T010 ∥ T011 (dialog component vs. page wiring — T011 consumes T010's export;
  define the props interface first, then parallelize)
- T013 ∥ T014 (backend test block vs. frontend test file)
- T021 ∥ T022 (independent docs)

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → contracts + service scaffold + ref resolution.
2. Phase 3 → `POST /products/bootstrap` + Import dialog live.
3. **STOP and VALIDATE**: a real inventory file imports with correct report;
   dry run writes nothing. Ship-able cold-start value.

### Incremental Delivery

1. US1 → MVP (bootstrap import — the adoption gate).
2. US2 → create-from-components fast path.
3. US3 → multi-select picker polish.
4. Polish → docs, verification, quickstart walkthrough.

---

## Phase 7: Convergence

- [X] T025 Add a scale test to `packages/backend/test/integration/product-bootstrap.test.ts` asserting a ~200-product bootstrap document with dependencies applies end-to-end within the SC-001 budget (under 1 minute wall clock, with generous headroom for testcontainers) and that ref resolution stays batched — O(1) `IN` queries independent of item count, not per-item queries (partial)
- [X] T026 Add an Amendment section to `researches/adrs/ADR-114-*.md` noting the shipped entry point is an "Import products" **button** opening a dialog on the Products page (header + empty state), superseding the "card" wording in the original decision sketch (contradicts)

---

## Phase 8: Convergence (code-review remediation)

**Source**: two-axis code review (Standards + Spec) of the uncommitted
`021-catalog-bootstrap` diff vs `origin/main`.

### Bugs / spec gaps

- [X] T027 Disable group-covered components in the depends-on picker: `product-detail.tsx` currently feeds only `DIRECT`-source dependency ids into `edge-picker.tsx`'s disabled set — components covered by a wired `GROUP` dependency must also render disabled (non-selectable) so a redundant direct edge can't be stacked on a group edge. Update the picker prop wiring + `edge-picker.test.tsx` per spec edge case "already-declared dependencies render disabled" (partial)
- [X] T028 Translate an unparseable `application/json` body on `POST /products/bootstrap` to `400 VALIDATION_FAILED` (currently Fastify's `FST_ERR_CTP_INVALID_JSON` bypasses `sendServiceError`) — e.g. register the route's JSON parser as raw-string like the YAML parser and let `YAML.parse` handle both content types through the existing `VALIDATION_FAILED` path per contracts/api.md (contradicts)
- [X] T029 Sanitize `skipped[].reason` in `catalog-bootstrap-service.ts` — map known errors to stable phrases (e.g. `"type change blocked"`), use a generic `"failed to apply item"` for unexpected errors, and log the real error server-side; never pass `err.message` to the client per ADR-096 (contradicts)
- [X] T030 Count `edgesAdded` from `numInsertedRows` of the `onConflict doNothing` insert in `applyItem`, not from the planned edge list, so a concurrent no-op doesn't overcount per T007 (partial)
- [X] T031 Reject empty derived slugs (`toSlug(item.name) === ""`, e.g. `"!!!"`) in `resolveDocument` phase 1 → `VALIDATION_FAILED` with path `products.{i}.name`, matching `createProduct`'s handling instead of a phase-2 DB CHECK failure per FR-001 (partial)
- [X] T032 Remove the file-specific caps `products.max(2000)`, `dependsOn.max(500)`, and ref `.max(200)` from `packages/core/src/schemas/bootstrap.ts` — spec Assumptions: "no file-specific cap is introduced in v1 beyond what the API already enforces" (body limit → 413). Keep field-level domain constraints (name length etc.) and update `bootstrap.test.ts` (contradicts)

### Duplication / structure

- [X] T033 Extract the CONSUMES_FROM-consumer check into a shared `findConsumesFromConsumers(platformId)` used by both `product-service.ts` `updateProduct` and the bootstrap service, and batch it — collect type-flipping items' `existingIds` during planning and run ONE `IN` query instead of the per-item SELECT in `planItem` per FR-014 "through the normal entity/edge services" + the batched-resolution design (partial)
- [X] T034 Extract the `ROLE_LEVEL` map into a shared helper (e.g. `packages/frontend/src/lib/roles.ts`) used by `components.tsx`, `products.tsx`, and `product-detail.tsx` instead of a third copy (partial)
- [X] T035 Rename `[document, setDocument]` → `[fileText, setFileText]` in `import-products-dialog.tsx` — it shadows the DOM `document` global (partial)

### Polish (judgement calls — cheap)

- [X] T036 Validate the `dryRun` query param with Zod at the route boundary (`z.object({ dryRun: z.literal("true").optional() })`) per ADR-095, matching `listProductsQuerySchema` conventions (partial)
- [X] T037 Small cleanups in `catalog-bootstrap-service.ts`: hoist the sorted copy in `sameTags` out of `.every`; unify the `updates`-nonempty predicate (`hasChanges`); replace `"[]" as never` with the `JSON.stringify` convention; introduce a typed `EdgeKey` helper for `"${productId}:${componentId}"` keys (partial)
- [X] T038 Clear the components-page `selected` set when filters/page change so invisible selections can't persist into "Create product" per FR-010 (partial)

---

## Phase 9: Convergence

- [X] T039 Sync `docs/openapi.yaml` with the T032 cap removal — delete `maxItems: 2000` on `BootstrapDocument.products`, `maxItems: 500` on `BootstrapProductItem.dependsOn`, and `maxLength: 200` on `dependsOn` items (lines ~2549/2577/2579); keep field-level domain constraints (name/description/tag limits). Regenerate `docs/api.md` per ADR-104 (contradicts)

---

## Phase 10: Convergence

- [X] T040 Add `PAYLOAD_TOO_LARGE` to `ERROR_CODES` in `packages/core/src/constants/error-codes.ts` + its `error-types.ts` entry (413), and map `err.statusCode === 413` → `code: "PAYLOAD_TOO_LARGE"` in `error-handler.ts` before the generic else — the bootstrap contract documents `413 PAYLOAD_TOO_LARGE` but Fastify's `FST_ERR_CTP_BODY_TOO_LARGE` currently emits `INTERNAL_ERROR`. Add an integration test posting a >1MB bootstrap body expecting `{code: "PAYLOAD_TOO_LARGE", statusCode: 413}` (contradicts)
- [X] T041 Fix `dryRun` query handling in `routes/products.ts`: `z.object({ dryRun: z.enum(["true", "false"]).optional() }).strict()` — `"false"` must apply (openapi `enum: ['true','false']` + contracts/api.md "other values apply normally"), unknown query keys rejected per ADR-095 (partial)
- [X] T042 Reset `e.target.value = ""` in `import-products-dialog.tsx` `handleFile` (both success and error paths) so re-selecting the same file re-fires `onChange` — currently a failed preview dead-ends the same file per FR-008 (partial)
- [X] T043 Raise the depends-on picker's component coverage beyond `useComponents({pageSize: 100})` in `edge-picker.tsx` — either fetch all ACTIVE components (bounded pageSize loop or a higher documented cap matching the API max) or add in-picker search; catalogs >100 components must be fully wireable per FR-011 (partial)

## Phase 11: Convergence

- [X] T044 Update `contracts/api.md` line ~17: "absent/other values apply normally" is stale — strict `dryRun` enum now rejects non-`"true"`/`"false"` values with 400 per ADR-095; reword to match (partial)

## Phase 12: Convergence

- [X] T045 Reconcile the bootstrap import with FR-014 "go through the normal entity/edge services": either refactor `catalog-bootstrap-service.ts` item applies onto `createProduct`/`updateProduct`/`addDependsOnEdge` (preserving per-item atomicity + dry-run), or record the deliberate deviation + rationale as an amendment in `researches/adrs/ADR-114-catalog-bootstrap-import.md` (contradicts)
- [X] T046 Sync `docs/openapi.yaml` bootstrap contract: add `application/x-yaml` and `text/yaml` requestBody media types (route accepts them; contract api.md documents them), add `minLength: 1` to `BootstrapOwner.lob`/`team` to match `bootstrapOwnerSchema`; regenerate `docs/api.md` per ADR-104 (partial)
- [X] T047 Broaden `useBootstrapProducts` invalidation in `packages/frontend/src/api/hooks/products.ts` — apply also invalidates `components`, `dashboard`, and `component-groups` (imported edges change dependents/health rollups) per US1 report freshness (partial)
- [X] T048 Align audit provenance with contract api.md — product `created`/`updated` audit rows from a bootstrap import aren't tagged with reason `"catalog bootstrap import"` (`entity_changes` lacks a reason column); either add reason provenance for product rows or amend the contract wording (partial)
- [X] T049 Align `skipped[].item` shape with the contract example (`"payments-shop → dependsOn \"paymets-db\""`) or amend `contracts/api.md` to document the actual `"products.N (Name)"` format emitted by `catalog-bootstrap-service.ts` (partial)
- [X] T050 Resolve `owner: null` semantics per FR-002 ("explicit `null` or `[]` clears the field") — schema currently rejects `owner: null`; either accept it to clear both owner refs or document sub-key-only clearing in `contracts/api.md` (partial)

## Phase 13: Convergence

- [X] T051 `edge-picker.tsx`: show a loading state while `useAllComponents`/`useComponentGroups` are pending (currently flashes "No active components found"), and only fetch components/groups when `target.kind === "depends-on"` — `composes`/`consumes-from` pickers only need the product list (partial)
- [X] T052 `routes/products.ts` `sendServiceError`: guard `error.code` against `ERROR_CODES` before emitting (fall back to `CONFLICT`) — non-enum codes must not reach the controlled vocabulary per ADR-071 (partial)
- [X] T053 Import dialog: surface all validation issues when the document is rejected (SC-002 "identifying every malformed item") — `describeApiError` renders only `issues[0]`; render the `details` issue list (partial)
- [X] T054 Write `DEPENDS_ON_COMPONENT added` audit rows only for actually-inserted edges in the `componentIds[]` bulk paths (`product-service.ts` createProduct fast path + `product-edge-service.ts` bulk add) — `doNothing()` conflicts must not mint phantom audit entries per SC-006 (partial)
- [X] T055 `contracts/api.md`: document that array fields (`tags`, `dependsOn`) clear via `[]`, not `null` — matches the strict schema and the documented `owner` sub-key convention per FR-002 (partial)
- [X] T056 `useAddEdge` in `api/hooks/products.ts`: also invalidate `components`, `component-groups`, `dashboard` — bulk edge adds change ADR-112 health rollups, consistent with `useBootstrapProducts` (partial)
