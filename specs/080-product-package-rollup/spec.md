# Feature Specification: Product Package Roll-up

**Feature Branch**: `080-product-package-rollup`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Product-level package roll-up (Q7) — explicitly deferred to 'evaluate after Phase 2'; now answerable: aggregate `bom_entries` across a product's component edges into a per-product dependency view. Natural continuation of the SBOM programme."

This is the **product-level package roll-up** deferred as research question **Q7** in `researches/sbom_research.md` ("Evaluate after Phase 2 on existing product–component edges; no Phase 1–3 commitment"). Phase 2 has landed — `bom_entries` (spec 073), the `/packages` workspace explorer (spec 074), catalog promotion and Library components (spec 075), and importer-native declared edges (specs 076–079) are all merged — so the question is now answerable: a **per-product dependency view** that aggregates the BOM data of every component a product depends on into one package inventory. It answers *"what does this product actually run on?"* — the product-level Log4Shell question — and surfaces **version skew** (the same package at different versions across the product's components), which is invisible at single-component and whole-workscope scope. Governing docs: `researches/sbom_research.md` § UX-PKG / read contract / D8 (normative), the product dependency model (`DepSource` DIRECT / GROUP / INHERITED), ADR-130 (server-paginated lists), ADR-104 (openapi.yaml in the same change), ADR-094/097 (authenticated, side-effect-free GETs), `docs/ux.md` §4–§7 (routes, states, flag governance).

## Clarifications

### Session 2026-11-23 — research decisions normative for this spec (all resolved, no open markers)

All decisions below were settled in the SBOM research grill (2026-11-20) or are the repo's established semantics; the spec MUST NOT reopen them without a recorded reason.

- Q: Should the product roll-up correlate each package row with the Library components the product (or its composed children) already declares `DEPENDS_ON` edges to — surfacing a 'declared dependency' signal — or stay a pure inventory aggregation? → A: Mark declared edges now — each package row whose matched Library component the product already `DEPENDS_ON` (directly, via a group, or inherited via a composed child) shows a declared marker, making undeclared runtime dependencies visible.

- **Q7 is now evaluated**: build the roll-up. The deferral said "evaluate after Phase 2 on existing product–component edges" — Phase 2 shipped (spec 075, PR #270), the edge model is stable, so the feature proceeds as its own spec.
- **Contributing set → the product's full reachable component set** — the same set the existing *Components* tab computes: components reachable via the product's declared edges (direct `DEPENDS_ON` edges plus `DEPENDS_ON` on component groups, expanded to members) **and** inherited via `COMPOSES` descendants (`INHERITED` dep sources). A component reachable through several paths contributes its packages once.
- **Package identity → one row per normalized, version-free purl** — the same `bom_entries.purlIdentity` grouping the `/packages` explorer uses. Verbatim purls and versions stay on entries; versions surface as *Versions in use*.
- **Package→component granularity → merged component identity**: a component reporting the same package in several instances appears once per (version, scope) combination with the newest `lastReportedAt` — merged-view parity with the BOM tab and the `/packages` consumers list.
- **Attribution travels with every row**: each contributing component carries its declared/inherited reachability so the operator can tell "my product's own edge" from "inherited through a composed child".
- **Coverage honesty** (design principle 6): the view shows how much of the contributing set reports package data at all — "N of M components report packages" — so an empty-looking inventory is distinguishable from unmonitored components. Per-entry completeness semantics (absent vs. present-empty `bomEntries`) already landed with Phase 1.
- **Freshness → the same stale rule** as the rest of the SBOM surface: `lastReportedAt` per row, stale indicator at the workspace `bom.staleThresholdDays` threshold (Q1).
- **Read-only** (D7 parity): no writes from this surface; Viewers can read it (D2 parity). Export at product level is **out of scope** — the Phase 1 export contract covers a single selected instance only (Q3).
- **Inventory only, never a security posture** (D8): no risk/success/warning tones on package data; copy never says "safe", "secure", or "vulnerable". The only warning tone permitted is *stale data*.
- **Flag governance**: the surface ships behind a feature flag registered in the G3x gap registry (`docs/ux.md` §7, `researches/ux-rewrite-gaps.md`), hidden-not-disabled when OFF, shipping ON like `packagesExplorer` / `bomCuration` / `bomImporterEdges` did. The flag name is settled in the plan.
- **Declared-dependency correlation ships in this spec** (clarified 2026-11-23): a package row whose matched Library component is itself in the product's reachable component set shows a **declared** marker — "the product already declares a dependency on this library". Matching reuses the established catalog-match semantics (the `catalogComponent` rule: BOM entries resolved to a component, else a non-retired component whose `externalId` equals the row's version-free purl). Declared reachability through a composed child counts and is attributed, so inherited declarations are not mistaken for the product's own.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator views a product's aggregated package inventory (Priority: P1)

An operator opens a product and sees a dedicated package inventory — one row per distinct package reported across all components the product depends on (directly, through component groups, or inherited from composed products). Each row shows the package name and purl, ecosystem, versions in use with per-version component counts, and how many of the product's components report it. The operator searches by name or purl, filters by ecosystem or version skew, sorts, and shares or reloads the URL to reproduce the exact view.

**Why this priority**: The list itself is the feature — it answers "what does this product run on?" at a glance. Every other surface (consumers, attribution, freshness) reads from these rows.

**Independent Test**: seed BOM data for components reachable through each reachability kind (direct edge, group membership, `COMPOSES` child), open the product's package view, exercise search (`q=`), every filter and sort, and pagination; reload the URL and confirm identical state; confirm one row per version-free purl regardless of how many versions or contributing components report it.

**Acceptance Scenarios**:

1. **Given** a product whose reachable components report BOM entries, **When** the operator opens the product's package view, **Then** the page renders one row per version-free purl with Package (name + purl), Ecosystem, Versions in use (top-5 chips `{version} × {count}` then "+N more"), and a count of contributing components.
2. **Given** several packages, **When** the operator types `lodash` or `pkg:deb` into search, **Then** matching rows return (name or purl, case-insensitive); input under 2 characters is not sent and a hint shows instead (UX-PKG-07 parity).
3. **Given** filters/sort/page applied, **When** the URL reloads or is shared, **Then** the identical view returns; changing any filter resets the page to 1 (list-state standard, ADR-130).
4. **Given** a package reported at three different versions by different components, **When** the operator enables the version-skew filter, **Then** only packages with more than one distinct reported version remain.
5. **Given** a package row matching a Library component the product declares a `DEPENDS_ON` edge to (directly, via a group, or inherited via a composed child), **When** the row renders, **Then** a declared marker shows; filtering to *undeclared* leaves only packages with no declared library edge in the product's reachable set.
6. **Given** the feature flag OFF, **When** the app renders, **Then** no tab, sidebar entry, or route content appears — hidden, never disabled (flag governance).
7. **Given** a product with no reachable components, or reachable components that report no packages, **When** the operator opens the view, **Then** a dedicated empty state explains which case applies (no dependencies vs. no package data) rather than a bare blank table.

---

### User Story 2 - Operator drills into a package to see which product components contain it (Priority: P1)

An operator expands a package row and gets a paginated list of the product's components reporting it — each with the component's identity, its reachability attribution (declared, via group, or inherited via a named composed product), the version(s) in use, scope, direct/transitive, last reported, and a deep link to that component's BOM tab filtered to the package. Clicking a *Versions in use* chip narrows the consumers list to that version.

**Why this priority**: "Which parts of this product contain X?" is the question that makes the roll-up actionable — equal priority with the list; the feature is incomplete without either.

**Independent Test**: seed a package consumed by ≥3 of the product's components across two versions and at least two reachability kinds, expand its row, verify each consumer row's attribution label and deep link, click a version chip and confirm the list narrows to that version, and page the consumers list past one page.

**Acceptance Scenarios**:

1. **Given** a package row, **When** the operator expands it, **Then** a consumers list loads paginated — component name (deep link to the component's BOM tab filtered to the package), category, reachability attribution, version, scope, direct/transitive badge, and last reported.
2. **Given** a component reachable both directly and via a group, **When** it appears in the consumers list, **Then** it appears once with its declared attribution — no duplicate rows per reachability path.
3. **Given** a component reachable only through a composed child product, **When** it appears in the consumers list, **Then** its attribution names the child product it is inherited through.
4. **Given** a package at several versions, **When** the operator clicks a `{version} × {count}` chip, **Then** the consumers list filters to consumers of that version.
5. **Given** the same component reporting the package in several instances, **When** the consumers list renders, **Then** the component appears once per (version, scope) combination with the newest `lastReportedAt` — no per-instance duplicates (merged-view parity).

---

### User Story 3 - Operator reads coverage and freshness of the product's package data (Priority: P2)

An operator sees how much of the product's component set actually reports package data — a coverage line like "42 packages from 8 of 11 components" — and per-row freshness with the stale indicator at the workspace stale threshold, so an apparently thin inventory is correctly read as unmonitored rather than clean.

**Why this priority**: Honest-freshness is a settled design principle; without the coverage denominator the roll-up misleads. Lower than the list/consumers because it is a summary layered on them.

**Independent Test**: seed a product where some reachable components report BOM data and others report none; verify the coverage line counts, mark one source's reports older than the stale threshold, and verify the stale indicator renders on affected rows.

**Acceptance Scenarios**:

1. **Given** a product with 11 reachable components of which 8 report package data, **When** the view loads, **Then** the summary states "…from 8 of 11 components" (or equivalent wording).
2. **Given** a package whose contributing components' most recent report is older than the workspace stale threshold, **When** the row renders, **Then** a stale indicator shows — the only warning tone in the surface (D8).
3. **Given** a RETIRED product, **When** the operator opens its detail, **Then** the package view remains readable as a historical read-only view.

---

### Edge Cases

- **Component reachable through multiple paths** (direct edge + group membership + inherited): contributes each package once; attribution prefers its declared reachability.
- **Library components in the reachable set**: aggregate like any component if they report entries (rare); a library that is itself a `DEPENDS_ON` target additionally drives the declared-dependency signal on matching package rows — including when the declaration is inherited through a composed child (attributed, not mistaken for the product's own edge).
- **Product with component edges but zero BOM data anywhere**: coverage line shows "0 of N components report packages" and the empty state says the components have not reported package data — not "this product has no packages".
- **COMPOSES depth**: inherited reachability follows the `COMPOSES` DAG (cycle-free by construction, ADR-049); attribution names the nearest contributing child product.
- **Stale-only inventory**: a product whose only package data is stale still lists the packages — staleness is a badge, not a filter.
- **Flag OFF mid-session**: navigation away/gating hides the surface entirely; no disabled-state tab remains.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present a per-product package inventory on the product detail surface, aggregating BOM data across the product's full reachable component set (declared direct/group edges plus inherited via `COMPOSES`).
- **FR-002**: The inventory MUST group packages by normalized, version-free purl identity — one row per distinct package — consistent with the workspace `/packages` explorer.
- **FR-003**: Each row MUST show package name, purl, ecosystem, versions in use (top 5 by contributing-component count, with overflow), and the count of the product's components reporting it.
- **FR-004**: The list MUST be server-paginated with URL-reproducible state (query, filters, sort, page); any filter change resets pagination to page 1; search requires ≥2 characters and matches package name or purl case-insensitively.
- **FR-005**: The list MUST support filtering by ecosystem, by version skew (packages reported at more than one distinct version), and by declared state (packages whose matched Library component is — or is not — in the product's reachable set), and sorting by a fixed whitelist consistent with the workspace explorer (`name`, `components`, `versions`, `ecosystem`).
- **FR-006**: Each row MUST expand to a paginated consumers list scoped to the product's components, showing per (version, scope) merged rows with version, scope, direct/transitive, last reported, and a deep link to the component's BOM tab filtered to the package; clicking a version chip filters the consumers list to that version.
- **FR-007**: Every contributing component in the consumers list MUST carry reachability attribution: declared (direct edge or via a named component group) or inherited (via a named composed product).
- **FR-008**: Each package row MUST carry a declared-dependency signal: when the row's matched Library component (established catalog-match semantics — resolved entries, else `externalId` equal to the version-free purl) is reachable from the product via a `DEPENDS_ON` edge — direct, group membership, or inherited through a composed child — the row shows a declared marker attributed to its reachability; otherwise the row is undeclared and filterable as such.
- **FR-009**: The view MUST report coverage — how many of the product's reachable components report package data — and per-row freshness (`lastReportedAt`) with a stale indicator at the workspace stale threshold; the stale indicator is the only warning tone permitted (D8).
- **FR-010**: The surface MUST be read-only: no write actions on rows; Viewers can view it.
- **FR-011**: The surface MUST be gated by a registered feature flag — hidden (not disabled) when OFF — following flag governance in `docs/ux.md` §7.
- **FR-012**: RETIRED products' package views MUST remain readable (historical read-only data); reachable components that are themselves RETIRED are excluded from the contributing set, consistent with existing default query semantics.
- **FR-013**: Distinct empty states MUST distinguish "product has no component dependencies" from "components report no package data".

### Key Entities *(include if feature involves data)*

No new entities — the view is a derived projection over existing data, consistent with the `/packages` explorer precedent:

- **DigitalProduct** (existing): the aggregation scope; reachable components follow its `DEPENDS_ON` (component and component-group) and `COMPOSES` edges.
- **Component** (existing): members of the contributing set, each carrying a reachability attribution (`DepSource`: DIRECT / GROUP / INHERITED).
- **BomEntry** (existing): factual inventory rows; grouped by `purlIdentity` (normalized, version-free purl) into packages.
- **Product package row** (derived): one row per purl identity with versions-in-use, contributing-component count, and newest `lastReportedAt`.
- **Product package consumer row** (derived): one row per (contributing component, version, scope) with attribution and deep link.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can answer "does product X contain package Y, and where?" in under 30 seconds using search, row expansion, and the deep link — no manual cross-referencing of per-component inventories.
- **SC-002**: Packages reported at more than one distinct version are identifiable from the list without drill-down (versions chips and/or the skew filter) for 100% of such packages.
- **SC-003**: The view loads and paginates for a product with 200 reachable components and 50,000 reported entries within the same perceived-performance budget as the `/packages` explorer — bounded reads, no unbounded in-page aggregation.
- **SC-004**: 100% of list states (search, filters, sort, page, expanded row) reproduce exactly from the URL on reload or share.
- **SC-005**: The coverage summary lets an operator distinguish "8 of 11 components report packages" from "no packages found" on first read — verified by the distinct empty states.
- **SC-006**: Every acceptance scenario above is exercised by the spec's Playwright workload coverage, per the repo's e2e policy.

## Assumptions

- The contributing component set reuses the existing product dependency model (`DepSource` DIRECT / GROUP / INHERITED) computed for the product detail *Components* tab — no new graph semantics are introduced.
- Aggregation is a derived read over `bom_entries` and the product edge tables; nothing is stored or materialized.
- Component-group edges contribute the group's current members (expansion consistent with the existing dependency list).
- Product-level SBOM export is out of scope; the Phase 1 export contract (full BOM for a selected instance) is unchanged.
- Licence filtering remains out of scope (Q6); licences are not part of this view.
- Package-row ↔ Library-edge correlation is **in scope** (clarified 2026-11-23): the declared marker reuses the catalog-match semantics and the same reachable-set computation — no new match rule is introduced.
- The feature flag name and sidebar/entry-point placement are design details settled in the plan, within flag governance.
