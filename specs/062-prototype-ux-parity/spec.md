# Feature Specification: Prototype UX parity polish

**Feature Branch**: `062-prototype-ux-parity`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Address the auth-grid regression and map discoverability first, then revisit typography and add real, data-backed context cues. I want the same font, UX disposition-style, headers, pills, and canvas as the prototype."

## User Scenarios & Testing

### User Story 1 - Experience the prototype's visual identity end to end (Priority: P1)

A user moves between sign-in, registration, the shell, dashboard, catalog lists, detail pages, and settings and sees one coherent visual system: the same typeface, page disposition, surface treatment, header treatment, badge/pill styling, and canvas patterns as the approved prototype. Unauthenticated pages receive the same finished treatment rather than appearing like an unfinished shell.

**Why this priority**: These surfaces form the user's first and most repeated impression of Componode; inconsistent typography or missing canvas treatment reads as a regression from the approved design.

**Independent Test**: Walk the public auth screens and representative routes in each major navigation group in light and dark themes. Compare visual identity, page anatomy, controls, status chips, and backdrop treatment against the prototype without needing to authenticate or modify catalog data.

**Acceptance Scenarios**:

1. **Given** the sign-in or registration page, **When** it renders on a desktop viewport, **Then** the split-screen showcase uses the prototype's canvas treatment, typography, spacing, and status presentation rather than a missing or unstyled backdrop.
2. **Given** an authenticated route outside the shell or a public auth route, **When** the page loads, **Then** it still receives the same visual identity as in-shell pages rather than relying on a stylesheet imported only by one layout.
3. **Given** any representative list, detail, settings, and dashboard route in light or dark mode, **When** the page renders, **Then** typography, headers, badges/pills, surfaces, and page disposition are visually indistinguishable from the approved prototype conventions except where real product rules intentionally differ.
4. **Given** reduced-motion, high-contrast, or keyboard-only usage, **When** the visual parity treatment renders, **Then** the existing accessibility behavior remains intact.

---

### User Story 2 - Find and inspect the Product Map directly (Priority: P1)

A curator opens a Product and finds a dedicated, clearly named map surface instead of inferring that the topology lives inside Dependencies. The map keeps all of the currently supported relation types and read-only inspection behavior while dependency authoring remains separate and discoverable.

**Why this priority**: The Product Map carries the Composable Product Model in the UI; hiding it behind an abstract Dependencies label weakens the main mental model users came for.

**Independent Test**: Open Product details with `?tab=map`, then switch between Overview, Map, Components, Dependencies, and Activity. Verify the topology is visible and complete on Map, and that dependency controls remain usable on Dependencies.

**Acceptance Scenarios**:

1. **Given** a Product detail page, **When** it loads, **Then** a dedicated Map tab is visible in the tab bar with placement equivalent to the prototype's first-level Map affordance.
2. **Given** a direct link containing `?tab=map`, **When** the Product detail resolves, **Then** the user lands on the Map tab rather than being redirected to Dependencies.
3. **Given** a Product with Product, ComponentGroup, and direct Component dependency relations, **When** the Map tab renders, **Then** all relation families remain visible with the existing direction, status, inspection, keyboard, expansion, and empty-state behavior.
4. **Given** a Product with no relations, **When** the Map tab renders, **Then** the user sees a clear read-only empty state rather than an accidental authoring or error view.
5. **Given** a user on Dependencies, **When** relation lists or edge-authoring controls are used, **Then** they remain available without requiring the topology to occupy the same tab as the authoring controls.

---

### User Story 3 - Trust navigation and header context as real signals (Priority: P2)

An operator can see contextual cues in the shell, such as queue counts and deployment identity, but only when those cues come from real state available to the application. The prototype's richer shell disposition is restored without reviving mock badges, simulated workspace names, or controls that do nothing.

**Why this priority**: The prototype feels more alive because context is visible; shipping invented labels or dead controls would trade clarity for correctness.

**Independent Test**: Compare shell cues across signed-in roles and different live data states. Verify every visible count or label is backed by current data and every header control has a real destination or behavior.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** the shell renders, **Then** navigation section grouping, ordering, icons, and active treatment match the prototype disposition.
2. **Given** live queue or fleet data, **When** relevant navigation items render, **Then** count badges show current values rather than prototype fixture values.
3. **Given** data for a contextual cue is unavailable or still loading, **When** the shell renders, **Then** the cue is omitted or shows an explicit no-data state rather than a fabricated value.
4. **Given** the prototype's header controls, **When** the implemented header renders, **Then** the same control density and disposition are used only for controls that have real behavior; notifications, simulated environments, or role previews remain absent until supported.

---

### Edge Cases

- Font or visual assets fail to load; the interface must remain readable through an equivalent fallback rather than rendering missing glyphs.
- Dark mode, compact density, reduced motion, and system color preferences must preserve the prototype identity without broken contrast or decoration.
- Narrow supported viewports around 768px must keep the shell, header, tabs, and map usable without clipped primary actions.
- Live context cues can be zero, empty, loading, or unavailable; they must not show stale prototype fixture values.
- Legacy deep links to `?tab=map`, `?tab=dependencies`, and unknown tab names must resolve predictably without blank tab panels.
- A Product may have many related nodes, missing health, retired related records, or only direct Component dependencies; the map must remain readable and truthful.
- Auth pages must not imply SSO is available when the deployment does not configure it.
- No mock workspace, notification count, role preview, environment name, or help action may be shown unless backed by real behavior.

## Requirements

### Functional Requirements

- **FR-001**: Every public auth screen and every authenticated route MUST receive the prototype's visual identity, including its typeface, surface tokens, page disposition, canvas/backdrop treatment, header treatment, and badge/pill presentation.
- **FR-002**: Shared visual assets and tokens required by auth and application routes MUST be loaded independently of the authenticated shell layout so public routes cannot silently lose prototype styling.
- **FR-003**: The application shell MUST use the prototype's navigation grouping, ordering, active-state treatment, iconography, and header disposition while continuing to hide role-restricted destinations from users without access.
- **FR-004**: Product detail MUST expose a dedicated Map tab whose label and placement make the topology discoverable at first glance.
- **FR-005**: `?tab=map` MUST resolve to the dedicated Map tab, and unknown or retired tab names MUST continue to use the existing safe fallback rules.
- **FR-006**: The dedicated Map MUST render all currently supported Product topology relations, including Product relations, ComponentGroup dependencies, and direct Component dependencies, while retaining existing direction semantics, status treatment, bounded data reads, read-only inspection, keyboard behavior, `+N` expansion, and empty states.
- **FR-007**: The Dependencies tab MUST continue to expose dependency lists and authorized relation-authoring controls; restoring a Map tab MUST NOT remove or break those workflows.
- **FR-008**: Navigation or header count badges and contextual labels MUST be populated only from live application state. Prototype fixture counts, fictional workspace names, simulated environments, and role-preview controls MUST NOT ship.
- **FR-009**: A visual control MUST render only when it has real behavior or a real destination. Prototype elements that have no backend or documented destination MUST remain omitted or be represented by an explicit governed gap.
- **FR-010**: Visual parity changes MUST preserve the documented loading, empty, error, forbidden, and not-found state matrix and MUST NOT introduce hardcoded colors or status labels.
- **FR-011**: The UX/UI reference MUST be updated in the same change to reflect the parity baseline, and any change that alters a ratified UX decision MUST update the affected ADR with an amendment and back-pointer.
- **FR-012**: Visual and interaction changes MUST remain usable at the supported desktop widths, in dark and light themes, with compact density, reduced motion, and keyboard-only operation.
- **FR-013**: No API or data contract change is required solely to create this visual parity; live context cues may reuse only already-available read data unless a later contract change is separately ratified.

### Key Entities

- **DigitalProduct**: The entity whose Product detail page exposes the dedicated Map and dependency surfaces.
- **Product topology relation**: A read-only, directed Product, ComponentGroup, or direct Component relation presented in the Map.
- **Context cue**: A live count, identity, or environment signal displayed in navigation or header chrome only when backed by real application state.
- **Visual identity surface**: A shared set of typography, canvas, header, pill, spacing, and state conventions applied consistently to public auth routes and authenticated routes.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of public auth and representative authenticated routes render the prototype's typography, page disposition, canvas treatment, header, and badge/pill conventions in both light and dark themes.
- **SC-002**: The implemented sign-in showcase has a rendered canvas backdrop; a computed or visual check confirms the grid/canvas treatment is present rather than `none`.
- **SC-003**: `?tab=map` opens the dedicated Map tab in 100% of tested Product detail links, and all currently supported topology relation families render without regression.
- **SC-004**: Dependencies retains 100% of its existing relation lists and edge-authoring actions after the Map tab is restored.
- **SC-005**: 100% of visible shell badges or contextual labels are backed by live data; no prototype fixture count or fictional environment/workspace label appears.
- **SC-006**: A keyboard-only user can navigate the shell, Product detail tabs, Map nodes, and dependency controls without losing access to any existing action.
- **SC-007**: At 768px and 1280px viewport widths, no primary navigation, tab, header action, or map control is clipped by overflow.
- **SC-008**: No dead navigation or header control is introduced; every visible control has a real destination or behavior.

## Assumptions

- The approved prototype remains the visual source of truth for visual identity; the current backend remains the source of truth for data and behavior.
- "Same font" means the prototype's typeface and equivalent fallback behavior, not necessarily the same runtime font delivery mechanism.
- "UX disposition" means layout hierarchy, spacing, density, grouping, and visual emphasis, not a new information architecture beyond the dedicated Map tab.
- Header and navigation cues are restored only where the API or session already supplies truthful values; unsupported prototype decorations stay out of scope.
- The dedicated Map is read-only; existing edge authoring remains in Dependencies.
- The change is UI and documentation governance only; it does not add a multi-tenant workspace concept, notification backend, role preview, or new product relation type.
