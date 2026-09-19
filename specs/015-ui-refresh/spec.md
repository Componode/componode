# Feature Specification: UI Refresh — Emerald Identity, Mobile Drawer, Faceted Filters, Run Chart

**Feature Branch**: `feature/015-ui-refresh`

**Created**: 2026-09-18

**Status**: Draft

**Input**: Ratified design decisions D1–D11 in
`researches/app_shell_layout_research.md` (SaaS shell audit + grilling
rounds 1–2). This is the feature half of the ratified packaging — the
bugfix half shipped as `014-bugfix-app-shell` (PR #42).

## Context

The current UI is functionally sound but visually generic: a blue accent
borrowed from the starter tokens, no brand identity, no faceted filtering
despite the backend already accepting multi-value filters, statuses rendered
as plain colored text, and navigation that crushes below 768px. This
feature lands the ratified visual language and the deferred mobile-drawer
exception, and upgrades enum filtering to the shadcn data-table convention.

Scope is documentation-visible: `docs/ux.md` §9 currently forbids mobile
work below 768px "except via a dedicated spec" — this is that spec, and it
ships **ADR-108** plus the §9 amendment ratifying the drawer-only exception.

## Affected Surface

- `packages/frontend/src/index.css` — theme tokens (palette, radius).
- `packages/frontend/src/components/layout/` — top bar (hamburger trigger),
  sidebar/nav (shared section source for the drawer).
- `packages/frontend/src/components/` — status badge, table pill
  treatments, filter controls, new drawer + combobox primitives.
- `packages/frontend/src/pages/` — every enum-filter surface (components
  filter bar, product type select, instance status), dashboard importer
  section (run-history chart).
- `researches/adrs/ADR-108-*.md` + `researches/architecture-decisions.md` —
  new ADR ratifying the drawer exception.
- `docs/ux.md` §9 — amendment citing ADR-108.

## User Scenarios & Testing

### User Story 1 — Emerald visual language (Priority: P1)

As a user, I want a distinct, coherent brand identity — a deep emerald
primary used consistently for actions, links, and focus — so the product
reads as a designed tool rather than a starter template.

**Why this priority**: This is the visible definition of the feature and
the substrate every other story renders on (pills, chart, drawer all take
the new tokens). Ratified D2/D3/D7/D11.

**Independent Test**: At 1440×900 in light and dark mode, every primary
action, link, and focus ring renders emerald; status indicators keep a
visibly different green; active nav stays neutral; no screen mixes the two
greens.

**Acceptance Scenarios**:

1. **Given** the new palette, **When** a user views any page, **Then**
   primary buttons/links/focus rings render deep emerald and hover a
   darker emerald, in both light and dark themes.
2. **Given** a status indicator and a brand action on the same screen,
   **When** compared, **Then** they are visibly different hues and
   different treatments (status = tinted pill/dot; brand = solid
   fill/link/ring) — never interchangeable.
3. **Given** rounded elements, **When** rendered, **Then** the corner
   radius reads as the updated `0.625rem` and nav/stat icons sit in icon
   wells; typography remains the system stack (no new webfont).
4. **Given** text and interactive elements in both themes, **When**
   measured, **Then** contrast meets WCAG 2.1 AA (4.5:1 text, 3:1
   non-text).

---

### User Story 2 — Faceted filters with removable pills (Priority: P2)

As a catalog user, I want to filter lists by any combination of facet
values — including component groups — with my active filters visible as
removable pills, so I can narrow dense tables without retyping queries.

**Why this priority**: The backend already accepts multi-value filters;
the frontend exposes only free-text controls. This is the largest
functional gap found in the audit and serves the primary desktop-first
audience (ratified D5/D8/D11).

**Independent Test**: On `/components`, select two categories and a
component group via facet controls, see the pills, remove one pill, and
watch the list re-filter — all without a page reload.

**Acceptance Scenarios**:

1. **Given** an enum-backed filter (category, provider, lifecycle,
   instance status, product type), **When** opened, **Then** it offers all
   core enum values as a multi-select drop-list, with a searchable
   combobox when the option list is long (component groups).
2. **Given** active facet selections, **When** rendered, **Then** they
   appear as removable pills inside the filter control (e.g.
   "Status: 2 selected"), capped with an overflow count, with a clear-all
   affordance.
3. **Given** filters applied, **When** the list renders, **Then** results
   match every selected value across facets; taxonomy pills shown in table
   cells are decorative only (not interactive, not links).
4. **Given** a combination with no matches, **When** rendered, **Then**
   the standard empty state appears with a clear-filters primary action.

---

### User Story 3 — Mobile drawer + keyboard shortcut (Priority: P3)

As a user on a viewport below ~768px, I want navigation reachable via an
off-canvas drawer so the app degrades gracefully instead of crushing the
content column.

**Why this priority**: Real usability gap on the degradation path — but
the product is desktop-first (ux.md §9), so it ranks below the identity
and filtering work that every session sees. Ratified D4/D9/D11.

**Independent Test**: At 390×844, a hamburger in the top bar opens a left
drawer containing the same grouped nav; every destination is reachable;
Escape/scrim/route-change closes it; the desktop sidebar and its collapse
behavior are untouched at ≥768px.

**Acceptance Scenarios**:

1. **Given** a viewport below `md`, **When** the user taps the hamburger
   (top bar, visible only below `md`), **Then** an off-canvas drawer
   slides in with the same grouped nav sections and admin gating.
2. **Given** the open drawer, **When** the user presses Escape, taps the
   scrim, or picks a destination, **Then** it closes and focus returns
   correctly (focus-trapped while open, aria-labeled).
3. **Given** `Ctrl+B`, **When** pressed anywhere, **Then** it toggles the
   desktop collapse above `md` and the drawer below `md`.
4. **Given** the drawer open, **When** the viewport crosses to ≥`md`,
   **Then** the drawer dismisses and the persistent sidebar resumes.
5. **Given** this spec ships, **Then** ADR-108 exists ratifying the
   drawer-only mobile exception and `docs/ux.md` §9 cites it.

---

### User Story 4 — Importer run-history chart (Priority: P4)

As an operator, I want a per-run stacked bar of processed/created/updated
assets so import health is readable at a glance.

**Why this priority**: Useful signal, smallest blast radius — one
visualization on an already-working section. Ratified D6; dashboard
donuts deliberately deferred to a separate dashboard spec.

**Independent Test**: On the dashboard importer section, a stacked bar
chart shows recent runs segmented by processed/created/updated with
accessible labels/tooltips; with zero runs it renders the standard empty
state.

**Acceptance Scenarios**:

1. **Given** importer run history, **When** the section renders, **Then**
   recent runs appear as a stacked bar per run (created + updated +
   processed-unchanged segments) with legend and values on hover/focus.
2. **Given** zero runs, **When** rendered, **Then** the standard empty
   state appears — no broken/blank chart.
3. **Given** the chart, **When** inspected for a11y, **Then** it exposes
   a text equivalent (table or aria summary) and both themes render
   legibly.

---

### Edge Cases

- Viewport crosses `md` while the drawer is open → drawer dismisses,
  desktop sidebar resumes (no stuck overlay).
- `Ctrl+B` while typing in an input → consistent with `Ctrl+K`: global,
  not suppressed.
- Dozens of selected facet values → pills cap with a "+N" overflow
  counter; never break the filter-bar layout.
- Component-groups list is long → combobox search, not an endless
  drop-list.
- Color-vision deficiency → status never relies on hue alone (dot +
  label text).
- Chart with a single run or all-zero counts → renders one bar / a
  zero-height series gracefully.
- Dark-mode emerald on dark backgrounds → the lighter dark-token is used
  so contrast holds (AA).

## Requirements

### Functional Requirements

- **FR-001**: The theme MUST adopt the deep-emerald brand palette: primary
  `hsl(163 94% 24%)` light / `hsl(158 64% 52%)` dark, hover
  `hsl(163 94% 20%)` — applied to primary actions, links, and focus rings.
- **FR-002**: Brand and status greens MUST be separated by hue and
  treatment — brand green only on solid fills/links/focus rings; status
  green (~142°) only on tinted pills and dots. Active navigation remains
  the neutral accent treatment.
- **FR-003**: Corner radius MUST update to `0.625rem` and nav/stat icons
  MUST render in icon wells; the type stack MUST remain the system font
  (no webfont added).
- **FR-004**: Every status rendering (tables, detail headers, dashboard)
  MUST use the dot + label treatment — one semantic convention.
- **FR-005**: Taxonomy/category pills in table cells MUST be decorative
  (non-interactive); facet pills MUST be removable.
- **FR-006**: Every enum-backed filter surface MUST become a faceted
  multi-select exposing all core enum values; component groups MUST be
  available as a facet with a searchable combobox; the implementation
  MUST inventory every existing enum filter surface and convert each.
- **FR-007**: Facet selections MUST render as pills inside the filter
  control with an overflow cap and a clear-all affordance; filtering MUST
  apply without a page reload and MUST NOT require API changes (the
  backend already accepts multi-value filters).
- **FR-008**: Below the `md` breakpoint, navigation MUST be an off-canvas
  left drawer presenting the same grouped sections (with admin gating),
  opened by a hamburger control in the top bar that is visible only below
  `md`; the desktop sidebar and collapse behavior MUST be unchanged.
- **FR-009**: The drawer MUST trap focus while open, close on
  Escape/scrim/navigation, label itself for assistive tech, and dismiss
  cleanly when the viewport crosses to ≥`md`.
- **FR-010**: `Ctrl+B` MUST toggle the sidebar (desktop) and the drawer
  (below `md`), consistent with the existing `Ctrl+K` global-shortcut
  convention.
- **FR-011**: The feature MUST ship ADR-108 ratifying the drawer-only
  mobile-navigation exception and MUST amend `docs/ux.md` §9 to cite it.
- **FR-012**: The dashboard importer section MUST render recent run
  history as a stacked bar per run segmented by
  processed/created/updated, with legend, values on hover/focus, a text
  equivalent, and a standard empty state for zero runs.
- **FR-013**: All new visual elements MUST meet WCAG 2.1 AA in both
  themes and MUST respect reduced-motion preferences for the drawer and
  chart transitions.

### Key Entities

No new data entities. Filter state derives from existing enum metadata
(`COMPONENT_CATEGORIES`, `COMPONENT_PROVIDERS`, `COMPONENT_LIFECYCLE`,
`INSTANCE_STATUS`, product types) plus the existing component-groups
endpoint; run history uses the existing importer-run data. No API,
schema, or permission changes.

## Success Criteria

### Measurable Outcomes

- **SC-001**: At 1440×900 in light and dark mode, 0 screens mix brand and
  status greens — every status uses the tinted-pill/dot treatment and
  every action/link/ring uses the brand emerald.
- **SC-002**: At 390×844, 100% of top-level destinations are reachable in
  ≤2 interactions via the drawer, which opens/closes with correct focus
  management.
- **SC-003**: A user can apply a multi-value facet filter (2+ values
  across 2+ facets) in ≤4 interactions and remove any single filter via
  its pill — no page reloads.
- **SC-004**: All text/interactive elements meet WCAG AA contrast in both
  themes (4.5:1 / 3:1) — including the new emerald tokens.
- **SC-005**: The run-history chart renders every recent run with correct
  segment values and legible labels in both themes; zero-run state
  verified.
- **SC-006**: No regression — the frontend suite passes with new coverage
  for the tri-state/drawer/filter logic, and the breakpoint matrix
  (1440/1280/768/390) shows no overlap, overflow, or pinned-chrome
  regressions introduced by the refresh.

## Out of Scope

- Dashboard donut charts and any dashboard redesign — deferred to a
  dedicated dashboard spec (ratified D6).
- Inter or any webfont — revisit post-refresh (ratified D7).
- Full mobile layout redesign — only the navigation drawer; other
  sub-768px layout stays as-is (ratified D4).
- Sidebar rail/inset/floating variants — not required for v1 (D11
  defaults).
- Pill-as-link semantics — rejected (D11); taxonomy pills stay
  decorative.
- Teal hue shift for the brand — a contingency only if brand/status
  greens still collide in practice (held from round 2).
- Any API, database, entity, or permission change — none required.

## Assumptions

- `014-bugfix-app-shell` (PR #42) merges first — the drawer, palette, and
  filter work build on the bounded shell and its tri-state collapse.
- The shadcn Sheet/Radix dialog primitive and `cmdk` are already
  available for the drawer and combobox patterns (or added under the
  existing dependency policy).
- Recharts is the chart library (ratified D6); installed under the normal
  dependency rules (`^` range, ≥7-day-old release).
- Desktop-first remains the product posture: the drawer is graceful
  degradation, not a mobile app (ux.md §9 + ADR-108).
- `Ctrl+B` follows the existing `Ctrl+K` convention (global, works in
  inputs) unless a conflict is discovered during implementation.
- The system font stack stays; visual differentiation comes from
  color/radius/spacing only.
