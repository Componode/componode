# Feature Specification: Product hierarchy — products, edges, ownership, tree UI

**Feature Branch**: `005-product-hierarchy`

**Created**: 2026-09-07

**Status**: Shipped

**Input**: User description: "the next spec for this project." — per the README
roadmap and `docs/ux.md` §5, the next feature is the product hierarchy:
Digital Products with COMPOSES / CONSUMES_FROM / DEPENDS_ON_COMPONENT edges,
ownership, the tree-first `/products` page, and the standard tabbed detail page.

**Normative references**: `docs/ux.md` §3–§6 (ADR-103), the Composable Product
Model ADRs — ADR-018 (product types + composition rules), ADR-049/050
(COMPOSES is a DAG, unlimited depth, write-time cycle detection → `409
CYCLE`), ADR-046 (unique slugs), ADR-048 (typed junction tables), and the
constitution's factual-vs-meaning split (products are the curated meaning
layer — never written by importers).

## Clarifications

### Session 2026-09-07

- Q: Do the Components/Instances tabs show only direct `DEPENDS_ON_COMPONENT`
  edges or the transitive roll-up through COMPOSES? → A: Both, in separate
  sections — **Declared** (direct edges) vs **Inherited** (via composed
  products), preserving provenance of where each component enters the graph.
- Q: Do owner pickers apply beyond products? → A: Yes — the team-owner picker
  is added to products, component groups, and components (everywhere
  `teamOwnerId` exists); the LOB-owner picker is products-only (the column
  exists only there).
- Q: Is the product slug editable after creation? → A: Yes — auto-derived from
  the name on create, editable afterward; `/products/:slug` follows the new
  slug with no redirect or slug history (bookmark breakage on rename is an
  accepted, documented limitation).
- Q: Who can manage LOBs and Teams? → A: `EDITOR`+ — org entities are catalog
  curation (same role as product editing); the "Organization" nav group lives
  under Catalog, not Administration.

## User Scenarios & Testing

### User Story 1 - Browse the product tree (Priority: P1)

As any authenticated user, I want to see all my organization's products as an
expandable tree — Business Capability and Customer-Facing products at the top,
Platform products nested beneath the products that compose them — so I can
understand the product landscape at a glance and drill into what composes
what.

**Why this priority**: Products are the meaning layer of Componode; without a
browsable hierarchy there is no catalog story. The `/products` page is
currently a stub, and every other story hangs off having a readable tree.

**Independent Test**: With a seeded hierarchy (a Business Capability composing
two Platform products), open `/products` and verify the tree renders roots,
expands children, and that searching flattens to a list.

**Acceptance Scenarios**:

1. **Given** a populated catalog, **when** `/products` loads, **then** an
   expandable indented tree shows products as parents/children via COMPOSES —
   every product with no COMPOSES parent is a root (typically
   `BUSINESS_CAPABILITY`/`CUSTOMER_FACING`; an unparented `PLATFORM` is a
   root too) — with type badges and lifecycle badges per the enum color map,
   and the tree opens collapsed with an expand-all/collapse-all control.
2. **Given** a product with multiple parents (legal in a DAG), **when** the
   tree renders, **then** it appears under each parent with a "shared"
   indicator marking the duplicate occurrence.
3. **Given** text in the search field or an applied filter, **when** results
   render, **then** the tree flattens to a normal list of matching products;
   expansion state is in-memory only (never URL or storage).
4. **Given** retired products exist, **when** the tree loads, **then** they
   are excluded by default and a visible toggle includes them.
5. **Given** zero products, **when** the page loads, **then** the standard
   empty state renders with a "Create your first product" action for editors.

---

### User Story 2 - Product detail page (Priority: P2)

As any user, I want a detail page for each product — overview, composition
edges, dependent components, and their instances — so I can answer "what is
this product made of and who owns it" without leaving the page.

**Why this priority**: The tree gives structure; the detail page carries the
meaning. It follows the standard detail-page anatomy already ratified in
`docs/ux.md` §4.

**Independent Test**: Open a product with parents, children, a CONSUMES_FROM
edge, and component dependencies; verify each tab renders the right data.

**Acceptance Scenarios**:

1. **Given** a product, **when** its detail page loads, **then** the header
   shows name, type badge, slug, lifecycle, and owners, and tabs render per
   `docs/ux.md`: Overview, Composition, Components, Instances.
2. **Given** the Composition tab, **when** it renders, **then** four labeled
   sections appear — **Composed by** (parents, upward), **Composes**
   (children, downward), **Consumes from** (CONSUMES_FROM edges, any
   product→PLATFORM), **Consumed by** (CONSUMES_FROM consumers — shown only
   for PLATFORM products) — and the two relationship types are never mixed.
3. **Given** the Components tab, **when** it renders, **then** the product's
   component dependencies render in two labeled sections — **Declared**
   (direct `DEPENDS_ON_COMPONENT` edges) and **Inherited** (dependencies of
   composed products, annotated with the path/product they came through) —
   each in the shared catalog table linking to component detail pages.
4. **Given** the Instances tab, **when** it renders, **then** instances are
   grouped by environment with status badges, using the same
   Declared/Inherited split as the Components tab.
5. **Given** the Overview tab, **when** it renders, **then** it shows the
   description, LOB/team owners, and counts (N composed-by, M composes, K
   components, J instances).

---

### User Story 3 - Create and edit products and their edges (Priority: P2)

As an editor or admin, I want to create products, set their type and owners,
and wire up COMPOSES / CONSUMES_FROM / DEPENDS_ON_COMPONENT edges — with
invalid edges rejected clearly — so I can curate the product model by hand.

**Why this priority**: The meaning layer is human-curated (constitution V);
editing is the feature's raison d'être, but it is P2 because a read-only
hierarchy is already independently valuable.

**Independent Test**: As an editor, create a Platform product, compose it into
a Business Capability, attempt a cycle, and verify the 409 error surfaces
clearly.

**Acceptance Scenarios**:

1. **Given** an editor, **when** they create a product with a name, unique
   slug, type, and optional description/owners, **then** it appears in the
   tree; viewers never see create/edit affordances.
2. **Given** a COMPOSES edge `parent → child`, **when** the parent is a
   `PLATFORM`, **then** the request is rejected (COMPOSES parents must be
   `BUSINESS_CAPABILITY` or `CUSTOMER_FACING`); when the edge would close a
   cycle, **then** the request fails with `409 CYCLE` and the UI shows a
   clear "would create a cycle" error.
3. **Given** a CONSUMES_FROM edge, **when** the target is not `PLATFORM`,
   **then** the request is rejected with a validation error naming the rule.
4. **Given** a DEPENDS_ON_COMPONENT edge, **when** an editor links a product
   to a component, **then** it appears on the product's Components tab.
5. **Given** any mutation, **when** it completes, **then** an append-only
   entity/edge change record is written and the UI reflects the change
   without a full reload.
6. **Given** the Composition or Components tab, **when** an editor clicks an
   add/remove affordance, **then** a product/component picker opens filtered
   to the legal types per ADR-018; the same picker MAY be reachable from a
   tree-node context menu ("Compose into…"), but the tree itself has no
   drag-and-drop editing.

---

### User Story 4 - Organization entities and ownership (Priority: P3)

As an editor or admin, I want to manage Lines of Business and Teams and
assign them as product owners, so accountability is real data — visible on
detail pages and selectable in pickers — rather than dead columns.

**Why this priority**: Ownership was decided in-scope: `lobOwnerId`/
`teamOwnerId` exist on products, groups, and components but nothing could
create LOBs or Teams. A small org-entity surface unblocks ownership here and
fills the nav slots `docs/ux.md` already reserved. `Person` is the user table
and stays managed via the existing Users admin page — no People page in v1.

**Independent Test**: Create a LOB and a Team, assign both as owners of a
product, and verify they render on the product's Overview tab and tree row.

**Acceptance Scenarios**:

1. **Given** an editor, **when** they open the new "Organization" sidebar
   group under Catalog (Lines of Business, Teams), **then** they can list,
   create, edit, and delete LOBs and Teams (`EDITOR`+ role — same as product
   curation); each team's member roster is viewable read-only on the Teams
   page (expandable row — no separate team detail page in this feature).
2. **Given** an editor editing a product, **when** they pick a LOB owner and
   team owner, **then** both persist and render on Overview and on the
   product's tree row; the same team-owner picker is available on component
   and component-group forms (LOB ownership is products-only).
3. **Given** a LOB or Team still referenced — as an owner of any entity or
   holding team members — **when** an editor attempts delete, **then** it is
   blocked with a message listing the references; delete succeeds only when
   unreferenced.
4. **Given** a product with no owners, **when** it renders, **then** owner
   fields show an explicit "Unassigned" treatment rather than a blank.

---

### Edge Cases

- **Cycle attempts**: rejected at write time with `409 CYCLE`; the UI explains
  the rule instead of silently failing.
- **Deleting a product**: hard delete is permitted **only when the product has
  no edges** (no COMPOSES, CONSUMES_FROM, or DEPENDS_ON_COMPONENT in either
  direction); a wired-in product must be retired instead. Retire is the
  default removal path and is **non-destructive and reversible**: retired
  products keep all their edges and `RETIRED → ACTIVE` restores them fully.
- **Retired parent**: a RETIRED COMPOSES parent hides its subtree by default;
  children appear only via another visible parent (or in "show retired").
- **Type change**: a product's `type` is editable, but the update MUST be
  rejected (`409`/`422` naming the offending edges) when the new type would
  invalidate existing edges — e.g. a `PLATFORM` cannot become a COMPOSES
  parent, and a non-`PLATFORM` cannot be a CONSUMES_FROM target.
- **Shared nodes in the tree**: a product under multiple parents renders once
  per parent with a "shared" marker; expanding one occurrence does not expand
  siblings of the same node.
- **Retired children**: a RETIRED product nested under an ACTIVE parent is
  hidden by default (with the rest of the retired set) but never breaks the
  parent's expansion.
- **Retired dependencies allowed**: `DEPENDS_ON_COMPONENT` may point at a
  RETIRED component — badges display the status, but no alerting or blocking
  fires; product-level health attention is deferred to a later spec.
- **Empty filter result**: searching/filtering to zero hits shows the empty
  state, not an empty tree.
- **Role gating**: viewers see the tree and detail read-only; mutation
  endpoints return `403 FORBIDDEN` for non-editors.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST expose `GET` endpoints under `/api/v1/` that
  return the product list with its COMPOSES edges, product detail (parents,
  children, consumes-from, component dependencies, instance counts), and the
  component/instance data the detail tabs need — all side-effect-free
  (ADR-094).
- **FR-002**: `/products` MUST render an expandable indented tree of
  COMPOSES edges per `docs/ux.md` §5: multi-parent products appear under each
  parent with a shared indicator; search or filters flatten the tree to a
  list; RETIRED products are excluded by default behind a visible toggle.
- **FR-003**: Product detail MUST follow the standard detail-page anatomy
  (header with name, type badge, slug, lifecycle, owners, actions; tabs
  Overview / Composition / Components / Instances); Composition separates
  Composed-by, Composes, Consumes-from, and Consumed-by into labeled sections
  (Consumed-by shown only for PLATFORM products).
- **FR-004**: Editors MUST be able to create and edit products (name, unique
  slug, type, description, lifecycle, LOB owner, team owner) and retire or
  un-retire them; slugs are unique per ADR-046. Hard delete MUST be rejected
  when the product has any edges. A `type` change MUST be rejected when it
  would invalidate existing edges (error names the offending edges).
- **FR-005**: Editors MUST be able to add and remove `COMPOSES`,
  `CONSUMES_FROM`, and `DEPENDS_ON_COMPONENT` edges. `COMPOSES` parents MUST
  be `BUSINESS_CAPABILITY` or `CUSTOMER_FACING`; `CONSUMES_FROM` targets MUST
  be `PLATFORM` (ADR-018).
- **FR-006**: Cycle detection MUST be enforced at write time per ADR-049/050;
  attempts return `409 CYCLE` and the UI surfaces a clear cycle explanation.
- **FR-007**: Every mutation MUST append `entity_changes` / `edge_changes`
  records (append-only audit, per constitution and ADR-048).
- **FR-008**: Viewers get the full read experience and no write affordances;
  mutation endpoints return `403 FORBIDDEN` for non-editor roles.
- **FR-009**: All new UI conforms to `docs/ux.md` — state matrix on every
  region, enum badges via the fixed color map, relative timestamps, monospace
  slugs, URL-persisted filter/view state, keyboard navigability, WCAG 2.1 AA.
- **FR-010**: All new endpoints live under `/api/v1/`, require authentication,
  validate inputs with Zod rejecting unknown fields (ADR-095), and return
  `{code, message, details?}` errors without leaking internals
  (ADR-071/096).
- **FR-011**: Search results and sidebar navigation MUST include products —
  the existing global search already indexes `digital_products`; product hits
  MUST now navigate to the product detail page. Global search MUST also index
  `line_of_businesses` and `teams` (persons are excluded — they are the
  admin-managed user table).
- **FR-012**: The system MUST expose LOB and Team management: list/create/
  edit/delete endpoints and pages under a new "Organization" sidebar group
  (per the reserved slots in `docs/ux.md` §3). Team detail shows a read-only
  member roster. Deleting a LOB or Team MUST be blocked while it is
  referenced — as an owner of any entity or while it has members — with the
  error or UI naming the references.

### Key Entities

- **DigitalProduct**: `id`, `name`, `slug` (unique), `description`, `type`
  (`BUSINESS_CAPABILITY`/`PLATFORM`/`CUSTOMER_FACING`), `lifecycle`
  (`ACTIVE`/`RETIRED`), `lobOwnerId`, `teamOwnerId`. Table exists; no new
  columns anticipated.
- **COMPOSES** (`product_composes`): parent product → child product; a DAG
  with unlimited depth and write-time cycle enforcement.
- **CONSUMES_FROM** (`product_consumes_from`): product → `PLATFORM` product.
  A different relationship type — never mixed into the COMPOSES tree.
- **DEPENDS_ON_COMPONENT** (`product_depends_on_component`): product →
  component dependency shown on the Components tab.
- **LineOfBusiness / Team**: flat organizational entities (name, slug,
  description). Teams are *not* nested inside LOBs — no hierarchy between
  them. `Person` is the user table (auth) and is managed via the existing
  Users admin page; `persons.teamId` is team membership (read-only roster
  here). Owner references use `onDelete("set null")`, which is why delete is
  blocked while referenced.
- **Audit**: `entity_changes` and `edge_changes` append-only records written
  by every mutation in this feature.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The product tree renders and expands a 1,000-product hierarchy
  in under 2 seconds; expanding a node takes under 300ms.
- **SC-002**: A user can answer "what composes product X and who owns it" in
  under 30 seconds from the dashboard without leaving `/products`.
- **SC-003**: 100% of invalid edge attempts (cycles, wrong-type
  parents/targets) are rejected with the documented error codes — never a
  silent write.
- **SC-004**: Every product mutation produces a corresponding audit record,
  verifiable by querying `entity_changes`/`edge_changes`.
- **SC-005**: Keyboard-only users can navigate the tree, open a product, and
  complete an edit end to end (WCAG 2.1 AA carried from spec 001).
- **SC-006**: All existing test suites continue to pass; new UI and endpoints
  are covered by component and integration tests.

## Assumptions

- The schema is already complete: `digital_products`, `product_composes`,
  `product_consumes_from`, `product_depends_on_component`, `entity_changes`,
  and `edge_changes` all exist — no migrations expected.
- Product routes are slug-based per the `docs/ux.md` route map
  (`/products/:slug`); the API may address products by `id` with slug
  resolution where convenient. Slugs are editable — renaming a product moves
  its URL with no redirect (accepted limitation).
- LOB and Team management **is** in scope (grilling decision): their CRUD
  ships in this feature so product ownership pickers have real data. `Person`
  management is not duplicated — persons are the user records already managed
  in Users admin; a People directory remains deferred.
- This feature depends on the spec-004 shell being merged: it adds a sidebar
  group and extends the palette/search.
- The graph/map visualization remains deferred per `docs/ux.md` §5 — a "Map"
  tab is out of scope and requires its own ADR.
- Products are never written by importers (constitution V); this feature is
  the manual curation surface.
- The UX shell, state matrix, theming, and search infrastructure from spec
  004 are available to build on.
