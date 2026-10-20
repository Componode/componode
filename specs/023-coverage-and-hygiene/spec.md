# Feature Specification: Catalog Coverage & Hygiene

**Feature Branch**: `feature/023-coverage-and-hygiene`

**Created**: 2026-10-20

**Status**: Draft

**Input**: `023-coverage-and-hygiene` — implement the ratified Phase-2
coverage items and Phase-3 stewardship-lite items of the practical-DPAM
improvement plan (`researches/digital_product_concepts_review_research.md`
§4, packaged as this feature by the 2026-10-18 grilling addendum; the
remaining Phase-2 item 2.1 bulk wiring already shipped in `019`/`021`):

1. **Catalog coverage metrics** (item 2.3) — the dashboard reports how
   completely the catalog is wired: the share of active components claimed
   by ≥1 product, and counts of products without owner, without declared
   dependencies, and without description (research hassle H4 — "coverage
   blindness").
2. **Coverage worklists** (item 2.2 + the ratified "list filters") — every
   coverage gap is reachable as a filtered list: unwired components on the
   components list; missing-owner / missing-deps / missing-description on
   the products list.
3. **Sunset-overdue attention items** (item 2.4) — entities whose `sunsetAt`
   has passed surface in the dashboard attention feed, reusing the ADR-111
   display-only sunset semantics (research hassle H5).
4. **Completeness chip** (item 3.1) — per-product owner / description /
   dependencies indicators on list rows and the detail header —
   informational signals, never a score.
5. **Platform consumer surfacing** (item 3.2) — `PLATFORM` products show
   their derived consumer count (`CONSUMES_FROM` in-degree), answering the
   Team Topologies "does this platform have customers?" test.

No new architecture decisions are needed — the research doc assigns no ADRs
to these items: every surface is a read-only derivation over existing data
(the ADR-112 health-rollup precedent for derived, never-stored values). The
ratified details fixed for this spec: the coverage metric set plus list
filters, and chip = owner/description/deps on products only.

## Clarifications

### Session 2026-10-20

- Q: When deciding whether a product "has dependencies" (the missing-deps
  metric, product-list filter, and chip deps facet), should a product that
  only composes other products — with `DEPENDS_ON` edges living on its
  descendants — count as having dependencies? → A: Dependency surface
  non-empty — the product's own `DEPENDS_ON` edges, its own `CONSUMES_FROM`
  edges, or any non-retired `COMPOSES` descendant's `DEPENDS_ON` (recursive)
  all relieve the flag.
- Q: When computing component wiring coverage, should a `DEPENDS_ON` edge
  from a `RETIRED` product still count as claiming that component? → A: No —
  only edges from non-retired products wire a component; when its last
  active dependent retires, the component returns to the unwired worklist.
- Q: For the wired-coverage metric and unwired worklist, should components
  whose every instance is `GONE` count in the coverage population? → A: No —
  the population is the default-visible set: `ACTIVE` and not
  instances-all-`GONE` (components with zero instances still count). Metric
  and worklist agree under default filters with no URL coupling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how completely the catalog is wired (Priority: P1)

As a catalog maintainer, I want the dashboard to report catalog coverage —
what share of discovered components is claimed by a product, and how many
products are missing an owner, dependencies, or a description — so I can
judge completeness at a glance and decide where to curate next.

**Why this priority**: Coverage blindness is hassle H4 — a catalog tool that
cannot show its own completeness cannot guide the user to the next best
action, which is the core practical-DPAM loop. Every other story in this
feature exists to make these numbers actionable or to flag adjacent hygiene;
the metrics themselves are the headline.

**Independent Test**: Seed a catalog with wired and unwired components and
products in varying completeness states — the dashboard shows the wired
share and the three product-gap counts, each matching a manual count of the
underlying data. Delivers full value with no list filters, chips, or
attention changes.

**Acceptance Scenarios**:

1. **Given** a catalog with active components and products, **When** I open
   the dashboard, **Then** I see the wired-component share (count and
   percentage) and counts of products without an owner, without
   dependencies, and without a description.
2. **Given** a component reached only through a `ComponentGroup` a product
   depends on (ADR-110), **When** coverage is computed, **Then** that
   component counts as wired.
3. **Given** a component whose only product link is a `PENDING` candidate
   edge (ADR-113), **When** coverage is computed, **Then** it counts as
   unwired — a suggestion is not a claim.
4. **Given** components wired only to `RETIRED` products, `RETIRED`
   components, and `ACTIVE` components whose instances are all `GONE`,
   **When** coverage is computed, **Then** none confers or inflates
   coverage — the population is the default-visible component set claimed
   by non-retired products.
5. **Given** a catalog with zero active components, **When** I view the
   wired share, **Then** it renders as a muted "—" — never `0%`, never an
   error.
6. **Given** any coverage number, **When** I compare it to a hand count of
   the underlying records, **Then** they agree — the metrics are derivations
   over current data, not cached figures.

---

### User Story 2 - Work coverage gaps from filtered lists (Priority: P2)

As a catalog maintainer, I want each coverage gap to open as a filtered
list — unwired components, products missing an owner, missing dependencies,
or missing a description — so the dashboard number becomes a worklist I can
act on instead of a fact I can only read.

**Why this priority**: Metrics without a path to action answer "how am I
doing" but not "what do I do next." The ratified plan pairs the metric set
with list filters (item 2.2 names the unwired-components worklist
explicitly). Second to the metrics only because the numbers alone already
deliver visibility.

**Independent Test**: From the dashboard coverage figures, follow the
unwired-components link — the components list opens pre-filtered to exactly
the unwired set, and its count equals the dashboard figure; apply the
no-owner product filter the same way.

**Acceptance Scenarios**:

1. **Given** the components list, **When** I apply the unwired filter,
   **Then** it shows exactly the default-visible components (`ACTIVE`,
   not instances-all-`GONE`) with no `DEPENDS_ON` path — direct edge or
   depended-on group membership — from a non-retired product.
2. **Given** a component that is a member of a depended-on group but has no
   direct edge, **When** the unwired filter is applied, **Then** it is
   excluded — group coverage counts.
3. **Given** the products list, **When** I apply the missing-owner,
   missing-dependencies, or missing-description filters, **Then** each
   returns exactly the products failing that completeness check — and the
   filters compose with each other and with existing list filters.
4. **Given** a filtered worklist, **When** I copy the URL, **Then** the
   filter state is preserved in the query string — the worklist is
   shareable and back-button friendly per `docs/ux.md` §4.
5. **Given** a dashboard coverage figure, **When** I follow it to its
   filtered list, **Then** the list size matches the figure — metric and
   worklist can never disagree about what counts as a gap.
6. **Given** an empty worklist (e.g. every component wired), **When** I open
   the filtered list, **Then** the standard empty state renders — coverage
   at 100% is a valid result, not an error.

---

### User Story 3 - Get flagged about overdue sunsets (Priority: P3)

As a catalog maintainer, I want entities whose announced sunset date has
passed to appear in the dashboard attention feed, so planned decommissions
that have gone stale are visible as hygiene items rather than silently
rotting in the catalog.

**Why this priority**: Research hassle H5 — `sunsetAt` badges exist on
entity pages but nothing aggregates "what needs attention as a catalog."
It ranks below coverage because it flags decay rather than missing
structure, and it reuses existing attention-feed machinery.

**Independent Test**: Set `sunsetAt` in the past on an active product and an
active component — both appear in the attention feed with links to the
entities; nothing else about the entities changes.

**Acceptance Scenarios**:

1. **Given** an `ACTIVE` product and an `ACTIVE` component each with
   `sunsetAt` in the past, **When** I open the dashboard, **Then** both
   appear in the attention feed, labeled as sunset-overdue and linking to
   the entity.
2. **Given** a `RETIRED` entity with an overdue `sunsetAt`, **When** the
   attention feed is computed, **Then** no item appears — an already-retired
   thing is resolved, not overdue.
3. **Given** entities with `sunsetAt` in the future or unset, **When** the
   feed is computed, **Then** they produce no items.
4. **Given** an overdue-sunset entity, **When** the date passes, **Then**
   its appearance in the feed is display-only — lifecycle never changes,
   per ADR-111.
5. **Given** both operational items (failed runs, `ERROR`/`GONE` instances,
   `ERROR`-health products) and overdue sunsets, **When** the feed renders,
   **Then** sunset items rank below every operational kind — hygiene never
   outranks breakage.

---

### User Story 4 - Per-product completeness signals (Priority: P4)

As a catalog maintainer scanning the product list, I want each product to
carry small completeness indicators — has an owner, has a description, has
declared dependencies — so I can spot thin records without opening each
detail page.

**Why this priority**: The ratified stewardship-lite ceiling (item 3.1) —
"the owner can't be named is a data point" made visible. Deliberately not a
scorecard: three independent signals, never a rolled-up score. It ships
after the aggregate metrics because the per-row view is a refinement of the
same gap data.

**Independent Test**: Create products in each completeness combination —
all-set, ownerless, undescribed, dep-free — and verify the row and detail
indicators reflect each facet independently.

**Acceptance Scenarios**:

1. **Given** a product with a LOB owner but no team owner, **When** I view
   its completeness indicators, **Then** the owner facet shows satisfied —
   either ownership slot counts.
2. **Given** a product with a description that is empty or whitespace-only,
   **When** indicators render, **Then** the description facet shows missing.
3. **Given** a product whose only dependency is on a `ComponentGroup`
   (including an empty one), **When** indicators render, **Then** the
   dependencies facet shows satisfied — declared intent counts.
4. **Given** any product, **When** its indicators render on the list row and
   the detail header, **Then** the same three facets show the same values in
   both places.
5. **Given** the indicators, **When** they render, **Then** they are
   informational only — no combined percentage, letter grade, or "health of
   the record" score is ever produced from them.

---

### User Story 5 - See whether a platform has consumers (Priority: P5)

As a catalog maintainer evaluating a `PLATFORM` product, I want to see how
many products consume it — surfaced at a glance — so I can tell governed
shared infrastructure from a platform nobody uses.

**Why this priority**: Item 3.2 — the Team Topologies "does this platform
have customers?" test as a read-only derivation over `CONSUMES_FROM`
in-degree. The edge data and the Consumed-by section already exist; this
surfaces the count. Lowest priority because it informs rather than drives
action.

**Independent Test**: Give a `PLATFORM` product three `CONSUMES_FROM`
consumers — its consumer count shows "consumed by 3 products"; remove all
consumers and it renders as a muted zero state.

**Acceptance Scenarios**:

1. **Given** a `PLATFORM` product consumed by three products via
   `CONSUMES_FROM`, **When** I view it, **Then** a derived "consumed by 3
   products" figure is visible without expanding the Consumed-by edge
   section.
2. **Given** a `PLATFORM` product with no consumers, **When** the figure
   renders, **Then** it shows a muted zero/"not consumed" state — absence of
   consumers is itself the signal.
3. **Given** any `PLATFORM` product, **When** its consumer count is compared
   to the Consumed-by section's listed consumers, **Then** they always
   agree — the count is the same derivation, not a second computation.
4. **Given** a non-`PLATFORM` product, **When** it is viewed, **Then** no
   consumer figure appears — `CONSUMES_FROM` can only target platforms
   (ADR-018).

### Edge Cases

- **Group coverage is expansion-based.** A component counts as wired when it
  is a member of *any* group a non-retired product depends on — group
  expansion is single-hop (groups cannot nest), so the check stays cheap
  and cycle-free.
- **Declared vs. expanded dependencies diverge on empty groups.** A product
  whose only dependency is an edge to an empty group has declared intent —
  "has dependencies" is satisfied — even though the edge currently expands
  to zero components. The dependencies facet and the missing-deps metric
  count the declared dependency surface, not expanded sources.
- **Composition relieves the flag; consumption does not propagate.** A
  product with no `DEPENDS_ON` edges of its own whose non-retired `COMPOSES`
  descendants (recursively) declare `DEPENDS_ON` is *not* dep-less — the
  dependency surface matches the detail page's Declared + Inherited view.
  A retired descendant's edges are dormant and relieve nothing (same rule
  as coverage). A descendant's `CONSUMES_FROM` does not relieve the parent:
  consumption is never inherited, per the rule ADR-112 applies to health.
- **Pending suggestions confer nothing.** A `PENDING` candidate edge is not
  a claim — the component stays unwired until a human accepts (ADR-113).
  Accepted suggestions count normally because they become real edges.
- **Retired endpoints and gone-only components are invisible to every
  metric.** `RETIRED` components and components whose every instance is
  `GONE` leave the coverage population entirely (clarification
  2026-10-20); edges from `RETIRED` products do not
  wire anything; retired entities produce no attention items and no
  completeness rows in default views.
- **Zero denominators render absent, not zero.** A catalog with no active
  components shows "—" for wired share rather than a misleading `0%`.
- **Sunset is a date, not a gate.** Overdue items are informational — they
  never alter `lifecycle`, never block operations, and disappear only when
  `sunsetAt` is cleared/moved forward or the entity retires.
- **Attention ordering and cap.** Sunset items rank after every operational
  kind; the feed's existing cap is shared, so a burst of overdue sunsets
  cannot crowd out a failed run.
- **Consumer count follows the Consumed-by section.** The surfaced figure
  is the size of the same consumer set the detail page already lists —
  including its existing lifecycle conventions — never a separate query
  with different semantics.
- **Everything is derived per read.** No metric, flag, or count is stored;
  wiring, renaming, or retiring entities reflects on the next read with no
  recomputation job.

## Requirements *(mandatory)*

### Functional Requirements

**Catalog coverage metrics (item 2.3)**

- **FR-001**: The dashboard MUST present a catalog-coverage section
  reporting: the count and percentage of default-visible components (per
  FR-002) wired to ≥1 non-retired product; the count of non-retired
  products without an owner; with an empty dependency surface; and without
  a description. All values are derived per read — never stored, never
  writable.
- **FR-002**: A component MUST count as wired when a non-retired product
  reaches it through a `DEPENDS_ON` path — a direct component edge or
  membership in a `ComponentGroup` the product depends on (ADR-110
  expansion). Pending candidate edges MUST NOT count; edges from `RETIRED`
  products MUST NOT count. The coverage population is the default-visible
  component set — `ACTIVE` and not instances-all-`GONE` — so `RETIRED`
  components and gone-only components MUST NOT be in the denominator
  (matching the components list's default visibility rules).
- **FR-003**: Each coverage figure MUST link to (or otherwise open) the
  corresponding filtered list from FR-004/FR-005, and a zero-denominator
  metric MUST render as a muted "—" rather than `0%` or an error.

**Coverage worklists (item 2.2 + list filters)**

- **FR-004**: The components list MUST offer a wiring filter that restricts
  to default-visible unwired components per the FR-002 semantics; the
  filtered count MUST equal the dashboard's unwired figure for the same
  catalog state.
- **FR-005**: The products list MUST offer completeness filters for missing
  owner, empty dependency surface, and missing description — each matching
  the FR-009 facet semantics exactly, and each composable with the other
  filters and with existing product list filters.
- **FR-006**: All coverage filters MUST live in the URL query string
  (shareable, back-button friendly per `docs/ux.md` §4) and MUST preserve
  the standard list-page anatomy (filter bar, state matrix, empty state).

**Sunset-overdue attention (item 2.4)**

- **FR-007**: The dashboard attention feed MUST include an overdue-sunset
  item kind for `ACTIVE` products and `ACTIVE` components whose `sunsetAt`
  is in the past — labeled distinctly, linking to the entity, display-only
  (ADR-111: the date passing never changes lifecycle or blocks anything).
- **FR-008**: Sunset items MUST rank below all operational attention kinds
  and share the existing feed cap; `RETIRED` entities and `GONE` instances
  MUST NOT produce sunset items.

**Completeness chip (item 3.1)**

- **FR-009**: Product list rows and the product detail header MUST show
  three independent completeness indicators — owner, description,
  dependencies — rendered per facet on products only. The indicators MUST
  never be combined into a score, percentage, or grade.
- **FR-010**: Facet semantics: *owner* is satisfied when the LOB or team
  owner (or both) is set; *description* is satisfied when the description is
  non-blank; *dependencies* is satisfied when the product's dependency
  surface is non-empty — ≥1 declared `DEPENDS_ON` edge (direct or group
  target, regardless of expansion), ≥1 `CONSUMES_FROM` edge, or ≥1
  non-retired `COMPOSES` descendant (recursive) that itself declares
  `DEPENDS_ON`.

**Platform consumer surfacing (item 3.2)**

- **FR-011**: `PLATFORM` products MUST surface a derived consumer count —
  "consumed by N products" from `CONSUMES_FROM` in-degree — visible at a
  glance on the detail page (header or overview) and wherever product rows
  can represent a platform. Zero consumers MUST render as a muted
  "not consumed" state; the count MUST equal the number of consumers the
  existing Consumed-by section lists.

**Cross-cutting**

- **FR-012**: Every surface in this feature MUST be a read-only derivation —
  no new persisted entities, no write paths, side-effect-free `GET`s
  (ADR-094), readable by any authenticated role (ADR-097).
- **FR-013**: `docs/openapi.yaml` MUST be updated in the same change for
  every added/modified endpoint or query parameter (ADR-104), and
  `docs/ux.md` §10 plus any affected catalog docs MUST describe the new
  dashboard section and filters.
- **FR-014**: The feature MUST NOT introduce scorecards, maturity grades,
  thresholds, or alerts — completeness signals stay per-facet and
  informational (research §5 non-goals).

### Key Entities

- **Catalog coverage**: the derived metric set — wired-component share and
  the three product-gap counts. A read-time projection over existing
  entities and edges; never persisted (CONTEXT.md).
- **Attention item**: the feed entry extended with an overdue-sunset kind —
  `{kind, label, href, at}`; `at` is the `sunsetAt` date.
- **Completeness chip**: the per-product projection `{owner, description,
  dependencies}` of three booleans; derived, never stored.
- **Consumer count**: the derived `CONSUMES_FROM` in-degree of a `PLATFORM`
  product — the same set the Consumed-by section lists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can answer "how complete is my catalog?" from the
  dashboard alone — the wired share and all three product-gap counts are
  visible without navigating away.
- **SC-002**: Every coverage figure is actionable in ≤2 clicks: figure →
  filtered worklist, with the list size matching the figure in 100% of
  tested states.
- **SC-003**: 100% of `ACTIVE` entities with an overdue `sunsetAt` appear in
  the attention feed; 0 `RETIRED` entities or future-sunset entities do.
- **SC-004**: The three completeness facets are independently verifiable
  per product — across all 8 completeness combinations each facet reflects
  its own rule, and 0 aggregate scores appear anywhere.
- **SC-005**: A user can answer "does anyone consume this platform?" without
  expanding an edge section, and the consumer figure agrees with the
  Consumed-by list in 100% of cases.
- **SC-006**: The feature adds 0 tables and 0 write paths — every number is
  recomputed per read and reflects catalog changes on the next load.

## Assumptions

- The dashboard summary endpoint is the natural carrier for the coverage
  section (the plan's "one aggregate endpoint; no new state"); the exact
  response shape is a planning detail.
- "Has dependencies" is the recursive dependency surface (clarification
  2026-10-20): own `DEPENDS_ON` — including an edge to an empty group —
  own `CONSUMES_FROM`, or a `COMPOSES` descendant's `DEPENDS_ON`.
- An edge owned by a `RETIRED` product confers no coverage (clarification
  2026-10-20): when its last non-retired dependent retires, the component
  returns to the unwired worklist.
- The coverage population is the default-visible component set
  (clarification 2026-10-20): `ACTIVE` and not instances-all-`GONE` —
  identical to the components list's default visibility, so metric and
  worklist counts agree without URL param coupling.
- The consumer count inherits the existing Consumed-by section's
  conventions (including how it treats retired consumers); this feature
  adds the surfaced figure, not a second derivation.
- The chip's facets are fixed at owner/description/deps, products only, per
  the ratified addendum — no user configuration, no component-side chip.
- "Stale" products (not updated in N days) are not in the ratified metric
  set and stay out of scope; ownerless/dep-less/description-less and
  overdue sunsets carry the stewardship-lite load.
- The sunset-attention item shares the attention feed's cap and ordering
  machinery; no separate hygiene feed is introduced.
