# Feature Specification: Read-only Component Relationships

**Feature Branch**: `060-component-relationships`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User-confirmed direction from `researches/web_api_product_map_component_relationships_research.md` and ADR-128. Add a read-only, one-hop Component Relationships tab that reuses the Product Map's visual/accessibility patterns while preserving typed Component, Product, ComponentGroup, and ComponentInstance semantics.

## User Scenarios & Testing

### User Story 1 — Understand a Component's typed relationships (Priority: P1)

A curator opens a Component's Relationships tab and sees which other Components it depends on, which Components depend on it, which repositories it sources from, and which API Components it exposes. Relation direction and type are understandable without relying on position alone.

**Why this priority**: The Component catalog stores typed Component relationships, but the current detail page has no surface for discovering them.

**Independent Test**: Seed one Component with outgoing and incoming `DEPENDS_ON`, `SOURCES_FROM`, and `EXPOSES` relations. Open its Relationships tab and verify every relation is shown in the correct typed lane, with accurate direction and navigation.

**Acceptance Scenarios**:

1. **Given** a Component with outgoing `DEPENDS_ON` relationships, **When** the Relationships tab opens, **Then** its targets appear in “Depends on”.
2. **Given** other Components depend on the focused Component, **When** the Relationships tab opens, **Then** those sources appear in “Depended on by”.
3. **Given** the focused Component sources from a repository or exposes an API, **When** the tab renders, **Then** the repository/API target appears in its correct lane.
4. **Given** a Component-to-Component relationship has a retired endpoint, **When** the detail read returns it under its existing visibility policy, **Then** the endpoint's lifecycle is visible and the relation is not relabeled as another type.
5. **Given** no Component-to-Component relation rows exist, **When** the tab renders, **Then** each typed lane has an honest empty state and no relationship is inferred from names or importer metadata.

### User Story 2 — See Products that depend on a Component (Priority: P1)

A curator sees which DigitalProducts depend directly on the focused Component and which reach it through a ComponentGroup. Group-mediated paths are explicitly labeled “via [ComponentGroup]” and are not represented as direct Product-to-Component edges.

**Why this priority**: Product dependencies are authored on DigitalProducts, but a Component operator needs the reverse view to understand business impact.

**Independent Test**: Seed a direct Product dependency, a Product-to-ComponentGroup dependency whose group contains the Component, and an unrelated Product. Verify direct and group-mediated dependents are distinguished and the unrelated Product is absent.

**Acceptance Scenarios**:

1. **Given** a DigitalProduct has a direct `DEPENDS_ON` edge to the Component, **When** the tab renders, **Then** the Product appears under direct dependents.
2. **Given** a DigitalProduct depends on a ComponentGroup that contains the Component, **When** the tab renders, **Then** the Product appears with an explicit “via [ComponentGroup]” attribution.
3. **Given** the same Product reaches the Component directly and through a group, **When** the tab renders, **Then** the Product is not silently duplicated and both provenance paths remain inspectable.
4. **Given** a ComponentGroup has no members, **When** a Product depends on that group, **Then** the empty group does not create a false direct Product-to-Component relation.

### User Story 3 — Relate a Component to its operational instances (Priority: P2)

A curator can understand which ComponentInstances belong to the focused Component and inspect their environment and current operational status from the Relationships tab. The existing Overview Instances table remains available; the nested instance view is an intentional second presentation for relationship context.

**Why this priority**: A Component's relationships describe logical neighbors, while its ComponentInstances show where that Component occurs operationally.

**Independent Test**: Open a Component with DEV, STAGING, and PRODUCTION instances. Verify they appear nested under the focused Component with environment/status, `GONE` instances follow the existing explicit-include behavior, and the Overview Instances table remains unchanged.

**Acceptance Scenarios**:

1. **Given** a Component with multiple ComponentInstances, **When** the Relationships tab renders, **Then** instances appear as nested children, not peer Component/ Product nodes.
2. **Given** an actively monitored instance, **When** the instance node renders, **Then** its current `ComponentInstance.status` is shown using the existing status metadata; URL Check history remains a separate detail surface.
3. **Given** a `GONE` instance that is excluded by default, **When** the Relationships tab renders, **Then** it is absent unless the caller explicitly requests gone instances.
4. **Given** the user opens the Overview tab, **When** the Component detail renders, **Then** the existing Instances table and read-only URL Check summary remain available.

### User Story 4 — Navigate Component relationships accessibly (Priority: P1)

A curator can inspect direct Component relationships and Product dependents with keyboard controls and progressive disclosure. The view remains deterministic and does not become an editor.

**Why this priority**: A data-heavy relationship view is only useful if operators can navigate it at supported sizes and assistive technologies can understand every relation.

**Independent Test**: Use keyboard-only navigation at 1280px and 768px to focus a related node, expand `+N`, inspect a relation, clear focus with Escape, and open an entity detail.

**Acceptance Scenarios**:

1. **Given** a rendered relationship lane, **When** a user presses Tab, **Then** every visible node is reachable in deterministic order.
2. **Given** a focused node, **When** the user activates it with Enter or Space, **Then** the node and directly related path are emphasized and its inspection details open.
3. **Given** the user presses Escape or activates empty canvas, **When** focus mode is active, **Then** focus clears without changing data.
4. **Given** a lane with more than four nodes, **When** the user activates `+N`, **Then** the remaining nodes appear without changing relation data.
5. **Given** a 768px viewport or reduced-motion preference, **When** the view renders or changes focus, **Then** it has no horizontal overflow and does not rely on motion to convey relation state.

### Edge Cases

- Component `DEPENDS_ON` relations may form cycles; the one-hop view must not assume a DAG.
- One Component may have both outgoing and incoming relations of the same type.
- A Product may reach the Component through both a direct edge and a ComponentGroup; provenance remains distinct without duplicating the Product node.
- Component-to-Component tables may contain no rows because the current v1 application has no writer; empty states are expected, not failures.
- A relation target may be missing, retired, or hidden by current default visibility; the read response and view must not fabricate a replacement node.
- A Component may have no non-GONE instances; the relationship lanes remain usable and the instance area shows an empty state.
- The read-only view does not show create/edit/delete relationship actions.
- URL Check observations and current ComponentInstance status are not represented as the same object; status follows ADR-126 and check history remains separate.

## Requirements

### Functional Requirements

- **FR-001**: Component detail MUST have a distinct Relationships tab. The existing Overview Instances table and read-only URL Check summary MUST remain available.
- **FR-002**: The view MUST present typed Component-to-Component relations: `DEPENDS_ON` in both directions, `SOURCES_FROM`, and `EXPOSES`, with explicit source/target semantics.
- **FR-003**: The view MUST show DigitalProducts with direct `DEPENDS_ON` edges to the Component.
- **FR-004**: The view MUST show Product dependencies through a ComponentGroup with “via [ComponentGroup]” attribution; it MUST NOT label those as direct Component edges.
- **FR-005**: The view MUST show ComponentInstances as nested children of the focused Component, not as peer graph nodes. It MUST use the existing default visibility behavior for `GONE` instances.
- **FR-006**: The view MUST read existing typed relationship rows and MUST NOT infer or automatically create Component-to-Component edges.
- **FR-007**: The backend read contract MUST preserve each relation type and direction, direct/group Product provenance, and existing ComponentInstance association.
- **FR-008**: The view MUST use a deterministic one-hop layout with up to four visible nodes per lane and `+N` local expansion. It MUST NOT provide pan, zoom, drag, manual layout, or relationship authoring.
- **FR-009**: Every node MUST be keyboard-operable and have an accessible name that communicates entity name and relation/status context. Focus changes MUST be announced; Escape MUST clear focus.
- **FR-010**: Loading, empty, error, forbidden, and partial relation states MUST be explicit. Missing Component-to-Component rows MUST display an honest empty state.
- **FR-011**: The view MUST be usable at 768px without horizontal overflow and MUST respect reduced-motion preferences and existing status/design tokens.
- **FR-012**: The view MUST be side-effect-free. It MUST NOT mutate Components, ComponentInstances, Products, ComponentGroups, URL Checks, or relationship rows.
- **FR-013**: The relationship read MUST be bounded and MUST NOT issue one request per rendered node.
- **FR-014**: User-facing text MUST distinguish Component-to-Component relations, Product dependencies, ComponentGroup membership, `HAS_INSTANCE`, and URL Check history.

### Key Entities

- **Component**: Focused building-block asset.
- **Component relationship**: A typed directed relation between Components: `DEPENDS_ON`, `SOURCES_FROM`, or `EXPOSES`.
- **DigitalProduct dependency**: A Product-owned `DEPENDS_ON` relation to a Component or ComponentGroup.
- **ComponentGroup**: Human-declared equivalence group; a Product dependency through a group is attributed, not converted to a direct edge.
- **ComponentInstance**: Operational occurrence of the focused Component; displayed as a nested child with its environment/current status.
- **URL Check**: Monitoring record attached to an instance; its observations/history remain separate from relationship topology.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of stored Component-to-Component relation types returned by the read contract appear in the correct typed lane.
- **SC-002**: 100% of direct and group-mediated Product dependents in the fixture are displayed with correct provenance.
- **SC-003**: Users can reach and operate all visible nodes, `+N` controls, inspection details, and Escape recovery with keyboard alone.
- **SC-004**: At 768px viewport width, no relationship lane or control is clipped by horizontal overflow.
- **SC-005**: The view performs a bounded read regardless of rendered relation count and emits no catalog writes.
- **SC-006**: In a catalog with no Component-to-Component edge rows, the tab renders an honest empty state while still displaying Product/instance relationships.

## Assumptions

- Component-to-Component relationship authoring and importer-declared edge ingestion remain out of scope. Stored rows may be populated by future or external administration paths.
- The new read route is authenticated and side-effect-free; it extends read access only.
- Product dependency data is read from the existing Product-to-Component and Product-to-ComponentGroup relations.
- ComponentInstances remain part of Overview and are intentionally repeated as nested children in Relationships.
- The Product Map is not generalized into a shared graph module; only visual/accessibility patterns are reused.
- Current RBAC, URL safety, lifecycle filtering, and ComponentInstance status semantics remain binding.
