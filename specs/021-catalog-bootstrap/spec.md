# Feature Specification: Catalog Bootstrap

**Feature Branch**: `feature/021-catalog-bootstrap`

**Created**: 2026-10-18

**Status**: Draft

**Input**: `021-catalog-bootstrap` — implement the ratified Phase-1 cold-start
package of the practical-DPAM improvement plan
(`researches/digital_product_concepts_review_research.md` §4 items 1.1 + 1.3,
plus the bulk-wiring item 2.1 they build on; packaged under this spec by the
2026-10-18 grilling addendum and ADR-114 Consequences):

1. **Bootstrap import** (ADR-114): a one-shot declarative YAML/JSON upload
   declaring Digital Products and their `DEPENDS_ON` component refs — strict
   whole-document validation, then a best-effort apply that upserts products
   by slug and wires resolved edges, with a per-item report and a
   `?dryRun=true` preview. UI: an "Import products" entry on the Products
   page.
2. **"Create product from components" fast path** (plan item 1.3): select
   multiple components → create a new product pre-wired with `DEPENDS_ON`
   edges to all of them in one action.
3. **Bulk dependency wiring** (plan item 2.1 / ADR-110 amendment): multi-select
   in the dependency picker, on top of the already-shipped `componentIds[]`
   union input on `POST /products/{id}/depends-on`.

No new architecture decisions are needed — the file format, upsert-by-slug
semantics, two-phase validate/apply, dry-run, and report shape are ratified in
[ADR-114](../../researches/adrs/ADR-114-catalog-bootstrap-import.md); the bulk
input is ratified in the
[ADR-110](../../researches/adrs/ADR-110-product-dependency-on-component-group.md)
amendment and already implemented server-side.

## Clarifications

### Session 2026-10-18

- Q: When an upserted product already exists and a file item omits an
  optional field, does the missing field leave the existing value alone or
  reset it? → A: Merge semantics — fields present in the file item are
  applied (explicit `null`/`[]` clears); absent fields are untouched. This
  applies recursively inside `owner`: `owner: {team: "x"}` sets the team
  owner and leaves the LOB owner unchanged.
- Q: If an unexpected failure interrupts apply partway through the file, do
  already-applied items stay or roll back? → A: Per-item atomicity — each
  product item (its upsert plus its edges) commits independently; an item
  that fails mid-apply is reported in `skipped` with a reason and the apply
  continues with the remaining items.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bootstrap the product layer from an existing inventory (Priority: P1)

As a new adopter who already keeps an application list somewhere (a
spreadsheet, a CMDB export), I want to upload one declarative file so that
Componode creates or updates my Digital Products and wires their component
dependencies in a single action — with a report telling me exactly what was
applied and which references couldn't be resolved.

**Why this priority**: Cold start is the ratified top adoption gap (research
H1). Manual-only authoring means every product is created, typed, owned, and
wired by hand before the catalog answers anything; an import turns an existing
inventory into a working product layer in one step. The other stories are
point ergonomics; this one is the gate.

**Independent Test**: With only components in the catalog, upload a YAML
document declaring products with owners and `dependsOn` refs — afterwards the
products exist with their fields set, resolved dependencies are wired, and the
returned report matches the resulting state. Delivers full value with no fast
path or picker changes.

**Acceptance Scenarios**:

1. **Given** a valid document declaring products with `name`, `type`,
   `description`, `owner` (LOB/Team slugs), `tags`, `criticality`, `sunsetAt`,
   and `dependsOn` refs, **When** I upload it, **Then** each product is
   created with those fields set, every resolved `dependsOn` ref becomes a
   `DEPENDS_ON` edge, and the report counts the created products and added
   edges.
2. **Given** a product whose derived slug already exists, **When** the file is
   applied, **Then** the existing product's mutable fields are updated (it is
   counted as `updated`, never deleted or duplicated), and its declared
   `dependsOn` refs are added as edges; products absent from the file are
   untouched.
3. **Given** a document containing a malformed item (bad type, wrong field
   shape, unknown field, wrong `version`), **When** I upload it, **Then** the
   entire upload is rejected with per-item errors and nothing is written.
4. **Given** a document whose owner or `dependsOn` refs cannot be resolved to
   an existing entity, **When** it is applied, **Then** the products are still
   created/updated, each unresolved ref lands in the report's `skipped` list
   with a reason, and no placeholder entities are fabricated.
5. **Given** the same valid document, **When** I submit it with the dry-run
   option, **Then** I receive the same report shape (`created`, `updated`,
   `edgesAdded`, `skipped`) and the catalog is unchanged.
6. **Given** `dependsOn` refs, **When** they are resolved, **Then** each ref
   matches a component by slug first, then name, then `externalId`; a ref
   matching multiple components ambiguously is reported as skipped rather than
   guessed.
7. **Given** a file I have already imported, **When** I upload it again,
   **Then** no products or edges are duplicated — the run is idempotent and
   the report reflects it.
8. **Given** a successful apply, **When** I view audit history, **Then** there
   is an entry for every product created or updated and every edge added,
   attributed to the acting user.
9. **Given** a user without the product-create permission, **When** they
   attempt an import, **Then** the request is rejected and nothing is written.
10. **Given** the Products page, **When** I open the import flow, **Then** I
    can choose a file, preview the would-be result, and confirm — seeing the
    final report afterward.

---

### User Story 2 - Create a product from selected components (Priority: P2)

As a catalog maintainer looking at a list of discovered components, I want to
select several of them and create a Digital Product already wired to all of
them, so that grouping imported infrastructure into a product doesn't require
creating the product first and then wiring dependencies one at a time.

**Why this priority**: This is the second half of cold start — once components
are imported, the fastest way to stand up products is to select what belongs
together. It directly removes the N-picker-round-trips tax (research H3) on
the most common wiring operation.

**Independent Test**: Select three components on the components list, run
"Create product", fill in the product form, submit — the new product's detail
page shows exactly those three components as declared dependencies. Delivers
value even if the file import never exists.

**Acceptance Scenarios**:

1. **Given** multiple components selected in the components list, **When** I
   choose "Create product", **Then** I get the standard product-create form
   and, on submit, a single action creates the product and wires a
   `DEPENDS_ON` edge to every selected component.
2. **Given** the fast path is used, **When** the product is created, **Then**
   all the normal product-create rules apply (unique slug, valid type,
   optional owner/tags/criticality) and the selected components do not need to
   be re-picked.
3. **Given** any part of the creation fails, **When** the action aborts,
   **Then** the catalog is unchanged — no product without its edges, no edges
   without a product.
4. **Given** a completed fast-path creation, **When** I view audit history,
   **Then** entries exist for the product creation and for each dependency
   edge, attributed to me.
5. **Given** a single component selected, **When** I use the same action,
   **Then** it works identically — a one-component fast path is legal.

---

### User Story 3 - Wire several dependencies to an existing product at once (Priority: P3)

As a catalog maintainer editing a product, I want to pick several components
in the dependency picker and wire them in one action, so that fleshing out an
existing product's dependencies doesn't take one dialog round-trip per
component.

**Why this priority**: Pure wiring ergonomics (plan item 2.1). The API already
accepts `componentIds[]` atomically (ADR-110 amendment) — the remaining work
is the multi-select picker — so this is smaller and lower-stakes than the two
cold-start stories.

**Independent Test**: On a product's detail page, open the dependency picker,
select several components, confirm — all selected components appear as
declared dependencies after one action.

**Acceptance Scenarios**:

1. **Given** the dependency picker on a product, **When** I select multiple
   components and confirm, **Then** `DEPENDS_ON` edges to all of them are
   created in a single atomic action with one audit entry per edge.
2. **Given** a selection containing a component already wired to the product,
   **When** I confirm, **Then** the existing edge is not duplicated and the
   remaining selections are still wired.
3. **Given** the picker, **When** I choose a component group, **Then** the
   single-target group behavior is unchanged — group wiring and bulk
   component wiring are never mixed in one action.

## Edge Cases

- **Whole-document strictness vs. best-effort apply.** Phase one rejects the
  file outright on malformed items, unknown fields, or a `version` other than
  `1` — per-item errors, zero writes. Phase two (apply) never fails the file
  over an unresolvable *reference* — unresolved owner/component refs are
  reported in `skipped`, not fatal.
- **Duplicate products inside one document.** Two items deriving the same
  slug are a validation error — the whole document is rejected rather than
  letting one row silently overwrite another mid-file.
- **Slug derivation.** The file carries `name`, not `slug`; the slug is
  derived exactly as product creation derives it today. A derived-slug match
  against an existing product (of any lifecycle) triggers the update path —
  including a `RETIRED` product, which is updated but stays `RETIRED`: the
  file never manages lifecycle.
- **Field presence is meaningful on update.** A file item that omits an
  optional field leaves the existing value alone; clearing a field requires
  an explicit `null` or `[]`. The file is a partial edit, not a full
  declaration of desired state — curated values the export doesn't carry are
  never wiped.
- **Ref resolution order and ambiguity.** `dependsOn` refs match component
  slug → name → `externalId`. Name is not unique: a ref resolving only through
  a name that matches multiple components is skipped with an ambiguity reason.
  Refs are not lifecycle-filtered — matching a `RETIRED` component wires it,
  consistent with the existing edge API's existence-only check.
- **Type changes follow existing update rules.** A file item whose `type`
  would flip a `PLATFORM` that still has `CONSUMES_FROM` consumers hits the
  same guard as a normal product update (`TYPE_CHANGE_BLOCKED`) — the item
  lands in `skipped` with a reason rather than breaking edge invariants.
- **No implicit entity creation.** Unresolved owners, components, or any other
  referenced entity are reported — the import never fabricates a Component,
  Team, or LineOfBusiness.
- **Product→product wiring is out of the file.** `COMPOSES` and
  `CONSUMES_FROM` cannot be expressed (ordering + cycle semantics deferred per
  ADR-114); unknown keys are rejected by the strict schema. `dependsOn`
  targets concrete components only — group targets are wired via the normal
  API/UI.
- **Dry run resolves against live data.** `?dryRun=true` performs the same
  validation and ref resolution and returns the identical report shape with
  zero writes; two dry runs against a changing catalog may differ.
- **Mid-apply failure is partial, not fatal.** Each product item commits as
  its own unit; an unexpected failure on one item is captured in `skipped`
  with a reason and the rest of the file still applies. The whole-file
  rejection is reserved for document-level validation failures.
- **Empty document.** A valid document with an empty `products` list applies
  cleanly and returns a zero-count report — not an error.
- **No-op updates don't write.** A file item that matches an existing
  product with identical field values produces no update and no audit row —
  it is counted as neither `created` nor `updated`, so re-importing an
  unchanged file reports all zeros.
- **Bulk picker exclusions.** Multi-select in the dependency picker offers
  only `ACTIVE` components, consistent with default list conventions;
  components the product already depends on are rendered disabled
  (non-selectable).
- **Fast-path selection hygiene.** `RETIRED` components are not selectable for
  the create-from-components flow; components already grouped/wired elsewhere
  are still selectable (a component may serve many products).
- **Not an importer.** The import is a curated one-shot write through the
  normal entity/edge services — no `DiscoveredAsset`, no scheduling, no run
  history, no reconciliation. Constitution II is untouched.

## Requirements *(mandatory)*

### Functional Requirements

**Bootstrap import (ADR-114)**

- **FR-001**: The system MUST accept a declarative document in YAML or JSON
  (YAML 1.2 subsumes JSON) shaped `{version: 1, products: [...]}` where each
  product item carries `name`, `type`, and optional `description`,
  `owner: {lob?, team?}` (entity slugs), `tags`, `criticality`, `sunsetAt`,
  and `dependsOn: [ref]`. The schema is strict: unknown fields, a `version`
  other than `1`, malformed items, or duplicate derived slugs reject the
  entire upload with per-item errors and zero writes.
- **FR-002**: Products MUST be upserted by the slug derived from `name` — an
  existing product with that slug has its mutable fields updated; a new slug
  creates the product. Updates use **merge semantics**: only fields present
  in the file item are applied (an explicit `null` or `[]` clears the field);
  omitted fields — including omitted `owner` sub-keys — are left untouched.
  Products are never deleted, products absent from the file are untouched,
  and lifecycle is never changed (a matched `RETIRED` product stays
  `RETIRED`).
- **FR-003**: Owner refs MUST resolve against `LineOfBusiness` and `Team`
  slugs; `dependsOn` refs MUST resolve against components by slug, then name,
  then `externalId`. Unresolved or ambiguous refs MUST land in the report's
  `skipped` list with a reason — never fabricated, never fatal to the apply.
- **FR-004**: Each resolved `dependsOn` ref MUST produce a `DEPENDS_ON` edge
  to that component if one does not already exist; re-importing the same file
  MUST be idempotent — no duplicate products or edges.
- **FR-005**: The apply MUST return a report of the shape
  `{created, updated, edgesAdded, skipped: [{item, reason}]}`, and a dry-run
  mode (`?dryRun=true`) MUST return the same report shape with zero writes.
  Apply is per-item atomic: each product item (upsert + edges) commits
  independently, and an item that fails mid-apply lands in `skipped` with a
  reason while the apply continues — the report always reflects final state.
- **FR-006**: The import MUST require the existing product-create permission
  (EDITOR+) and MUST write audit entries for every product created/updated
  and every edge added, attributed to the acting user (ADR-052).
- **FR-007**: The file MUST NOT create components, owners, or any other
  entity, and MUST NOT express `COMPOSES`/`CONSUMES_FROM` edges — product→
  product wiring stays manual.
- **FR-008**: The Products page MUST offer an "Import products" flow that
  accepts a file, shows a dry-run preview of the report, applies on confirm,
  and renders the final report (counts plus the skipped list) afterward.

**Create product from components (plan item 1.3)**

- **FR-009**: The components list MUST support selecting multiple components
  and offer a "Create product" action that opens the standard product-create
  form; on submit, the product and `DEPENDS_ON` edges to every selected
  component MUST be created in one atomic action — partial failure leaves the
  catalog unchanged.
- **FR-010**: Only `ACTIVE` components MUST be selectable; a selection of one
  component MUST work identically to a larger selection.

**Bulk dependency wiring (plan item 2.1)**

- **FR-011**: The dependency picker on the product detail page MUST support
  selecting multiple components and wiring them in one atomic action using
  the existing `componentIds[]` input, with one audit entry per edge.
- **FR-012**: The exactly-one-of target union (`componentId` |
  `componentGroupId` | `componentIds[]`) MUST be preserved — a single action
  never mixes group and component targets.

**Cross-cutting**

- **FR-013**: `docs/openapi.yaml` MUST be updated in the same change for the
  new/modified endpoints (ADR-104), and `docs/digital-products.md` (plus any
  affected catalog docs) MUST describe the implemented behavior.
- **FR-014**: The import MUST go through the normal entity/edge services — it
  is not an importer and introduces no `DiscoveredAsset` source, schedule, or
  run history (constitution II).

### Key Entities

- **Bootstrap document**: the transient upload payload — `version`, plus
  product items with fields and `dependsOn` refs. Validated as a whole, then
  discarded; never persisted.
- **DigitalProduct**: the upsert target — matched by derived slug; created or
  field-updated, never deleted, lifecycle untouched by the file.
- **DEPENDS_ON edge**: product→component edge created for each resolved ref;
  the same edge the fast path and bulk picker wire.
- **LineOfBusiness / Team**: owner entities resolved by slug from
  `owner.lob`/`owner.team`; referenced, never created.
- **Import report**: the apply/dry-run result — `created`, `updated`,
  `edgesAdded`, and per-ref `skipped` reasons; returned to the client, not
  stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new adopter turns an existing application inventory into a
  populated product layer in a single upload — a document declaring 200
  products with dependencies applies end-to-end with zero manual product
  creation and completes in under 1 minute.
- **SC-002**: A malformed upload leaves the catalog byte-for-byte unchanged —
  0 products and 0 edges written — while identifying every malformed item.
- **SC-003**: 100% of unresolvable references are reported with a reason; 0
  are silently dropped and 0 placeholder entities are fabricated.
- **SC-004**: Re-importing an unchanged valid file produces `created: 0`,
  `updated: 0`, and `edgesAdded: 0`, and writes no new audit rows — verified
  idempotency.
- **SC-005**: Wiring N components to a product takes 1 user action instead of
  N; creating a product pre-wired to N components takes 1 form submission
  instead of N+1 actions.
- **SC-006**: 100% of applied changes are auditable — one entry per product
  created/updated and per edge added, attributed to the acting user.
- **SC-007**: A dry run writes nothing and returns a report identical in shape
  to the real apply's, so users can trust the preview before committing.

## Assumptions

- The file schema has no `slug` field — slugs are derived from `name` using
  the existing product slugification, and the derived slug is the upsert key.
- Ref resolution is not lifecycle-filtered: a ref matching a `RETIRED`
  component wires it, matching the existing edge API's existence-only
  behavior. UI selections (picker, fast path) still offer only `ACTIVE`
  components per list conventions.
- `dependsOn` in the file targets concrete components only; group targets are
  out of file scope and remain wireable through the existing API/UI.
- Standard request body-size limits apply; no file-specific cap is introduced
  in v1 beyond what the API already enforces.
- A product item that fails reference resolution is still applied (minus the
  unresolved refs); only malformed items fail the whole document — per
  ADR-114's strict-then-best-effort split.
- The bulk `componentIds[]` input on `POST /products/{id}/depends-on` is
  already implemented and audited server-side (shipped with the ADR-110
  amendment); this feature's remaining bulk work is the multi-select picker.
- The import uses the existing product-create permission — no new role or
  permission is introduced.
- Audit, session, and RBAC conventions follow existing product/edge behavior.
