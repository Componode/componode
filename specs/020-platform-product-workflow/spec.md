# Feature Specification: Platform Product Workflow

**Feature Branch**: `feature/020-platform-product-workflow`

**Created**: 2026-10-18

**Status**: Draft

**Input**: Implement Phase 0 items 0.3 and 0.4 of the ratified practical-DPAM
improvement plan (`researches/digital_product_concepts_review_research.md`,
packaged as feature `020-platform-product-workflow` by the 2026-10-18 grilling
addendum): ADR-017 — the full guided Platform Product workflow. **Detection**
surfaces components depended on by multiple products as platform candidates;
**promotion** creates a `PLATFORM` Digital Product, wires its `DEPENDS_ON` edge
to the component, rewrites the consumers' `DEPENDS_ON` edges into
`CONSUMES_FROM` edges in one bounded transaction, and prompts for an owner
(Team or LOB). The ADR is ratified but unimplemented; no new architecture
decisions are needed.

## Clarifications

### Session 2026-10-18

- Q: When a promotion runs, which consumers' `DEPENDS_ON` edges get rewritten
  to `CONSUMES_FROM`? → A: All by default, with opt-out — the promotion dialog
  lists every active direct consumer with checkboxes, all checked; unchecked
  consumers keep their `DEPENDS_ON` edge.
- Q: Which dependencies count toward the "depended on by ≥2 products"
  threshold for platform candidates? → A: Direct `DEPENDS_ON` edges from
  active products only — group-expanded reach does not count, and
  `PLATFORM`-type dependents count like any other product.
- Q: Should the promotion action exist outside the candidate worklist? → A:
  Yes — the action is available on any component's detail page regardless of
  depender count; a zero- or one-consumer platform is legal.
- Q: How are slug collisions handled? → A: A collision on the *derived* slug
  is resolved by a deterministic `-2`, `-3`… suffix; a slug the user typed
  explicitly returns `409 SLUG_TAKEN` like any product create — a user-chosen
  slug is never silently mutated.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spot shared components that should be platforms (Priority: P1)

As a catalog maintainer, I want Componode to surface components that multiple
products depend on — "payments-events is depended on by 4 products — consider
making it a platform product" — so I can see ungoverned shared infrastructure
without auditing the graph by hand.

**Why this priority**: Detection is the read-only half of ADR-017 and is
independently valuable: even a maintainer who never promotes gets a worklist of
shared components to review. It is also the natural entry point for promotion.

**Independent Test**: Wire two products to the same component — the component
appears in the platform-candidate surface with both products attributed.
Ships value with zero promotions ever performed.

**Acceptance Scenarios**:

1. **Given** component C with `DEPENDS_ON` edges from two or more active
   products, **When** I open the platform-candidate surface, **Then** C is
   listed with its depender count and the depending products identifiable.
2. **Given** a component depended on by exactly one product, **When** I view
   the candidate list, **Then** it is not listed — the threshold is two or
   more.
3. **Given** a component whose only dependents are `RETIRED` products, or a
   component that is itself `RETIRED`, **When** I view the candidate list,
   **Then** it is not listed.
4. **Given** a candidate entry, **When** I inspect it, **Then** I can see which
   products depend on the component and navigate to them — enough context to
   decide whether promotion is warranted.
5. **Given** no components meet the threshold, **When** I view the candidate
   surface, **Then** it shows an empty state rather than an error or a
   misleading list.

---

### User Story 2 - Promote a shared component into a governed platform (Priority: P2)

As a catalog maintainer, I want to click "Create platform product from this
component" on a candidate and have Componode create the `PLATFORM` product,
wire its dependency on the component, and convert the consumers' dependency
edges into `CONSUMES_FROM` edges — so shared infrastructure becomes a managed
product with named consumers instead of N parallel wiring chores.

**Why this priority**: This is the flagship demonstration of the Composable
Product Model — "watch shared infrastructure become governed" (ADR-017
rationale). The ADR explicitly rejects shipping half a workflow, so promotion
includes the edge rewrite and the owner prompt as one guided action.

**Independent Test**: From a candidate with two depender products, run the
promotion flow — afterwards a `PLATFORM` product exists, it `DEPENDS_ON` the
component, and both consumers show `CONSUMES_FROM` the platform where they
previously `DEPENDS_ON` the component.

**Acceptance Scenarios**:

1. **Given** a candidate component, **When** I start the promotion flow,
   **Then** I am asked for the platform product's name (pre-filled from the
   component, editable) and prompted to assign an owner — a Team, a Line of
   Business, or skip.
2. **Given** a confirmed promotion, **When** it completes, **Then** a new
   `PLATFORM` product exists with a unique slug, the platform `DEPENDS_ON`
   the component, and the selected consumers' edges to the component have
   become `CONSUMES_FROM` edges to the platform.
3. **Given** a promotion dialog listing the component's active direct
   consumers, **When** I review it, **Then** every consumer is checked by
   default and I can uncheck any to leave their `DEPENDS_ON` edge in place.
4. **Given** a consumer I unchecked during promotion, **When** the flow
   completes, **Then** that product still shows `DEPENDS_ON` the component —
   and the component may remain a candidate if it still meets the threshold.
5. **Given** a confirmed promotion, **When** I view a rewritten consumer's
   detail page, **Then** the platform appears under "Consumes from" and the
   component no longer appears as a direct dependency of that product.
6. **Given** a confirmed promotion, **When** I view the platform's detail
   page, **Then** it shows `DEPENDS_ON` the component and a "Consumed by"
   list naming every rewritten consumer.
7. **Given** any step of the rewrite fails, **When** the transaction rolls
   back, **Then** the catalog is unchanged — no half-created product, no
   partially rewritten edges.
8. **Given** a completed promotion, **When** I view audit history, **Then**
   entries exist for the product creation and for every edge added and
   removed, attributed to the acting user.
9. **Given** the promotion completed and every consumer edge was rewritten,
   **When** I reopen the candidate list, **Then** the component no longer
   appears — its only remaining dependent is the new platform.
10. **Given** a consumer that also reaches the component through a group
    dependency edge, **When** promotion rewrites that consumer's direct edge,
    **Then** the group edge is untouched — the consumer still expands to the
    component via the group.

---

### User Story 3 - Promote a component on demand, not only from the worklist (Priority: P3)

As a catalog maintainer looking at a component's detail page, I want the
promotion action available there too — not only on the candidate list — so I
can govern a component I already know is shared machinery without waiting for
it to surface.

**Why this priority**: The ADR's guided flow starts from detection, but the
same bounded rewrite is useful wherever the user already knows the component is
shared. Lower priority because the candidate worklist (US1/US2) is the
ratified, demonstrated path; on-demand promotion is ergonomic reach.

**Independent Test**: From a component detail page for a component with two
dependers, trigger the same promotion flow and verify the identical resulting
graph as US2.

**Acceptance Scenarios**:

1. **Given** any component regardless of depender count, **When** I open its
   promotion action from the component's detail page, **Then** the same guided
   flow as US2 runs with the same consumer checklist and atomic rewrite
   semantics.
2. **Given** a component with no depender products, **When** promotion is
   confirmed, **Then** the platform is created with its `DEPENDS_ON` edge and
   zero consumers — a legal, if unusual, outcome.

## Edge Cases

- **Detection counts direct edges only.** A component reached by a product
  exclusively through a group edge (ADR-110) does not count that product
  toward the threshold — exactly the edges promotion can rewrite are the ones
  counted. A product reaching the component by both a direct edge and a group
  edge still counts once.
- **Group edges are never rewritten.** `CONSUMES_FROM` targets products, not
  components — a product→group edge covering the promoted component survives
  promotion unchanged. Only the direct product→component edges selected in
  the dialog are converted.
- **Retired participants are invisible to the workflow.** `RETIRED` products
  do not count as dependents, do not appear in the consumer checklist, and
  their edges are not rewritten; `RETIRED` components are not candidates and
  cannot be promoted.
- **Platform dependents count.** After promotion, the platform's own
  `DEPENDS_ON` edge makes it a dependent of the component like any other
  product — so a wrapped component that gains another direct consumer can
  resurface as a candidate. That is truthful signal (someone bypassed the
  platform), and repeat promotion remains legal per the assumptions.
- **Zero or unknown consumers at commit time.** If consumers changed between
  listing the candidate and confirming promotion (edges added or removed by
  another session), the rewrite applies to the consumers as they exist at
  commit time — the transaction is authoritative, the candidate list is a
  snapshot.
- **Name and slug collisions.** The pre-filled platform name derives from the
  component. A collision on a *derived* slug is resolved by a deterministic
  `-2`, `-3`… suffix rather than blocking the flow; an explicitly entered
  slug that collides is rejected (`409 SLUG_TAKEN`) like any product create.
- **Repeat promotion.** Nothing structurally prevents promoting the same
  component twice (creating a second `PLATFORM` depending on it); the UI may
  signal that a platform already wraps the component, but the action is not
  forbidden.
- **Owner is prompted, not mandatory.** Both ownership FKs are nullable
  (ADR-020); skipping the prompt creates an ownerless platform editable later.
- **Atomicity.** Product creation, the platform's `DEPENDS_ON` edge, and all
  edge rewrites commit in a single transaction or not at all.

## Requirements *(mandatory)*

### Functional Requirements

**Detection (ADR-017 step 1)**

- **FR-001**: The system MUST compute platform candidates: components with
  direct `DEPENDS_ON` edges from ≥2 distinct active products. Group-expanded
  reach (ADR-110) does not count toward the threshold; `PLATFORM`-type
  products count as dependents like any other.
- **FR-002**: Candidate results MUST carry, per component, the depender count
  and the identity of the depending products, and MUST exclude `RETIRED`
  components and `RETIRED` products entirely.
- **FR-003**: The candidate surface MUST be reachable from the dashboard
  (the improvement plan calls for a dashboard card) and MUST let the user
  inspect which products depend on each candidate before promoting.

**Promotion (ADR-017 steps 2–3)**

- **FR-004**: The promotion flow MUST create a `DigitalProduct` of type
  `PLATFORM`, pre-filling its name and slug from the source component with
  both editable before confirm; a collision on the derived slug is resolved
  by a deterministic suffix, while a user-entered slug collision is rejected
  (`409 SLUG_TAKEN`).
- **FR-005**: The promotion flow MUST wire `DEPENDS_ON` from the new platform
  product to the source component.
- **FR-006**: The promotion flow MUST present the component's active direct
  consumers as a checklist with all selected by default, and MUST convert the
  selected consumers' `DEPENDS_ON` edges on the component into
  `CONSUMES_FROM` edges targeting the new platform — in a single transaction
  with the product creation and the new `DEPENDS_ON` edge: any failure rolls
  back everything.
- **FR-007**: A consumer the user deselected — or a consumer reaching the
  component only via a group edge — MUST be left untouched; group edges and
  `COMPOSES`/`CONSUMES_FROM` edges are never modified by promotion.
- **FR-008**: The promotion flow MUST prompt for an owner — Team or Line of
  Business — while permitting the user to skip; the resulting platform's owner
  fields remain editable afterward like any product.
- **FR-009**: Promotion MUST write audit entries for the product creation and
  for every edge added and removed, following existing edge-audit
  conventions (ADR-052).
- **FR-010**: After promotion, candidate detection MUST reflect the new graph
  — a component whose only remaining depender is the wrapping platform drops
  below the threshold and off the list.

**Entry points**

- **FR-011**: The promotion action MUST be available from the candidate
  surface and from every non-`RETIRED` component's detail page, with no
  depender-count floor — promoting a component with zero consumers creates a
  consumerless `PLATFORM` wired to it.

**Cross-cutting**

- **FR-012**: Permission model is unchanged — detection reads are available
  to any authenticated role; the promotion write requires the existing
  product-creation and edge add/remove permissions (EDITOR+) per ADR-097.
- **FR-013**: `docs/openapi.yaml` MUST be updated in the same change for every
  added/modified endpoint (ADR-104), and `docs/digital-products.md` MUST be
  updated so its workflow description matches implemented behavior.
- **FR-014**: The change MUST NOT alter importer behavior, the importer
  contract, or component semantics — the workflow is entirely within the
  curated meaning layer (constitution V).

### Key Entities

- **Platform candidate**: a derived, read-only projection — a `Component`
  plus its qualifying depender products and count. Never stored; computed
  per read from current edges.
- **DigitalProduct (PLATFORM)**: the governed wrapper created by promotion;
  `DEPENDS_ON` the source component, consumed by the rewritten consumers,
  owned by a prompted Team and/or Line of Business.
- **DEPENDS_ON edge**: product→component (or product→group, ADR-110). Direct
  component edges are the ones converted during promotion; group edges are
  untouched.
- **CONSUMES_FROM edge**: product→`PLATFORM` product (ADR-018). The edge the
  consumers' `DEPENDS_ON` edges become.
- **Owner**: `Team` and/or `LineOfBusiness` on the platform product (ADR-020);
  prompted during the workflow, nullable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every component meeting the depender threshold appears in the
  candidate surface with an accurate depender list — zero false positives
  for below-threshold components and zero false negatives for qualifying
  ones, across all edge-kind combinations in the counting rule.
- **SC-002**: Governing a shared component takes one guided action instead of
  N edge edits plus a product creation: for a component with N consumers, the
  resulting graph shows exactly 1 new `PLATFORM` product, 1 platform
  `DEPENDS_ON` edge, and N `CONSUMES_FROM` edges where N direct `DEPENDS_ON`
  edges previously existed (for the consumers in scope).
- **SC-003**: A failed promotion leaves the catalog unchanged — 0 partial
  products, 0 partial edge rewrites, verified by state comparison across
  induced failures.
- **SC-004**: A user can complete detection → promotion → owner assignment in
  under 2 minutes for a typical candidate.
- **SC-005**: 100% of promotions leave an auditable trail: product creation
  plus one entry per edge added and removed, attributed to the acting user.
- **SC-006**: A promoted component that was fully migrated no longer appears
  as a candidate — the worklist reflects the new graph without manual
  refresh beyond a normal reload.

## Assumptions

- The depender threshold is exactly ≥2 products, per improvement plan item
  0.3 — no configuration knob in v1.
- Candidate detection is a read-time projection with no persisted state and
  no "dismiss candidate" affordance; a persistent dismissal queue belongs to
  a later feature if users ask for it.
- Retired entities are excluded from counting, listing, and rewriting,
  consistent with default-query conventions.
- Promotion applies the rewrite to the consumer set as it exists at commit
  time; no optimistic-lock or confirmation-token dance beyond the existing
  write conventions.
- The promotion dialog pre-fills name/slug from the component and allows
  editing description and other product fields only to the same extent the
  standard product-create form does.
- Audit, session, and RBAC conventions follow existing product/edge
  behavior; no new permissions or roles are introduced.
</content>
