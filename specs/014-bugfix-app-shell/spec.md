# Bugfix Specification: App-Shell Chrome — Scrolling Sidebar, 768px Collision, No Auto-Collapse

**Feature Branch**: `bugfix/014-app-shell`

**Created**: 2026-09-18

**Status**: Draft

**Input**: Verified browser audit in `researches/app_shell_layout_research.md`
(§5, defects D1/D3/D4). Three app-shell defects were reproduced at real
breakpoints: (a) the sidebar and top bar scroll away with page content on any
page taller than the viewport; (b) at ~768px the dashboard importer-status
row collides (config name overlapped by the status badge); (c) the sidebar
never collapses to the icon rail despite `docs/ux.md` §9 promising
"usable at ~768px (sidebar collapses to icons)". Decisions ratified in the
research review (D1, D3, D11): fix with a bounded `h-dvh` shell, proper
truncation, and auto-collapse below `lg` as a default only.

## Root Cause

1. **Scrolling chrome.** `app-shell.tsx` lays out with `min-h-screen` on the
   shell and an in-flow `<aside class="h-screen">` for the sidebar. The
   `overflow-y-auto` on `<main>` never engages because the content column has
   no bounded height — so the whole document scrolls, carrying the `h-screen`
   sidebar and the top bar with it. Below the sidebar's 100vh box, the left
   column is empty background. Verified: scrolling `/components` at 1440×500
   scrolls the sidebar nav and top bar out of the viewport.
2. **Row collision.** The dashboard importer-status `<li>` packs
   `configLabel` + `importerName` + badge + counts + timestamp + link into
   `justify-between` spans; at ~768px the label span does not shrink/truncate
   early enough, so the `FAILED` badge overlaps the importer name.
3. **No responsive collapse.** `Sidebar` collapse is manual-only
   (`sessionStorage` toggle); at exactly 768px — the documented "usable"
   boundary — the sidebar still occupies `w-56`, contradicting
   `docs/ux.md` §9's parenthetical.

## Affected Surface

- `packages/frontend/src/components/layout/app-shell.tsx` — shell scroll model.
- `packages/frontend/src/components/layout/sidebar.tsx` — collapse default on
  narrow first load; aside must remain scrollable internally when its own nav
  is taller than the viewport.
- `packages/frontend/src/pages/dashboard.tsx` — importer-status row
  truncation.
- Every authenticated page inherits the shell fix; detail pages that rely on
  in-page anchors/`scrollIntoView` must be re-verified because the document
  scroll container changes.

## User Scenarios & Testing

### User Story 1 — Navigation chrome stays put on long pages (Priority: P1)

As any authenticated user, I want the sidebar and top bar to remain visible
while I scroll a long list or detail page, so that I never lose navigation
context.

**Why this priority**: The chrome scrolling away is the verified defect with
the widest blast radius — it affects every page taller than the viewport and
is the behavior every reference shell (Linear, shadcn, Catalyst) pins.

**Independent Test**: Open `/components` (or any long page) at 1440×900,
scroll to the bottom, and verify the sidebar nav, collapse control, top bar,
breadcrumbs, and `Ctrl+K` trigger are all still visible and clickable.

**Acceptance Scenarios**:

1. **Given** a page taller than the viewport, **When** the user scrolls to
   the bottom, **Then** the sidebar (including its collapse button) and the
   top bar remain fully visible and interactive.
2. **Given** a page shorter than the viewport, **Then** the layout renders
   identically to today — no phantom scrollbar, no dead space.
3. **Given** a sidebar whose nav is taller than the viewport, **When** the
   user scrolls the sidebar itself, **Then** its internal scroll still works
   while the header and footer stay pinned.
4. **Given** the new scroll container, **When** a detail page performs
   in-page navigation (anchor/`scrollIntoView`, e.g. tabs or focus after
   dialog close), **Then** the target scrolls into view correctly.

---

### User Story 2 — Sidebar auto-collapses at the usable boundary (Priority: P2)

As a user on a ~768–1024px viewport, I want the sidebar to start collapsed to
icons so the content area is usable without a manual step.

**Why this priority**: `docs/ux.md` §9 records "usable at ~768px (sidebar
collapses to icons)" — the current build does not deliver the parenthetical.
This is the cheap half of tablet usability; the drawer below 768px is
separately scoped to the UI-refresh feature.

**Independent Test**: In a fresh session at 768×1024, load any page and
verify the sidebar renders as the icon rail; toggle it open, reload, and
verify the explicit choice persists.

**Acceptance Scenarios**:

1. **Given** a fresh session (no stored preference) and a viewport below the
   `lg` breakpoint, **When** a page loads, **Then** the sidebar renders
   collapsed to the icon rail.
2. **Given** a user who explicitly toggles the sidebar, **When** the page
   reloads at any width, **Then** the explicit stored choice wins over the
   width-based default.
3. **Given** a viewport at or above `lg`, **When** a fresh session loads,
   **Then** the sidebar renders expanded as today.

---

### User Story 3 — Importer-status rows never overlap (Priority: P3)

As a user on a ~768px viewport, I want the dashboard importer-status rows to
truncate gracefully so no text collides with the status badge.

**Why this priority**: Verified visible collision — the only overlapping
element found in the breakpoint audit above mobile range.

**Independent Test**: At 768×1024 with a configured importer, verify the
config label truncates with ellipsis and the status badge, counts,
timestamp, and link remain unclipped and non-overlapping.

**Acceptance Scenarios**:

1. **Given** a long config label at ~768px, **When** the row renders,
   **Then** the label truncates with ellipsis and never touches the badge.
2. **Given** the same row at ≥1024px, **Then** all columns render fully as
   today.

---

### Edge Cases

- Viewport exactly at the `lg` boundary (1024px): collapse default must not
  flicker or fight the stored preference.
- High-DPI/zoomed viewports producing fractional widths near the boundary.
- `sessionStorage` unavailable (private mode): collapse still works, just
  doesn't persist — the width-based default applies each load.
- Sidebar nav taller than the viewport when collapsed: icon rail scrolls
  internally; the collapse toggle in the footer stays reachable.

## Requirements

### Functional Requirements

- **FR-001**: The app shell MUST bound its height to the viewport so that
  only the main content region scrolls; the sidebar and top bar MUST NOT
  scroll with page content.
- **FR-002**: No empty region may appear below the sidebar on pages taller
  than the viewport.
- **FR-003**: With no stored preference, the sidebar MUST default to the
  collapsed icon rail when the viewport is below `lg` (1024px); at or above
  `lg` it defaults to expanded.
- **FR-004**: An explicit user collapse/expand choice MUST persist in
  `sessionStorage` and MUST take precedence over the width-based default.
- **FR-005**: The dashboard importer-status row MUST truncate its label with
  ellipsis rather than overlap the status badge, at every width ≥768px.
- **FR-006**: Accessibility MUST be preserved: focus-visible rings, aria
  labels, landmark roles, and keyboard navigation unchanged; the scroll
  container change MUST NOT break `scrollIntoView`, anchor navigation, or
  focus restoration on any page.
- **FR-007**: A regression test MUST cover the shell scroll contract and the
  status-row truncation per the repo's bugfix workflow (failing test first).

## Success Criteria

- **SC-001**: At 1440×900, 1280×800, and 768×1024, scrolling to the bottom of
  a page taller than the viewport keeps 100% of the sidebar nav and top bar
  visible and clickable (verified in a real browser).
- **SC-002**: At 768×1024 in a fresh session, the sidebar renders as the icon
  rail and the content column occupies ≥70% of the viewport width.
- **SC-003**: No overlap between any importer-status label and its badge at
  any tested width.
- **SC-004**: The new regression test fails on the pre-fix code and passes
  after; `pnpm lint`, `pnpm typecheck`, and the frontend suite pass.
- **SC-005**: No behavioral regression on detail pages (breadcrumbs, tabs,
  anchor scrolling, dialog focus return all verified).

## Out of Scope

- The sub-768px navigation drawer (mobile) — scoped to the `ui-refresh`
  feature spec per research decision D4/D10.
- Top-bar sidebar trigger / `Ctrl+B` shortcut — also scoped to the feature
  spec (R3).
- All visual-layer changes (emerald palette, pills, faceted filters,
  charts, radius) — feature spec.
- Any API change — none is required; all fixes are frontend layout/state.

## Assumptions

- `100dvh` (or equivalent bounded-height technique) is safe for the target
  desktop browsers; `dvh` vs `vh` differences only matter on mobile chrome,
  which is out of scope here.
- Auto-collapse is a *default* only: it must not override an explicit stored
  preference, and it must not be applied repeatedly on every resize.
- `<main>` remains the single scroll region; no existing page relies on
  window-scroll listeners that would break under the bounded shell
  (verified: zero `scrollIntoView`/`scroll` listeners in
  `packages/frontend/src` — see `research.md` Decision 1).
