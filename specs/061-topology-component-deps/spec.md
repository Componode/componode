# Feature Specification: Component dependencies in Product topology

**Feature Branch**: `061-topology-component-deps`

**Created**: 2026-11-03

**Status**: Shipped

**Input**: User-reported defect against spec 059: a Product whose only relations are direct `DEPENDS_ON` Component edges renders an empty Product topology ("No relationships yet — this product composes, consumes, or depends on nothing"), which is factually wrong and hides the product's real blast radius. UX decision: surface direct Component dependencies as topology nodes in a dedicated "Depends on components" lane, amending spec 059 FR-004 / ADR-127 Amendment 1 which excluded individual Components from the canvas.

## User Scenarios & Testing

### User Story 1 — See direct Component dependencies in the topology (Priority: P1)

A curator opens a Digital Product's Dependencies tab and sees the product's direct Component `DEPENDS_ON` targets rendered as typed nodes alongside the existing product and ComponentGroup lanes. A product whose only relations are Component dependencies renders a populated map instead of a false "No relationships yet" empty state.

**Why this priority**: The most common product shape in a young catalog is a product with only Component dependencies. Today those products show an empty map, making the headline Dependencies feature a false negative for exactly the products that need it most.

**Independent Test**: Open a Product fixture with two direct Component `DEPENDS_ON` edges and no product/group relations. Verify both Components appear in a "Depends on components" lane with correct direction, and the empty state does not render.

**Acceptance Scenarios**:

1. **Given** a Product with direct `DEPENDS_ON` Component edges, **When** the topology renders, **Then** those Components appear as nodes in a "Depends on components" lane on the outgoing (dependency) side with direction-preserving arrows and accessible text.
2. **Given** a Product whose only relations are Component dependencies, **When** the topology renders, **Then** the map shows the lane and nodes rather than the empty state.
3. **Given** a Product with Component dependencies plus product and ComponentGroup relations, **When** the topology renders, **Then** all relation families render in their own lanes without duplication.
4. **Given** a Product depends on a ComponentGroup containing Component X and has no direct edge to X, **When** the topology renders, **Then** X does not appear as a Component node — only the group node represents that path.
5. **Given** the same Component is reachable via a direct edge and through a depended group, **When** the topology renders, **Then** the Component node appears in the components lane and the group node appears in the groups lane; each represents its own authored edge.

### User Story 2 — Inspect a Component node (Priority: P1)

A curator selects a Component node to see its operational status and relation context, then can open that Component's detail page. Missing operational data is shown as no data, not fabricated health.

**Why this priority**: The map exists for incident triage — "what does a failure here touch". A Component node without its operational status or a navigation path fails that job.

**Independent Test**: Select a Component node with a failing instance, one with healthy instances, and one with no instances. Verify the status dot, accessible name, inspection panel, and navigation target each behave correctly.

**Acceptance Scenarios**:

1. **Given** a Component node, **When** a user selects it, **Then** an inspection panel shows its name, that it is a Component dependency, its derived operational status or no-data state, and an Open component action.
2. **Given** a Component with no non-`GONE` instances or no status data, **When** the node or panel renders, **Then** it shows no data rather than a fabricated status.
3. **Given** a retired Component dependency target, **When** the detail read returns it, **Then** its lifecycle is labeled rather than silently dropped.
4. **Given** keyboard-only use, **When** the user tabs to a Component node and activates it with Enter or Space, **Then** the node is selected, the relation is announced, and Escape clears the selection.
5. **Given** a components lane with more than four nodes, **When** the user activates `+N`, **Then** the remaining nodes appear and edges redraw without changing data.

### User Story 3 — Honest empty and copy states (Priority: P2)

A curator never reads copy that misrepresents the product's relations. The empty state only appears when the product has no relations of any kind, and the card's language distinguishes Product-to-Component dependencies from product and group relations.

**Why this priority**: The current copy — "this product composes, consumes, or depends on nothing" — is false for any product with Component dependencies and violates the domain-language rule. Honest copy is required whether or not a lane is populated.

**Independent Test**: Render the card for (a) a product with zero relations of any kind and (b) verify the empty-state and card-description copy names the relation kinds the topology covers accurately.

**Acceptance Scenarios**:

1. **Given** a Product with no relations of any kind, **When** the Dependencies tab renders, **Then** an empty state explains there are no relationships and the existing authoring controls remain available.
2. **Given** the card description and empty-state copy, **When** a reader parses it, **Then** the copy distinguishes composition, platform consumption, Component dependencies, and ComponentGroup dependencies — it does not conflate them into "depends on nothing".
3. **Given** a relation family is unavailable in the read response, **When** the topology renders, **Then** the partial warning still identifies the missing family and remaining lanes render.

### Edge Cases

- A Component dependency target may be `RETIRED`; the node is labeled, not dropped.
- A Component may have no instances; its status remains no-data.
- A Component may appear both as a direct dependency and via a group; provenance stays distinct per spec-060 attribution rules — no silent deduplication of different authored edges.
- Component dependencies declared on the product are topology nodes; components inherited through `COMPOSES` children are not this product's dependencies and MUST NOT appear.
- A product may have many direct Component dependencies; only the first four are shown before `+N` expansion.
- The Components tab remains the inventory surface (sort/filter/manage); the map adds position and status context, not authoring.

## Requirements

### Functional Requirements

- **FR-001**: The Product topology MUST include a "Depends on components" lane rendering the product's direct Product-to-Component `DEPENDS_ON` targets as typed nodes on the outgoing side.
- **FR-002**: A Component node MUST show its name and derived operational status (worst status across its non-`GONE` ComponentInstances), or no-data when no status exists. `GONE` MUST NOT be presented as Component health.
- **FR-003**: Only direct `DEPENDS_ON` Component edges render as Component nodes. Components reachable solely through a depended ComponentGroup, and components inherited through `COMPOSES` descendants, MUST NOT appear as nodes.
- **FR-004**: The components lane MUST reuse the existing lane mechanics: at most four nodes before local `+N` expansion, keyboard-operable nodes with accessible names carrying entity name and relation/status context, selection announcement, Escape recovery, and deterministic ordering.
- **FR-005**: Selecting a Component node MUST open an inspection panel with its name, Component-dependency context, operational status or no-data, and an Open component navigation action to the Component detail page.
- **FR-006**: The empty state MUST only render when the product has no relations of any kind; its copy MUST NOT claim the product "depends on nothing" while Component dependencies exist.
- **FR-007**: Card description and related copy MUST distinguish `COMPOSES`, `CONSUMES_FROM`, Product-to-Component dependencies, and ComponentGroup dependencies per domain vocabulary.
- **FR-008**: The feature MUST NOT add per-node or new endpoint reads; Component dependency and status data MUST come from the existing product detail read and already-fetched catalog/instance data.
- **FR-009**: The view MUST remain read-only; selecting, expanding, or inspecting a Component node produces no catalog writes.
- **FR-010**: The change MUST record its governance: an amendment to ADR-127 superseding the component-exclusion refinement, and `docs/ux.md` topology notes updated in the same change.

### Key Entities

- **DigitalProduct**: The focused product whose direct Component dependencies become topology nodes.
- **Component dependency**: A Product-owned `DEPENDS_ON` relation to a Component; only direct edges — not group-mediated or `COMPOSES`-inherited paths — produce nodes.
- **Component**: The dependency target; carries lifecycle and derived operational status from its ComponentInstances.
- **ComponentGroup dependency**: Unchanged; group-mediated member paths remain attributed to the group node, not expanded into Component nodes.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of direct `DEPENDS_ON` Component targets returned by the detail read appear as topology nodes.
- **SC-002**: 0 false empty states: no product with existing Component dependencies ever sees "No relationships yet" or copy claiming it depends on nothing.
- **SC-003**: 0 group-mediated or `COMPOSES`-inherited components appear as Component nodes.
- **SC-004**: Users can reach, select, inspect, and Escape-clear every Component node with keyboard alone.
- **SC-005**: Rendering the lane issues no additional requests and mutates no catalog state.

## Assumptions

- The existing product detail read and catalog/instance queries already carry the needed Component dependency and status data; no API contract change is required.
- The Components tab remains the inventory and management surface; the map intentionally re-shows direct dependencies in relationship context.
- The spec-060 Component Relationships view is unaffected; this change is scoped to the product-side topology.
- Spec 059's other topology rules (lane cap, direction semantics, accessibility, responsive, reduced-motion) remain binding.
