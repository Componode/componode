# Feature Specification: Group Dependencies & Product Health

**Feature Branch**: `feature/019-group-deps-health`

**Created**: 2026-10-18

**Status**: Draft

**Input**: Implement Phase 0 items 0.1 and 0.2 of the ratified practical-DPAM
improvement plan (`researches/digital_product_concepts_review_research.md`,
packaged as feature `019-group-deps-health` by the 2026-10-18 grilling
addendum): ADR-110 — `DEPENDS_ON` may target a `ComponentGroup` (including the
2026-10-18 amendment extending the union input with bulk `componentIds[]`), and
ADR-112 — derived product health rollup from component instance status. Both
ADRs are ratified but unimplemented; no new architecture decisions are needed.

## Clarifications

### Session 2026-10-18

- Q: When a product's health is computed, should it reflect only the
  product's own declared dependencies or also dependencies inherited through
  `COMPOSES` descendants? → A: Declared only — the product's own direct +
  group-expanded `DEPENDS_ON` sources; `COMPOSES`-inherited dependencies stay
  display-only on the detail page and never feed health.
- Q: When a `ComponentGroup` is deleted while products still depend on it,
  what happens to the product→group edges? → A: Deletion is blocked — the
  group delete guard returns `409 REFERENCED` and names the depending
  products; the user removes the edges first or retires the group.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See whether my product is affected (Priority: P1)

As a product owner (or anyone browsing the catalog), I want each product to
show a derived health status — on its detail page, on product list rows, and
in the dashboard attention view — so I can answer "is my product affected?"
without cross-referencing individual component instances.

**Why this priority**: The improvement plan calls this the top user question
(item 0.1). The attention dashboard today surfaces unhealthy *instances*; the
missing piece is a documented, derived rollup onto *products*. It is pure
aggregation over data that already exists and is independently valuable even
before group edges exist.

**Independent Test**: Create a product with a declared dependency on a
component whose PRODUCTION instance enters `ERROR` — the product's health
shows `ERROR` on detail, on the list, and in attention; when the instance
recovers, all three clear. Works with zero group edges in the catalog.

**Acceptance Scenarios**:

1. **Given** product P with a declared dependency on component C whose
   `PRODUCTION` instance is `ERROR`, **When** I open P's detail page or the
   product list, **Then** P's headline health is `ERROR`.
2. **Given** P's dependency sources have `PRODUCTION` instances all `RUNNING`
   and a `DEV` instance in `ERROR`, **When** I view P, **Then** the headline
   health is `RUNNING` and the per-environment breakdown shows `DEV: ERROR`.
3. **Given** P's sources have no `PRODUCTION` instances but a `DEV` instance
   in `ERROR`, **When** I view P, **Then** the headline health is `ERROR`
   (all-environments fallback).
4. **Given** a product with no component dependencies, or whose sources have
   only `GONE` instances, **When** I view it, **Then** health is absent and
   renders as a muted "—" — never as healthy or failing.
5. **Given** a product whose health computes to `ERROR`, **When** I open the
   dashboard, **Then** the product appears in the attention section; a product
   whose sources are `GONE`-only never appears there.
6. **Given** a source component that is `RETIRED` with instances in `ERROR`,
   **When** health is computed, **Then** those instances are excluded — a
   retired logical thing does not flag the product.
7. **Given** a product depending on a component group, **When** a member of
   that group has an `ERROR` instance, **Then** the member contributes to the
   product's health exactly like a direct dependency.

---

### User Story 2 - Depend on a whole component group (Priority: P2)

As a catalog maintainer, I want to wire "my product uses the payments DB" as
one edge to the "Payments DBs" `ComponentGroup` — instead of one edge per
member — so the dependency stays complete when a fourth member is imported
and added to the group later.

**Why this priority**: This is the N-edges-for-one-dependency tax (hassle
H2/H3) on the most common real-world shape: the same logical thing discovered
as N components across accounts/regions. It is also the prerequisite for
group-covered suggestion suppression in `022-edge-suggestions` (ADR-113 §6).

**Independent Test**: Create a group with three members, add one dependency
edge from a product to the group, then add a fourth member to the group — the
product's dependency view shows all four with "via {group}" attribution
without any rewiring.

**Acceptance Scenarios**:

1. **Given** product P and group G with members, **When** I add a dependency
   from P to G, **Then** the edge is stored as product→group and P's
   dependency list expands to G's current members, each annotated
   "via {G name}".
2. **Given** a component reachable by P both through a direct edge and through
   a group edge, **When** I view P's dependencies, **Then** the component is
   listed once with both sources attributed — no auto-merge, no duplicate row.
3. **Given** a group edge exists, **When** a member is added to or removed
   from G, **Then** P's dependency view reflects the change automatically —
   the edge is never materialized to per-member rows.
4. **Given** an empty group, **When** I add a dependency edge to it, **Then**
   the edge is valid and expands to zero components.
5. **Given** both a direct edge to component C and a group edge covering C,
   **When** I remove the group edge, **Then** the direct edge survives — and
   removing the group edge never removes or alters the member-level picture
   contributed by other sources.
6. **Given** a group edge exists, **When** I view the product's audit history,
   **Then** the add/remove entries name the group as the edge target
   (`component_group`).
7. **Given** a product with group edges, **When** I try to delete the product,
   **Then** the delete guard counts those edges and blocks deletion like any
   other edge.
8. **Given** the dependency edge picker, **When** I search for targets,
   **Then** groups appear alongside components, labeled with their member
   count (e.g. "Payments DBs (group · 3)").

---

### User Story 3 - Wire several components in one request (Priority: P3)

As a catalog maintainer, I want to add several component dependencies to a
product in a single request, so wiring a real product to a dozen components
doesn't take a dozen round-trips.

**Why this priority**: The 2026-10-18 amendment to ADR-110 extends the union
input with `componentIds[]`; implementing it with the route costs little and
partially relieves hassle H3 ahead of `023-coverage-and-hygiene`.

**Independent Test**: POST one request carrying three component IDs — three
edges exist, three audit entries are written, and repeating the request is
harmless.

**Acceptance Scenarios**:

1. **Given** product P and components A, B, C, **When** I submit a dependency
   request with `componentIds[] = [A, B, C]`, **Then** all three edges are
   created in one transaction with one audit entry per edge.
2. **Given** a bulk request where one ID does not exist, **When** the request
   is processed, **Then** the entire request fails and zero edges are applied
   (all-or-nothing).
3. **Given** a bulk request where some pairs already exist, **When** the
   request is processed, **Then** it succeeds — adding the same edge twice is
   idempotent, as with the single-target form today.
4. **Given** a request body carrying more than one of `componentId`,
   `componentGroupId`, `componentIds[]`, **When** it is validated, **Then**
   it is rejected as invalid input (exactly-one-of).

### Edge Cases

- **Inherited dependencies do not feed health.** Health sources are the
  product's own declared `DEPENDS_ON` targets only (ADR-112 "direct").
  Dependencies inherited through `COMPOSES` descendants remain display-only
  on the detail page — including them would double-report a child's fault on
  every ancestor, the failure mode ADR-112 rejects for `CONSUMES_FROM`.
- **Headline vs. per-env truth.** A `DEV`-only `ERROR` never downgrades a
  healthy `PRODUCTION` headline, but with no `PRODUCTION` instances the
  all-env signal is the only one and sets the headline.
- **Empty and degenerate groups.** An edge to an empty group is valid and
  expands to nothing; groups cannot nest, so expansion is single-hop and
  cycle-free by construction.
- **Removal is target-kind-aware.** Removing a `DEPENDS_ON` edge requires
  knowing whether the target is a component or a group; the remove operation
  carries a target-kind discriminator, and removing a group edge never
  deletes the direct edge to one of its members.
- **A component in two depended-on groups** is listed once with both groups
  attributed.
- **Bulk request hygiene**: an empty `componentIds[]` array is a validation
  error; duplicates within the array collapse to one edge.
- **Retired products** keep computed health but stay excluded from default
  lists per existing conventions; the attention section follows the same
  lifecycle filtering as the rest of the dashboard.
- **Deleting a depended-on group is blocked.** A `ComponentGroup` referenced
  by product→group edges cannot be hard-deleted (`409 REFERENCED`); remove
  the edges first or retire the group — a retired group keeps expanding to
  its members, so the dependency stays truthful.

## Requirements *(mandatory)*

### Functional Requirements

**Group dependency edges (ADR-110 + amendment)**

- **FR-001**: A product MUST be able to declare `DEPENDS_ON` on a
  `ComponentGroup` in addition to a concrete `Component`. The group edge is
  persisted as product→group — never expanded to member edges at write
  time — so group membership changes propagate automatically.
- **FR-002**: Dependency reads MUST expand group edges to their current
  member components, annotate each member "via {group name}", and
  deduplicate against other reachability paths — a component reachable via
  a direct edge, one or more group edges, and/or inheritance is shown once
  with all its sources attributed.
- **FR-003**: The add-dependency operation MUST accept exactly one of
  `{componentId}`, `{componentGroupId}`, or `{componentIds[]}` — zero or
  multiple forms is a validation failure (ADR-095).
- **FR-004**: `componentIds[]` MUST apply atomically in a single transaction:
  any unknown component fails the entire request; already-existing pairs are
  idempotent; one audit entry is written per edge.
- **FR-005**: An edge to an empty group MUST be accepted and expand to zero
  components.
- **FR-006**: The remove-dependency operation MUST take a target-kind
  discriminator (component vs. group); removing a group edge MUST NOT affect
  direct edges to its members, and vice-versa.
- **FR-007**: Group-edge audit entries MUST record the target entity type as
  `component_group`; existing component-edge audit shape is unchanged.
- **FR-008**: The product delete guard MUST count group edges — a product
  with any edges cannot be deleted.
- **FR-009**: A `ComponentGroup` MUST NOT be deletable while product→group
  edges reference it — the delete guard rejects with `409 REFERENCED` and
  identifies the depending products; the user removes the edges or retires
  the group instead.
- **FR-010**: The dependency edge picker MUST offer groups alongside
  components, labeled with their member count; the product detail page MUST
  show "via {group}" attribution for expanded members.

**Derived product health (ADR-112)**

- **FR-011**: Product detail responses MUST include a derived, read-only
  `health` value of shape `{status, perEnv, sourceCount}`; product list rows
  MUST carry the headline as `status`. Health is computed per read — never
  stored, never writable through any endpoint.
- **FR-012**: Health sources MUST be the product's declared `DEPENDS_ON`
  targets — direct component edges plus components reached through group
  edges — and MUST NOT roll up transitively through `CONSUMES_FROM` or
  `COMPOSES` descendants.
- **FR-013**: Aggregation MUST be worst-of over source components' non-`GONE`
  instances, ranked `ERROR > STOPPED > RUNNING`. Headline status MUST be
  worst-of `PRODUCTION` instances when any exist, else worst-of all
  non-`GONE` instances; `perEnv` carries the per-environment breakdown.
- **FR-014**: Instances on `RETIRED` components MUST be excluded from the
  rollup.
- **FR-015**: A product with no dependency sources, or whose sources have no
  non-`GONE` instances, MUST return absent health and render a muted "—" —
  absence of data is not health.
- **FR-016**: Products whose health computes to `ERROR` MUST appear in the
  dashboard attention section; `GONE`-only and absent-health products MUST
  NOT appear.
- **FR-017**: The product detail page MUST surface the per-environment
  breakdown behind the health badge; list rows show the headline only.

**Cross-cutting**

- **FR-018**: Permission model is unchanged — edge writes require the
  existing edge-write permission (EDITOR+); reads remain available to any
  authenticated role (ADR-097).
- **FR-019**: `docs/openapi.yaml` MUST be updated in the same change for every
  added/modified endpoint (ADR-104), and `docs/digital-products.md` MUST
  describe group targets and the health rollup.
- **FR-020**: The change MUST NOT alter importer behavior, the importer
  contract, or `ComponentGroup` semantics — groups remain human-declared
  equivalence over distinct source assets (constitution IV/V, ADR-082).

### Key Entities

- **DEPENDS_ON edge**: product → { `Component` | `ComponentGroup` }. Two legal
  target kinds at the same logical, env-agnostic level (ADR-110 amends
  ADR-015); group targets persist as product→group and expand at read.
- **ComponentGroup**: human-declared equivalence across distinct source
  assets (ADR-082); members are components carrying the group's FK. Cannot
  nest — expansion is single-hop.
- **Product health**: derived projection `{status, perEnv, sourceCount}` over
  dependency sources' `ComponentInstance.status` values; never an entity,
  never stored.
- **ComponentInstance.status**: the sole input to health —
  `RUNNING`/`STOPPED`/`ERROR` contribute; `GONE` is excluded (ADR-034).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Expressing "my product uses the payments DBs" takes exactly one
  wiring action regardless of group size (previously N actions for N
  members), and a new group member is covered by existing product edges with
  zero rewiring.
- **SC-002**: A user can answer "is my product affected?" from the product
  list or dashboard without opening instance views; every product in `ERROR`
  health appears in attention.
- **SC-003**: Health conforms to the rollup rules — worst-of ranking,
  `PRODUCTION` headline, `GONE`/`RETIRED` exclusions, absent-when-empty — in
  100% of tested status combinations.
- **SC-004**: A component reachable by K distinct paths is listed exactly once
  with all K sources attributed — zero duplicate rows in dependency views.
- **SC-005**: Wiring M components via the bulk form completes in one request
  with M audit entries, and a single invalid target rolls the whole request
  back — no partial application.

## Assumptions

- `sourceCount` counts the distinct source components contributing to the
  rollup (the expanded set, deduplicated).
- The bulk form requires a non-empty array; a schema-level upper bound may be
  set during planning without changing observable behavior.
- UI multi-select wiring in the edge picker is deferred to
  `023-coverage-and-hygiene`; this feature's UI scope is group entries in the
  picker, "via {group}" attribution, and health badges/attention entries.
- Health is computed regardless of product lifecycle, but default lists and
  the attention section keep their existing filters (e.g. `RETIRED` products
  excluded unless requested).
- Audit, session, and RBAC conventions follow existing edge behavior; no new
  permissions or roles are introduced.
