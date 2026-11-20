# Feature Specification: Packages Explorer (Phase 1b)

**Feature Branch**: `074-packages-explorer`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User request — drive `Phase 1b: packages explorer` end-to-end through the spec-kit pipeline. This is **Phase 1b of the SBOM / Bill of Materials programme** defined in `researches/sbom_research.md` (normative input; all decisions settled in the research grill, 2026-11-20). Phase 1 (spec 073, merged PR #267) landed `bom_entries`, the BOM read/summary/export APIs, and the **Bill of materials** tab. Phase 1b answers the programme's highest-value question — *"which of our components contain package X?"* (the Log4Shell question) — with a read-only **`/packages` explorer**: a server-paginated list of every distinct package in the workspace (one row per version-free purl), an expandable per-package **consumers** list, and entry points in the sidebar, `Ctrl+K`, and the BOM row menu. It needs no new entities — it is a query surface over `bom_entries`. Governing docs: `researches/sbom_research.md` § UX-PKG / G37 / read contract (normative), ADR-130 (server-paginated lists), ADR-104 (openapi.yaml in the same change), ADR-094/097 (authenticated, side-effect-free GETs), `docs/ux.md` §4–§7 (routes, states, flag governance). Phase 2 (`bomCuration` — catalog promotion, dependency suggestions, Library components) and Phase 3 (`bomImporterEdges`) are **separate specs** and out of scope here.

## Clarifications

### Session 2026-11-20 — research decisions normative for Phase 1b (all resolved, no open markers)

All decisions were settled in the research phase and are normative for this spec; the spec MUST NOT reopen them without a recorded reason.

- **Package identity → one row per version-free purl**: the list groups `bom_entries` by the normalized, version-free purl established as canonical package identity (research PURL-identity decision). Verbatim purls and versions stay on the entries; versions surface as the *Versions in use* chips.
- **Consumers endpoint → separate paginated read**: `GET /packages/consumers?purl=&version=&page=&pageSize=` with the purl as a **query parameter**, not a path segment (research read contract). A row expands to a paginated consumers list rather than navigating away; the expand pattern matches the instances table.
- **Consumer row granularity → merged component identity**: one row per consuming (component, version, scope) combination — the same merged-view identity Phase 1 uses (`instanceCount`/`instanceTotal` semantics) — carrying `direct` and the newest `lastReportedAt`. The component name deep-links to that component's BOM tab filtered to the package (`?tab=bom&q={purl}`).
- **Catalog state → data shipped, column gated**: `GET /packages` returns `catalogComponent`/`pendingSuggestionCount` per row so Phase 2 needs no contract change, but the **Catalog** column renders only while `bomCuration` is ON (UX-BOM-08 parity); in Phase 1b both fields are always null/absent-valued and the column is not rendered.
- **Flag flips ON in this change** (G37 flip condition: "`GET /packages` + consumers endpoint live") — backend and UI ship together, so `packagesExplorer` ships ON with a G37 gap-registry entry.
- **`q` minimum → 2 characters** (UX-PKG-07, SHOULD): shorter input is not sent; the UI shows a hint instead.
- **Search scope → name or purl**: a single `q` matches package name and purl text (including `pkg:{type}/…` queries), case-insensitive, server-side.
- **Sidebar placement**: Catalog group, after *Component groups* and before *Suggestions*; `BlocksIcon` (`PackageIcon` is taken by Products); no count pill.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator finds which components contain a package (Priority: P1)

An operator opens **Packages** from the sidebar (Catalog group) and sees a server-paginated list of every distinct package reported across the workspace — name, purl, ecosystem, versions in use with counts, and how many components consume it. They search by name or purl (`?q=`), filter by ecosystem, scope, or catalog state, sort by name/components/versions/ecosystem, and share or reload the URL to reproduce the exact view.

**Why this priority**: The list itself is the feature — it answers "do we have package X anywhere?" at a glance. Every other surface (consumers, deep links) reads from these rows.

**Independent Test**: seed two importers' worth of BOM data across several components, open `/packages`, and exercise search (`q=lodash`, `q=pkg:deb`), every filter, every sort column, and pagination; reload the URL and confirm identical state; confirm one row per version-free purl regardless of how many versions/components report it.

**Acceptance Scenarios**:

1. **Given** `packagesExplorer` ON and BOM data present, **When** the operator opens `/packages`, **Then** the page renders the header ("Packages" + the inventory-only subtitle), toolbar, and one row per version-free purl with Package (name + purl), Ecosystem, Versions in use (top-5 chips `{version} × {count}` then "+N more"), and Components count (UX-PKG-01/03).
2. **Given** several packages, **When** the operator types `lodash` or `pkg:deb` into search, **Then** matching rows return (name or purl, case-insensitive); with fewer than 2 characters nothing is sent and a hint shows instead (UX-PKG-02/07).
3. **Given** filters/sort/page applied, **When** the URL reloads or is shared, **Then** the identical view returns; changing any filter resets `page` to 1 (UX-PKG-02, list-state standard).
4. **Given** the default view, **When** the list loads, **Then** rows sort `components desc` then `name asc`; the sort whitelist is exactly `name`, `components`, `versions`, `ecosystem` (UX-PKG-02).
5. **Given** `packagesExplorer` OFF, **When** the app renders, **Then** no sidebar item, `Ctrl+K` group, or route content appears — hidden, never disabled (flag governance, docs/ux.md §7).

---

### User Story 2 - Operator expands a package to see its consumers (Priority: P1)

An operator expands a package row and gets a paginated list of consuming components — each with a deep link to that component's BOM tab filtered to the package, its category, the version(s) in use, scope, direct/transitive, and last reported. Clicking a *Versions in use* chip filters the consumers list to that version.

**Why this priority**: "Which components contain X" is the question the whole feature exists to answer (D1); the list alone only says "X exists somewhere". Equal priority with the list — the feature is incomplete without either.

**Independent Test**: seed a package consumed by ≥3 components across two versions, expand its row, verify each consumer row and its deep link, click a version chip and confirm the consumers list narrows to that version (`version` param), and page the consumers list when it exceeds one page.

**Acceptance Scenarios**:

1. **Given** a package row, **When** the operator expands it, **Then** a consumers list loads paginated from the consumers endpoint — component name (link to `?tab=bom&q={purl}`), category, version, scope, direct/transitive badge, last reported (UX-PKG-04).
2. **Given** a package with 5+ versions, **When** the operator clicks the `2.14.1 × 2` chip, **Then** the consumers list filters to consumers of version `2.14.1` via the `version` param (UX-PKG-04).
3. **Given** a package consumed by more components than one consumers page, **When** expanded, **Then** the consumers list paginates within the row without re-fetching the outer list (UX-PKG-04).
4. **Given** the same component reporting the package in several instances, **When** the consumers list renders, **Then** the component appears once per (version, scope) combination with the newest `lastReportedAt` — no duplicate rows per instance (merged-view parity).

---

### User Story 3 - Operator reaches a package from anywhere (Priority: P2)

An operator hits `Ctrl+K`, types a package name or purl, sees a **Packages** result group (top 5, "{name} · {ecosystem} · {n} components"), and lands on `/packages?q=…`. From any BOM tab row menu they pick **See where it's used** and land on `/packages?q={purl}`.

**Why this priority**: Discovery and deep-linking make the explorer the answer to an urgent question ("are we affected?") rather than a page you have to know about — but the page must exist first.

**Independent Test**: open `Ctrl+K`, search a known package name and a `pkg:` purl prefix, confirm the Packages group renders top-5 results and navigates correctly; from a component's BOM tab row menu choose *See where it's used* and confirm the explorer opens with the purl applied.

**Acceptance Scenarios**:

1. **Given** `Ctrl+K` open and a matching package, **When** the operator searches, **Then** a **Packages** group shows up to 5 results formatted "{name} · {ecosystem} · {n} components"; selecting one navigates to `/packages?q={name-or-purl}` (UX-PKG-05).
2. **Given** a BOM tab package row, **When** the operator opens its row menu, **Then** *See where it's used* appears (all roles, flag-gated) and navigates to `/packages?q={purl}` (UX-PKG-05, UX-BOM-09).
3. **Given** `packagesExplorer` OFF, **When** `Ctrl+K` or the row menu renders, **Then** no Packages group or menu item appears (hidden, not disabled).

---

### Edge Cases

- **Purl in the query string**: purls contain `:` `/` `@` `%` — consumers calls encode `purl` as a query parameter; deep links (`?q={purl}`, `?tab=bom&q={purl}`) round-trip through URL encoding without corruption.
- **"+N more" versions**: chips show the top 5 versions by component count; the remainder collapses into "+N more". A version outside the top 5 is still selectable by expanding and filtering the consumers list — no dead ends.
- **Package reported by several Sources**: one list row; `lastReportedAt` reflects the newest report across Sources. A Source that stops *collecting* leaves its entries (and thus the package row) in place per the field-presence contract.
- **Empty workspace**: no importer has reported inventory → *no inventory yet* empty state naming the cause, with an Admins-only link to Importers; non-admins see the explanation only (UX-PKG-06).
- **No matching rows**: search/filters exclude everything → filtered-empty state with **Clear filters** (UX-PKG-06).
- **Consumers fetch failure inside an expanded row**: inline retry within the row, not a page-level error (same pattern as BOM tree children, UX-BOM-12 parity).
- **Unknown purl on the consumers endpoint** (hand-edited URL): empty page, not an error.
- **`componentCount` drift while browsing** (an import completes mid-session): counts refresh on the next fetch; no optimistic pinning.
- **Viewer role**: full read access to `/packages`, consumers, `Ctrl+K` group, and the row-menu item; no write affordances exist on the surface (role table, research § Permissions).

## Requirements *(mandatory)*

### Functional Requirements

**Read APIs**

- **FR-001**: A packages list endpoint (`GET /packages`) MUST return server-paginated rows — same envelope/bounds as other list endpoints (ADR-130) — **one row per version-free purl**, each carrying `purl`, `name`, `ecosystem`, `versionCount`, `versions[ { version, componentCount } ]` (top 5 by component count), `componentCount`, plus `catalogComponent | null` and `pendingSuggestionCount` (shipped for Phase 2 contract stability; always null/zero in this phase).
- **FR-002**: The list endpoint MUST support `q` (package name or purl, case-insensitive), multi-value `ecosystem` and `scope` filters, a `catalog` filter accepted-but-inert until Phase 2 (UX-BOM-08 parity), and a sort whitelist of exactly `name`, `components`, `versions`, `ecosystem` — default `components desc` then `name asc`.
- **FR-003**: A consumers endpoint (`GET /packages/consumers`) MUST take `purl` as a **query parameter** plus optional `version`, `page`, `pageSize`, and return a paginated list of consuming components — one row per (component, version, scope) combination carrying component identity (linkable to its BOM tab), category, `version`, `scope`, `direct`, and the newest `lastReportedAt`.
- **FR-004**: Both endpoints are authenticated reads available to all roles including Viewer; `GET`s are side-effect-free on domain state (ADR-094/097); error responses follow `{code, message, details?}` and never leak internals (ADR-071/096); `docs/openapi.yaml` is updated in the same change (ADR-104).

**Packages page (route `/packages`, flag `packagesExplorer`, gap G37)**

- **FR-005**: The page MUST render header "Packages" with the subtitle "Where every package and version is used across the catalog. Inventory only: Componode does not scan for vulnerabilities." (UX-PKG-01, Copy Deck).
- **FR-006**: All toolbar state MUST be URL-driven via `useListState` — `q`, `ecosystem`, `scope`, `catalog` (inert until Phase 2), `sort`, `order`, `page`, `pageSize` — reproducing the view on reload/share and resetting `page` to 1 on any filter change (UX-PKG-02).
- **FR-007**: Rows MUST follow UX-PKG-03: **Package** (name with purl beneath per the `MonoValue` convention), **Ecosystem**, **Versions in use** (top-5 chips `{version} × {componentCount}` then "+N more"), **Components** (count); the **Catalog** column renders only under `bomCuration` (Phase 2 — not rendered here).
- **FR-008**: A row MUST expand (instances-table expand pattern) to a paginated consumers list per UX-PKG-04 — component name linking to `?tab=bom&q={purl}`, category, version, scope, direct/transitive, last reported; clicking a version chip filters consumers to that version; expansion state is client-only.
- **FR-009**: A search shorter than 2 characters MUST NOT be sent; a hint is shown instead (UX-PKG-07, SHOULD).
- **FR-010**: Empty states MUST distinguish *no inventory yet* (explanation that package data appears after an importer with dependency inventory runs; **Importers** link for Admins only) from *no results* (**Clear filters**) — per UX-PKG-06 and the shared state matrix (loading skeleton, refetching dim, error retry, forbidden).
- **FR-011**: The page is read-only: no editing, selection, or destructive affordances; no advisories/vulnerability UI of any kind, not even disabled (G40); no warning/destructive tones on package rows and none of the forbidden copy words (D8).

**Entry points & integration**

- **FR-012**: The sidebar MUST gain a **Packages** item in the Catalog group after *Component groups* (`BlocksIcon`, no count pill), plus `SEGMENT_LABELS.packages` — visible only while `packagesExplorer` is ON.
- **FR-013**: `Ctrl+K` MUST gain a **Packages** result group (top 5, "{name} · {ecosystem} · {n} components") navigating to `/packages?q=…` — flag-gated (UX-PKG-05).
- **FR-014**: The BOM tab row menu MUST gain *See where it's used* → `/packages?q={purl}` for all roles, rendered only while `packagesExplorer` is ON (UX-PKG-05, UX-BOM-09); *Copy purl* is unchanged.
- **FR-015**: The consumers expander MUST be built as a reusable component (`package-consumers`) that Phase 2's Library detail *Used by* card reuses without rework (research § file plan).

**Governance & docs**

- **FR-016**: `ux/lib/flags.ts` gains `packagesExplorer` **ON** (backend ships in the same change, satisfying the G37 flip condition), with the doc comment referencing G37.
- **FR-017**: `researches/ux-rewrite-gaps.md` MUST gain the G37 entry (UX surface, capability, flag, fallback = hidden) and `docs/ux.md` MUST be updated in the same change (§4 route map, §5 conventions if new patterns, §9 vocabulary) per flag governance.
- **FR-018**: Playwright coverage MUST exercise the surfaces this change touches — `/packages` browse/search/filter/paginate, row expand + version-chip filtering, `Ctrl+K` group, BOM row-menu deep link, and flag-off hidden behaviour — per the testing rule in AGENTS.md.

### Key Entities

- **Package (explorer row)** — a workspace-level rollup keyed by normalized version-free purl: name, ecosystem, distinct versions with per-version component counts, total consuming-component count, catalog linkage state. Derived by query over `bom_entries`; not a stored entity.
- **Consumer** — a (component, version, scope) combination reporting the package: component identity/category, version, scope, `direct`, `lastReportedAt`, reporting context for the deep link to the component's BOM tab.
- **BOM entry** — the Phase 1 stored fact the explorer queries; unchanged by this spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the sidebar, an operator reaches a searchable list of every distinct package in the workspace; a `?q=lodash` or `?q=pkg:deb` search returns the matching grouped rows in one paginated request (UX verification Phase 1b #1).
- **SC-002**: Expanding any package row shows its consuming components with version/scope/directness/freshness in ≤1 interaction; clicking a version chip narrows consumers to that version (UX verification Phase 1b #1).
- **SC-003**: Both deep-link entry points land with the query applied: `Ctrl+K` → `/packages?q=…` and BOM row menu → `/packages?q={purl}` (UX verification Phase 1b #2).
- **SC-004**: A workspace where one package is consumed by 1,000 components still paginates consumers server-side — no request returns more than one page (ADR-130 parity).
- **SC-005**: With `packagesExplorer` OFF, zero explorer surface renders (route, sidebar, palette group, menu item) — verified alongside the G37 gap-registry entry.
- **SC-006**: All copy on the surface matches the Copy Deck and contains none of the forbidden words; no advisories column or warning tone appears anywhere (D8, G40).

## Assumptions

- `researches/sbom_research.md` § UX-PKG, § Flags and Gap Governance (G37), § BOM Read Contract, § Copy Deck and the role table are normative detail for this spec; Phase 1 (`073-bom-inventory`) APIs and UI patterns (`useListState`, `ListToolbar`, `ListPagination`, `MonoValue`, expand pattern, `StatusBadge`) are the building blocks.
- `bom_entries` rows exist only where Phase 1 importers reported them; the explorer surfaces whatever inventory exists — it does not create, backfill, or deduplicate data.
- Version-free purl normalization is the Phase 1 identity decision already applied at write/read time; the explorer groups by it and does not re-normalize.
- `catalogComponent`/`pendingSuggestionCount` ship in the list contract now (Phase 2 needs no contract change) but stay null/zero — no Library components or suggestions exist until Phase 2 (`bomCuration`).
- The consumers endpoint groups to (component, version, scope) — the merged-view parity decision recorded in Clarifications; per-instance consumer rows are a later refinement if stakeholders ask.
- Phase 2 (`bomCuration`: Add to catalog, Link, dependency suggestions, Library components, `/suggestions` segment) and Phase 3 (`bomImporterEdges`) are separate specs; nothing here creates suggestions, edges, or components.
