# Feature Specification: UX shell — navigation, theming, states, dashboard, global search

**Feature Branch**: `004-ux-shell`

**Created**: 2026-09-07

**Status**: Shipped

**Input**: User description: "Implement the UX/UI foundation ratified by ADR-103 and defined in docs/ux.md: sidebar layout shell, state conventions, theming (dark mode + accent + density), health-and-attention dashboard, and Ctrl+K global search across the existing pages."

**Normative reference**: `docs/ux.md` (ratified by ADR-103). This spec implements the doc's binding decisions on the pages that already exist.

## Clarifications

### Session 2026-09-07

- Q: Does the state-matrix requirement apply to all existing pages or only new/changed ones? → A: All existing pages are retrofitted to the state matrix in this feature (Option A).
- Q: Where is the theme preference persisted? → A: Client-side only (localStorage) — instant apply before first paint, no backend changes, no per-user settings API (Option A).

## User Scenarios & Testing

### User Story 1 - Navigate the app through a grouped sidebar shell (Priority: P1)

As any authenticated user, I want a persistent sidebar with logically grouped sections so I can find any area of the product in one glance and keep my bearings on detail pages.

**Why this priority**: The current flat top-nav duplicates links with the dashboard, does not scale to the entities still coming (LOBs, teams, persons), and gives no sense of place. Every other UX improvement hangs off the shell.

**Independent Test**: Log in, verify the sidebar shows grouped sections (Catalog, Sources, Administration for admins), navigate to a detail page, and verify breadcrumbs show the path back to the section root.

**Acceptance Scenarios**:

1. **Given** a logged-in user, **when** any authenticated page loads, **then** a left sidebar shows the grouped sections Catalog (Dashboard, Products, Components, Component Groups), Sources (Importers), and — for `ADMIN` users only — Administration (Users, Sessions, Settings), and the active item is highlighted.
2. **Given** a user on a detail page (e.g., a component), **when** they look at the top bar, **then** slug-based breadcrumbs (e.g., `Components / <slug>`) link back to the section root.
3. **Given** any user, **when** they collapse the sidebar, **then** it reduces to icons and the choice persists across page loads for that session.
4. **Given** a non-admin user, **when** they view the sidebar, **then** the Administration section is not rendered.
5. **Given** the previous flat top-nav and the link-grid dashboard, **when** this story ships, **then** the top-nav component is replaced by the shell and the dashboard no longer duplicates navigation links.

---

### User Story 2 - Consistent loading, empty, error, forbidden, and not-found states (Priority: P1)

As any user, I want every page to behave predictably while data loads, when there is nothing to show, and when something goes wrong, so the tool feels reliable and I always know what to do next.

**Why this priority**: Today states are ad hoc (a `Loading…` span in the nav, blank tables elsewhere). The state matrix in `docs/ux.md` §6 is the cheapest, broadest UX win.

**Independent Test**: Open each existing page under three conditions — slow network, empty dataset, failed request — and verify the documented state conventions hold.

**Acceptance Scenarios**:

1. **Given** a page whose data is loading for the first time, **when** the request is in flight, **then** skeleton placeholders shaped like the content render — no full-page spinners.
2. **Given** a page refetching or paginating, **when** new data loads, **then** existing data stays visible with a subtle progress indicator and no layout shift.
3. **Given** a list page with zero results, **when** it renders, **then** an empty-state block shows an icon, a one-line explanation, and one primary action (e.g., "Import your first components") — never a blank table.
4. **Given** a failed page-level request, **when** the error occurs, **then** an inline error panel with a retry button is shown; a section-level failure shows its own error and leaves the rest of the page intact.
5. **Given** a 403 response, **when** a page or section is denied, **then** a distinct "You don't have permission" state renders with no retry affordance; a 404 shows the dedicated not-found page with a link to the section root.
6. **Given** the enum→badge color map in `docs/ux.md` §6, **when** statuses render anywhere in the app, **then** `ACTIVE`/`RUNNING`, `STOPPED`, `ERROR`/`GONE`, `RETIRED`, `PENDING`/`QUEUED` each use the same color semantics, and timestamps show relative time with absolute on hover.

---

### User Story 3 - Theme the application (dark mode, accent, density) (Priority: P2)

As a user, I want a readable dark mode, a real accent color instead of the stock grayscale, and denser data presentation, so the tool is comfortable for long sessions and looks intentionally designed.

**Why this priority**: Recorded as binding by ADR-103. Doing it now — before more pages hardcode colors — is nearly free; retrofitting later means auditing every page.

**Independent Test**: Toggle dark/light in the user menu, reload, and verify the choice persists and follows `prefers-color-scheme` when no explicit choice exists.

**Acceptance Scenarios**:

1. **Given** no stored preference, **when** the app loads, **then** it follows the operating-system light/dark preference; **given** a stored preference, **then** it overrides the system.
2. **Given** the user menu, **when** the user toggles the theme, **then** the whole app switches without a reload and the choice persists across sessions.
3. **Given** either theme, **when** any page renders, **then** all colors come from the design-token set (no hardcoded light-only colors) and text contrast meets WCAG 2.1 AA (4.5:1 for normal text).
4. **Given** any table or list, **when** it renders, **then** it uses the compact density standard (small text, reduced row padding) defined in `docs/ux.md` §8.

---

### User Story 4 - Health-and-attention dashboard (Priority: P2)

As any user, I want the landing page to surface what needs my attention and the health of my imports, so opening the tool answers "is everything okay?" at a glance.

**Why this priority**: Replaces the redundant link-grid dashboard with the layout intent recorded in `docs/ux.md` §10 — the most-visited page should carry real signal.

**Independent Test**: With a populated catalog and at least one importer run (including a failed run), open `/` and verify the four documented regions render in order.

**Acceptance Scenarios**:

1. **Given** failed importer runs or `ERROR`/`GONE` instances, **when** the dashboard loads, **then** an "Attention needed" section lists them first with links to the relevant detail; **given** none, **then** the section is hidden entirely.
2. **Given** a populated catalog, **when** the dashboard loads, **then** stat cards show product, component, and instance counts with lifecycle/status breakdown and the last import time.
3. **Given** configured importers, **when** the dashboard loads, **then** an importer-status list shows the last run per importer: status, when, and assets found/created/updated.
4. **Given** a fresh install with an empty catalog, **when** the dashboard loads, **then** a getting-started strip ("Configure your first importer") replaces all of the above.
5. **Given** a viewer role, **when** the dashboard loads, **then** it renders read-only — no admin-only data or actions leak.

---

### User Story 5 - Global search command palette (Priority: P3)

As any user, I want to press `Ctrl+K` and jump to any product, component, group, or importer by name or slug, so I can navigate a large catalog faster than clicking through lists.

**Why this priority**: Recorded as a v1 feature by ADR-103 — at catalog scale, search is the primary navigation. P3 because the sidebar shell already provides adequate navigation for early milestones.

**Independent Test**: Press `Ctrl+K`, type a component's name fragment, select the result, and verify navigation to its detail page.

**Acceptance Scenarios**:

1. **Given** any authenticated page, **when** the user presses `Ctrl+K` (or `Cmd+K`), **then** a command palette opens focused on a search input.
2. **Given** a query, **when** results return, **then** matches across components, products, groups, and importers appear grouped by entity type, plus navigation actions (e.g., "Go to Settings").
3. **Given** a result, **when** the user selects it (keyboard or pointer), **then** the app navigates to that entity's detail page.
4. **Given** the palette is open, **when** the user presses `Escape`, **then** it closes; **given** no results, **then** an empty-state message renders.
5. **Given** a viewer role, **when** results render, **then** no entities the user cannot read are suggested.

---

### Edge Cases

- **Sidebar on narrow viewports**: at ≥768px the sidebar may auto-collapse to icons; below that it remains functional but is not a designed-for experience (docs/ux.md §9).
- **Dashboard with no importers configured**: importer-status list collapses into the getting-started guidance rather than showing an empty table.
- **Command palette on auth pages**: `/login`, `/register`, `/oidc/callback` render without the shell and without the palette.
- **Theme during SSR-less boot**: the chosen/system theme must apply before first paint — no flash of the wrong theme.
- **Admin-only sidebar items**: hiding the Administration section is cosmetic only; routes remain role-gated server-side per ADR-054/ADR-097.

## Requirements

### Functional Requirements

- **FR-001**: The application MUST render a persistent left sidebar layout shell on all authenticated pages, organized into grouped sections: Catalog (Dashboard, Products, Components, Component Groups), Sources (Importers), and Administration (Users, Sessions, Settings — `ADMIN` role only). Auth pages render without the shell.
- **FR-002**: The sidebar MUST be collapsible to icons, MUST highlight the active route, and MUST persist its collapsed state in sessionStorage (per browser tab/session, not permanently).
- **FR-003**: The top bar MUST show slug-based breadcrumbs reflecting the current page's position in the route map (docs/ux.md §3) and the signed-in user's identity, theme toggle, and sign-out.
- **FR-004**: The flat top-nav and the link-grid dashboard MUST be removed; the dashboard becomes an overview page per FR-008–FR-011.
- **FR-005**: Every existing page and async region MUST be retrofitted to the state matrix in `docs/ux.md` §6 (all pages, including auth and admin pages — not only new or changed pages): skeletons for initial load, no layout shift on refetch, standard empty-state blocks with a primary action, inline page/section errors with retry, distinct 403 and 404 states.
- **FR-006**: Enums MUST render as badges using the fixed color map in `docs/ux.md` §6; timestamps MUST render relative with absolute on hover; slugs MUST render in monospace.
- **FR-007**: The app MUST ship a dark theme and a light theme selectable from the user menu, defaulting to the OS preference, persisting the explicit choice in client-side storage only (localStorage — no per-user settings endpoint), applying before first paint, and using token-based colors throughout so text meets WCAG 2.1 AA contrast in both themes.
- **FR-008**: The dashboard MUST render an "Attention needed" section listing failed importer runs and `ERROR`/`GONE` instances with links to the relevant detail, hidden when empty.
- **FR-009**: The dashboard MUST render stat cards for products, components (by lifecycle), and instances (by status), plus the last import time.
- **FR-010**: The dashboard MUST render a per-importer last-run status list (status, timestamp, assets found/created/updated).
- **FR-011**: On a fresh install with an empty catalog, the dashboard MUST replace all of the above with a getting-started strip pointing at importer configuration.
- **FR-012**: Dashboard data MUST come from `GET` endpoints that are side-effect-free (ADR-094) and return only data the caller's role can read; no new mutating behavior may ride along.
- **FR-013**: A `Ctrl+K`/`Cmd+K` command palette MUST be available on all authenticated pages, searching components, products, groups, and importers by name or slug (case-insensitive, consistent with catalog search semantics from spec 003), returning results grouped by entity type plus navigation actions, and navigating on selection.
- **FR-014**: All new UI MUST conform to `docs/ux.md` conventions for forms, voice, and formatting, and MUST meet WCAG 2.1 AA (keyboard reachable, focus-visible rings, screen-reader navigable) per spec 001 FR-026.
- **FR-015**: Filter and view state on list pages MUST live in the URL query string so views are shareable and back-button friendly.
- **FR-016**: All new endpoints MUST live under `/api/v1/`, require authentication (ADR-054/ADR-097), validate inputs with Zod rejecting unknown fields (ADR-095), and return errors as `{code, message, details?}` without leaking internals (ADR-071/ADR-096).

### Key Entities

- **Layout shell**: Sidebar + top bar chrome wrapping all authenticated pages. Presentational; holds nav structure, breadcrumbs, theme toggle.
- **Dashboard aggregates**: Read-only projections over existing entities (products, components, instances, importer configs, importer runs). No new persisted entities.
- **Search index query**: Server-side search across component, product, group, and importer-config names/slugs. No new persisted entities.
- **User theme preference**: `light` | `dark` | `system`. Client-persisted in localStorage only; no server-side per-user setting (Clarifications, 2026-09-07).

## Success Criteria

- **SC-001**: A user can reach any top-level section in at most 2 clicks/keystrokes from any page, and can identify their current location from breadcrumbs or sidebar highlighting 100% of the time.
- **SC-002**: Every page demonstrates all applicable states from the state matrix — verified on at least the catalog, importers, and dashboard pages.
- **SC-003**: Theme switching takes effect without reload, persists across sessions, and both themes pass a WCAG 2.1 AA contrast check on every page.
- **SC-004**: On an install with failures present, a user can identify every failed importer run and `ERROR` instance from the dashboard without navigating further, in under 10 seconds.
- **SC-005**: `Ctrl+K` opens the palette in under 200ms and returns relevant results for a name/slug fragment in under 1 second on a 1,000-component catalog.
- **SC-006**: All pages remain keyboard-navigable end to end (shell, palette, tables, forms) — verified per the WCAG 2.1 AA criteria carried from spec 001.
- **SC-007**: All existing test suites continue to pass; new UI conventions are covered by component tests for the shell, states, and palette.

## Assumptions

- The **products tree and product detail pages** from `docs/ux.md` §5 are **not** in this spec: the product domain (routes, services, COMPOSES/CONSUMES_FROM edges) does not exist yet and lands with the product-hierarchy feature (`005-product-hierarchy`; numbering is sequential and non-binding). This spec provides the shell and conventions that feature must build on, and `/products` keeps its current stub within the new shell.
- The graph/map visualization, mobile design, activity feed, customizable dashboard, density toggle, and custom importer-form widgets remain open decisions (docs/ux.md §11) and are out of scope.
- Existing component, group, importer, run, user, session, and settings endpoints provide enough data for the dashboard aggregates and palette search; if a small read-only aggregate or search endpoint is needed, it is added under `/api/v1/` per FR-012/FR-016 rather than computed client-side across pages.
- Importer run records already persist everything the dashboard needs: `import_runs` carries `status`, `startedAt`/`completedAt`, `assetsProcessed`, `assetsCreated`, `assetsUpdated`, `instancesOrphaned`, and `componentsRetired` — no schema extension is required for the dashboard aggregates.
- `docs/ux.md` is normative per ADR-103; where this spec and the doc diverge, the spec wins for this feature and the doc is updated.
- Roles are the existing `ADMIN` / editor / viewer model from 001; no new permissions are introduced.
