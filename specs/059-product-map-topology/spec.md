# Feature Specification: Product Map topology in Dependencies

**Feature Branch**: `059-product-map-topology`

**Created**: 2026-11-03

**Status**: Shipped

**Input**: User-confirmed direction from `researches/web_api_product_map_component_relationships_research.md` and ADR-127. Move the read-only Product Map topology to the top of Dependencies, preserve edge authoring below it, include all product relations and ComponentGroup targets, and make the view accessible and responsive.

## User Scenarios & Testing

### User Story 1 — Understand where a Product sits in its relationships (Priority: P1)

A curator opens a Digital Product's Dependencies tab and sees its immediate Product and ComponentGroup context without having to compare a separate Map tab with the authoring controls. The view makes it clear which Products compose this Product, which Products it composes, which platforms it consumes from, which Products consume it, and which ComponentGroups it depends on.

**Why this priority**: The map is useful only if it provides a complete and correctly directed view of the Product's place in the Composable Product Model.

**Independent Test**: Open a Product fixture with `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and `dependsOnGroups` populated. Verify every relation appears in the topology with correct source/target direction, and verify the existing edge-authoring/list controls remain available below it.

**Acceptance Scenarios**:

1. **Given** a Product with parent and child `COMPOSES` relations, **When** its Dependencies tab opens, **Then** parent and child Products appear on the correct sides with their actual relation direction.
2. **Given** a Product that consumes from a Platform and is consumed by another Product, **When** the topology renders, **Then** `consumesFrom` points from the focused Product to the Platform and `consumedBy` points from the consumer to the focused Product.
3. **Given** a Product that depends on a ComponentGroup, **When** the topology renders, **Then** the ComponentGroup appears as a typed dependency node, including when it has no members.
4. **Given** a Product with declared or inherited Component dependencies, **When** the user opens the Components tab, **Then** those Components remain visible in the existing list and are not duplicated as topology nodes.
5. **Given** a Product with no relations, **When** the Dependencies tab renders, **Then** an empty state explains that there are no relationships and the existing authoring controls remain available.
6. **Given** an existing `?tab=map` link, **When** the detail page resolves the tab, **Then** the user lands on Dependencies.

### User Story 2 — Inspect related Products without opening each page (Priority: P2)

A curator selects an immediate related Product to see its type, criticality, derived health, and Component count, then can open that Product's detail page. Missing health is shown as no data, not as a healthy or failing default.

**Why this priority**: Operators need enough context to understand the relation and decide whether to navigate to another Product.

**Independent Test**: Select related Products with healthy, failing, and null health. Verify the inspection panel shows the correct domain labels, counts, no-data state, and navigation target.

**Acceptance Scenarios**:

1. **Given** a related Product, **When** a user selects its node, **Then** an inspection panel shows its name, Product type, criticality, derived health, Component count, and an Open Product action.
2. **Given** a related Product whose health is null, **When** the panel renders, **Then** it shows no data rather than a fabricated status.
3. **Given** the Product health state is `ERROR`, **When** a node status indicator renders, **Then** it uses the existing health/status token and an accessible text label.
4. **Given** the user activates Open Product, **When** navigation completes, **Then** the selected Product detail opens without changing catalog state.

### User Story 3 — Navigate the topology with keyboard and at supported viewport sizes (Priority: P1)

A curator can inspect relations without a mouse and can use the same topology on desktop and narrower supported viewports. Focus, selection, and overflow expansion help users follow relevant paths without turning the view into an editor.

**Why this priority**: The existing map cannot be traced reliably by keyboard and loses its connectors at narrower widths; both issues block core accessibility and usability.

**Independent Test**: Use keyboard-only navigation at 1280px and 768px widths. Select a node, expand `+N`, inspect the accessible announcement, clear focus with Escape, and verify no horizontal overflow.

**Acceptance Scenarios**:

1. **Given** a rendered topology, **When** a user presses Tab, **Then** every visible Product and ComponentGroup node is reachable in deterministic column order.
2. **Given** a focused node, **When** the user activates it with Enter or Space, **Then** the node and direct relation path receive focus treatment and the inspection panel opens.
3. **Given** a focused topology, **When** the user presses Escape or activates empty canvas, **Then** focus mode clears.
4. **Given** a relation lane with more than four nodes, **When** the user activates `+N`, **Then** the remaining nodes appear and the view reflows without changing data.
5. **Given** a 768px viewport, **When** Dependencies renders, **Then** topology and controls remain usable without horizontal overflow or hidden relations.
6. **Given** reduced-motion preference, **When** focus or expansion changes, **Then** the view does not animate edge draw-in or opacity transitions.

### Edge Cases

- A Product may appear on both sides of the focused Product through different relation types; each relation remains separately labeled and directed.
- A Platform may have no consumers, or a ComponentGroup dependency may have zero members; the node or empty state remains understandable.
- A Product may have no health data even when its relation list is populated.
- A Product may have many related nodes; only the first four per relation lane are shown before local `+N` expansion.
- If a relation family is unavailable in the read response, other families remain visible and an inline warning identifies the missing family.
- A retired related Product or ComponentGroup is not silently dropped if the detail read returns it; its lifecycle is labeled.
- The canvas does not expose pan, zoom, drag, manual layout, or edge-authoring actions.

## Requirements

### Functional Requirements

- **FR-001**: Product topology MUST appear at the top of the Dependencies tab. Existing edge-authoring and list controls MUST remain below it.
- **FR-002**: The dedicated Map tab MUST be removed. Unknown or legacy `?tab=map` links MUST resolve to Dependencies.
- **FR-003**: The topology MUST display `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and `dependsOnGroups`; declared/inherited Component dependencies MUST remain visible in the existing Components list. No relation returned by the Product detail read may be silently omitted.
- **FR-004**: ComponentGroups that are Product dependency targets MUST appear as typed nodes. Individual Components MUST remain in the Components list rather than becoming topology nodes.
- **FR-005**: Relation arrows and accessible descriptions MUST preserve actual source/target direction; layout position alone is not the relationship semantics.
- **FR-006**: The initial view MUST show at most four nodes per relation lane with local `+N` expansion. Traversal is one hop; no configurable multi-hop depth is provided.
- **FR-007**: Selecting a related Product MUST show its name, Product type, criticality, derived health, Component count, and an Open Product action. Null health MUST remain a no-data state.
- **FR-008**: Product node health MUST use ADR-112 derived Product health and the existing status tokens; it MUST NOT use ComponentInstance `GONE` as Product health.
- **FR-009**: Nodes MUST be keyboard-operable controls with accessible names that include the Product/ComponentGroup name and applicable status. Focus changes MUST be announced, Escape MUST clear focus, and relation meaning MUST be available without relying on SVG edges.
- **FR-010**: Loading, empty, error, forbidden, and partial relation states MUST be explicit. Partial data MUST identify the unavailable relation family.
- **FR-011**: The view MUST be usable at 768px without horizontal overflow and MUST respect reduced-motion preferences.
- **FR-012**: The topology MUST be read-only. Focus, selection, inspection, and expansion MUST NOT mutate catalog data; pan/zoom/drag/manual layout and edge authoring remain out of scope.
- **FR-013**: Related-Product health/count data MUST be available through a bounded read contract; rendering MUST NOT trigger one detail request per node.
- **FR-014**: User-facing copy MUST use Componode domain language and distinguish `COMPOSES`, `CONSUMES_FROM`, Product-to-Component dependencies, and ComponentGroup dependencies.

### Key Entities

- **DigitalProduct**: The focused or related Product, with its Product type, criticality, lifecycle, and derived health.
- **Product relation**: A directed `COMPOSES` or `CONSUMES_FROM` relation between Products.
- **ComponentGroup dependency**: A Product-to-ComponentGroup `DEPENDS_ON` relation, distinct from membership in the group.
- **Component summary**: Component dependency information available in the Components list below the topology, not a topology node.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of the five Product relation groups returned by the Product detail read are visible in the topology or its explicitly labeled relation summary.
- **SC-002**: In a fixture with both incoming and outgoing relations, 100% of edges point from the actual source to the actual target, including `consumedBy`.
- **SC-003**: Users can reach and operate every visible node, inspection panel, `+N` control, and Escape recovery with keyboard alone.
- **SC-004**: At 768px viewport width, no topology content or control is clipped by horizontal overflow.
- **SC-005**: Related Products with null health show no data; no Product health or Component count is fabricated.
- **SC-006**: The topology performs a bounded read for all displayed related-product details rather than one request per related node.
- **SC-007**: Focus, selection, expansion, and inspection produce no catalog writes.

## Assumptions

- The Product detail read remains the single entry point and is extended with related-Product detail fields.
- Related Product health follows ADR-112; the same direct-dependency scope and null semantics remain.
- ComponentGroups remain first-class dependency targets; individual Components continue to be browsed in their existing Components list.
- The topology is a compact operational overview, not an editor or multi-hop blast-radius analyzer.
- The existing UX baseline (WCAG 2.1 AA, tokenized state colors, desktop-first down to approximately 768px) remains binding.
