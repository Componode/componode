# Feature Specification: BOM Catalog Promotion (Phase 2)

**Feature Branch**: `075-bom-catalog-promotion`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User request — drive `Phase 2 (bom-catalog-promotion)` end-to-end through the spec-kit pipeline. This is **Phase 2 of the SBOM / Bill of Materials programme** defined in `researches/sbom_research.md` (normative input; all decisions settled in the research grill, 2026-11-20). Phase 1 (spec 073) landed `bom_entries`, the BOM read/summary/export APIs, and the **Bill of materials** tab; Phase 1b (spec 074) shipped the `/packages` explorer with `catalogComponent`/`pendingSuggestionCount` contract fields held null. Phase 2 turns package inventory into curated catalog data: a run-completion **matching pass** resolves BOM entries to catalog Components and stages **dependency suggestions** (ADR-113 pattern — never auto-wired), curators **Add to catalog** unmatched packages as `LIBRARY` Components or **Link** them to existing ones, and the catalog stays legible while thousands of libraries arrive. Governing docs: `researches/sbom_research.md` § Phase 2 / UX-ADD / UX-SUG / UX-LIB / write contract (normative), ADR-113 (suggestion lifecycle), ADR-013 Amendment 2 (ecosystem providers), new ADR-132 (promotion rules), ADR-104 (openapi.yaml in the same change), ADR-094/095/097 (route contract), `docs/ux.md` §4–§7 (routes, states, flag governance — flag `bomCuration`, gap G38). Phase 3 (`bomImporterEdges` — importer-declared edges) is a **separate spec** and out of scope here.

## Clarifications

### Session 2026-11-21 — research decisions normative for Phase 2 (all resolved, no open markers)

All decisions were settled in the research phase and are normative for this spec; the spec MUST NOT reopen them without a recorded reason.

- **Decision granularity → per package**: curation acts on the version-free purl (the `purlIdentity` established in Phase 1/1b), never per version or per consuming component. Versions stay on each consumer's own BOM.
- **Library Component identity → normalized version-free purl in `externalId`**: one catalog Component per package across all providers and categories. Category derives from `cdxType`; Provider derives from `ecosystem`; `resourceType` carries the purl type verbatim (`npm:package`); slug follows `pkg-{type}-{name}` slugified with numeric collision suffixes (ADR-046).
- **Existing-component match → normalized-identity equality on `components.externalId`** across **all** providers/categories, enforced in the service layer (`externalId` has no DB uniqueness). A match switches the dialog to **Link** mode; duplicate identities are never created.
- **No auto-wiring, ever**: even an exact purl match produces a pending suggestion, never a `component_depends_on_component` write. Every edge is created by a human action (Link, Add-and-link, or Accept). Decided suggestions (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`) are terminal; the `(parent, child)` pair is never resurrected (ADR-113 parity).
- **Bulk write endpoints supersede per-entry routes**: the UI uses the package-level preview/add/link endpoints; `POST /bom-entries/:id/promote` and `/wire` MAY remain as thin aliases but are not used by the UI.
- **Bulk accept → `PURL_EXACT` groups only, server-enforced**: name/slug matches require per-row review and offer only **Dismiss all**.
- **Suggestions UX → segment on `/suggestions`**: `?kind=edge|dependency` (default `edge`); product-edge behaviour, URLs, and the **nav pill count are unchanged** — the pill keeps counting product edges only.
- **Link-all is atomic**: "Add and link N" / "Link all N" creates the component (when needed) and exactly N dependency edges in one operation — failure creates nothing.
- **Libraries stay out of the way**: `/components` hides `LIBRARY` by default behind a **Show libraries** toggle; `LIBRARY` is excluded from coverage denominators and the dashboard wired/unwired math; the Relationships tab collapses library neighbours into a single summary node.
- **Provider taxonomy**: 13 ecosystem `ComponentProvider` values are added via the three-way update (research + `core` constants + migration altering the CHECK constraint); `docker`/`oci` ecosystems map from the registry hostname (`DOCKER`, `GHCR`, or `ECR`); unmapped ecosystems fall back to `OTHER`.
- **Flag flips ON in this change** (G38 flip condition: "Phase 2 endpoints + `bom_component_suggestions` live") — backend and UI ship together, so `bomCuration` ships ON with a G38 gap-registry entry. While OFF, all curation surfaces (In-catalog column, row-menu write items, dependency segment, Add/Link dialogs, library surfaces) are hidden, never disabled.
- **Roles**: Add to catalog, Link, and suggestion decisions are **Editor+** and hidden for Viewers (advisory UI, API-enforced). Read surfaces stay Viewer-visible.
- **Vocabulary**: the UI says **Add to catalog** and **Link to existing component** — never "promote"/"wire" (CONTEXT.md; "promote" already means component → Platform product).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Curator adds a package to the catalog (Priority: P1)

A curator opens the row menu on a package — from a component's BOM tab or from `/packages` — and chooses **Add to catalog**. A dialog previews exactly what will be created (name, category, provider with its group, purl identity, consumer count) and offers two outcomes: **Link all N components that use it** (default) or **Only add to the catalog** (consumers become pending suggestions instead). Confirming creates one `LIBRARY` Component and, when chosen, all N dependency relationships atomically.

**Why this priority**: This is the feature's primary act — turning factual package inventory into curated catalog meaning. It is independently valuable: even without the suggestions queue, a curator can build Library components and dependency edges by hand.

**Independent Test**: seed BOM data with a package consumed by several components, run *Add to catalog* on it, and verify the preview, the created Library component (identity, category, provider, slug), the atomic link-all outcome, and the suggestions-only outcome on a second package.

**Acceptance Scenarios**:

1. **Given** an Editor with `bomCuration` ON and a package not in the catalog, **When** they choose *Add to catalog* from a BOM tab or `/packages` row menu, **Then** a dialog titled "Add {name} to the catalog" previews Name, Category, Provider (with group), Identity (version-free purl), and "Used by N components" before commit (UX-ADD-01/02).
2. **Given** the preview open, **When** the curator confirms with **Link all N** (default), **Then** one Library component and exactly N `component_depends_on_component` edges are created atomically — on failure nothing is created and the dialog shows an inline error with Retry (UX-ADD-03/05).
3. **Given** the preview open, **When** the curator chooses **Only add to the catalog**, **Then** the Library component is created and each consumer appears as a pending dependency suggestion instead of an edge (UX-ADD-03).
4. **Given** a package whose `cdxType` maps lossily (e.g. `firmware` → `COMPUTE`), **When** the dialog renders, **Then** a muted "Mapped from {cdxType}" note is shown (UX-ADD-07).
5. **Given** a successful add, **When** the toast "Added {name} to the catalog" appears, **Then** it offers a **View** action to the new Library component and the originating *In catalog* cell updates to *Linked* without a full reload (UX-ADD-06).
6. **Given** a Viewer, **When** any row menu renders, **Then** no write items appear (hidden, never disabled); a direct API call is rejected with the standard role error.

---

### User Story 2 - Curator links a package to an existing component (Priority: P1)

When a Component already exists for a package's identity — including a manually created component whose `externalId` is the same normalized purl under any provider/category — the same entry point opens **Link to existing component** instead of creating a duplicate. The dialog shows the matched component and the same two outcomes (link all N consumers / leave as suggestions).

**Why this priority**: Duplicate package identities corrupt the model; correct dedup into the existing component is as important as creation. Ships with US1 in the same dialog/API surface.

**Independent Test**: create a catalog Component whose `externalId` equals a package's normalized purl under a different provider/category, open the same row-menu action, confirm the dialog is in Link mode naming the matched component, and complete both outcomes.

**Acceptance Scenarios**:

1. **Given** a package whose normalized purl equals an existing component's `externalId` (any provider/category), **When** the curator opens the row-menu action, **Then** the dialog presents **Link to existing component** showing the matched component — never a create form (UX-ADD-04).
2. **Given** Link mode confirmed with **Link all N**, **Then** exactly N dependency edges are created atomically and the BOM rows for that package resolve to the matched component.
3. **Given** Link mode confirmed with the suggestions outcome, **Then** no edges are written and each consumer appears as a pending suggestion.
4. **Given** a consumer already linked (edge exists), **When** Link-all runs, **Then** existing edges are preserved and the count/result reflects only newly created relationships.

---

### User Story 3 - Run completion stages dependency suggestions (Priority: P1)

When an import run completes, a matching pass runs alongside the existing suggestion/auto-group passes: it resolves each reported BOM entry to a catalog Component where identity matches, and stages a pending `bom_component_suggestions` row per (consuming component, library) pair — recording the match reason (`PURL_EXACT`, `PURL_NAME_MATCH`, `CATALOG_SLUG_MATCH`) and score. No edges are written; only `PENDING` rows are actionable and decisions are terminal.

**Why this priority**: This is what makes the queue live — without it there is nothing to review and the *Suggested* state in the UI never appears. It delivers value alone: after one run, curators see inferred dependency candidates.

**Independent Test**: seed a catalog component matching a package's purl (and a second matching by name only), complete an import run reporting that package, and verify `resolvedComponentId`/identity resolution, pending suggestions with correct reasons, and zero auto-created edges.

**Acceptance Scenarios**:

1. **Given** a Library component exists and a completed run reports that package on a component, **When** the matching pass runs, **Then** the BOM entry's identity resolves to the component and a `PURL_EXACT` suggestion is staged for the (consumer, library) pair.
2. **Given** a component whose name or slug matches a package (no exact purl match), **When** the pass runs, **Then** a `PURL_NAME_MATCH`/`CATALOG_SLUG_MATCH` suggestion is staged — never an edge.
3. **Given** a (consumer, library) pair already decided (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`) or already pending, **When** the pass re-runs, **Then** no duplicate or resurrected suggestion is created.
4. **Given** a run that fails, is cancelled, or interrupted, **When** it ends, **Then** no matching pass runs and no suggestions are created.
5. **Given** the *In catalog* column and `catalog` list filter (`linked|suggested|none`) shipped inert in Phase 1, **When** matches and suggestions exist, **Then** rows report *Linked* / *Suggested* and the filter works — on the BOM tab and `/packages` (`catalogComponent`, `pendingSuggestionCount` populated).

---

### User Story 4 - Curator reviews the dependency suggestions queue (Priority: P1)

On `/suggestions`, a segmented control switches between **Product edges** and **Component dependencies**. The dependency segment groups pending rows by library ("lodash is used by 14 components") with the strongest match reason, version count, and purl; groups expand to per-component rows. **Accept all** is offered only for `PURL_EXACT` groups; all groups offer **Dismiss all**. Bulk actions confirm with the exact count and finality notice; accepting writes the real dependency edges.

**Why this priority**: Human review is the only path from suggestion to edge — it must scale to thousands of rows, which is why grouping and guarded bulk actions exist. Equal P1: Phase 2 is incomplete if suggestions accumulate with no workable review surface.

**Independent Test**: stage mixed-reason suggestions across several libraries, exercise grouping, expansion, per-row accept/dismiss, exact-only bulk accept, bulk dismiss, confirmation counts, and History — plus the unchanged product-edge segment and nav pill.

**Acceptance Scenarios**:

1. **Given** `/suggestions`, **When** the curator selects the **Component dependencies** segment (`?kind=dependency`), **Then** pending groups render per library with badge, versions count, purl, and bulk actions; the segment shows its own pending count while the nav pill still counts product edges only (UX-SUG-01/02/03).
2. **Given** a `PURL_EXACT` group, **When** the curator confirms **Accept all 14**, **Then** exactly 14 dependency edges are created, the suggestions become `ACCEPTED`, and a live-region + toast announce the result; partial failures report counts and offer retry for the failed subset (UX-SUG-05/06/07).
3. **Given** a name/slug-match group, **When** it renders, **Then** no *Accept all* is offered — only per-row **Accept** and **Dismiss all**; a bulk-accept API call targeting non-`PURL_EXACT` suggestions is rejected server-side (UX-SUG-05).
4. **Given** decisions made, **When** the curator opens **History** in either segment, **Then** terminal rows show the library/component/decider per kind; decided pairs never reappear as pending (UX-SUG-08).
5. **Given** a Viewer, **When** they open the dependency segment, **Then** they see pending/history read-only with no action buttons.

---

### User Story 5 - The catalog stays legible with thousands of libraries (Priority: P2)

`/components` hides `LIBRARY` components by default behind a **Show libraries** toggle (URL `libraries=1`, with hidden count). `LIBRARY` is excluded from the Coverage filter and dashboard wired/unwired denominators. The Provider filter groups into *Platforms* and *Package registries*. A Library component's detail page swaps the Instances card for **Used by** (paginated consumers with version/scope/direct) and **Versions in use** chips, with an identity block showing purl, ecosystem and provider. On the Relationships tab, library neighbours collapse into a single **Libraries** summary node.

**Why this priority**: Protects the existing catalog experience once libraries arrive in bulk — important but secondary: the curation loop (US1–US4) works without it.

**Independent Test**: seed ≥200 Library components wired to a consumer, verify the default list hides them with the toggle + count, coverage/dashboard math is unchanged, provider grouping renders, the Library detail page shows Used by/Versions in use, and the Relationships tab renders one summary node within the bounded read.

**Acceptance Scenarios**:

1. **Given** Library components exist, **When** `/components` loads, **Then** they are hidden by default; enabling **Show libraries (N)** includes them via `?libraries=1`, and direct links to a Library always work (UX-LIB-01).
2. **Given** libraries wired and unwired, **When** the Coverage filter and dashboard render, **Then** `LIBRARY` contributes to no denominators (UX-LIB-02).
3. **Given** the Provider filter, **When** opened, **Then** options group under *Platforms* and *Package registries* (UX-LIB-03).
4. **Given** a Library component detail, **When** it renders, **Then** **Used by** lists consuming components (version, scope, direct/transitive, link to the consumer's filtered BOM tab) paginated; **Versions in use** chips filter it; the identity block shows purl, ecosystem, provider (UX-LIB-04).
5. **Given** a consumer with 200+ library dependencies, **When** the Relationships tab renders, **Then** one **Libraries** summary node ("N libraries") links appropriately and the bounded read contract returns library counts separately from lane nodes (UX-LIB-05).

---

### Edge Cases

- **Same package, multiple versions/scopes**: curation is per version-free purl — one Library component; edges are per consuming component regardless of how many versions it reports.
- **Package consumed by zero components** (data raced): preview shows "Used by 0"; Link-all degenerates to create-only.
- **Ambiguous identity**: an existing component with the same normalized purl under a different provider/category still dedupes into Link mode — no override of its stored taxonomy in Phase 2 (the component's edit form handles correction).
- **Consumer retired between staging and accept**: accepting a suggestion on a `RETIRED` component is rejected or skipped with the failure reported in the partial-failure count.
- **Library component deleted after edges exist**: junction rows cascade per existing edge semantics; BOM entries' `resolvedComponentId` is cleared (`ON DELETE SET NULL`, already shipped).
- **Re-run after decisions**: decided pairs are never re-staged; still-pending pairs are not duplicated; new consumers of a decided library get their own pending rows.
- **Edge created by another path**: when a dependency edge comes to exist through any path (Link-all, Add-and-link, manual relationship authoring) while a suggestion for the same pair is pending, the suggestion flips to `SUPERSEDED` — never left actionable for an edge that already exists (ADR-113 parity).
- **Slug collision**: two packages slugify identically (`@scope/name` vs `scope-name`) — numeric suffixes keep slugs unique.
- **Unmapped ecosystem/type**: provider falls back to `OTHER`; unmapped `cdxType` still creates a component with the documented fallback and "Mapped from" note.
- **Flag OFF mid-session**: curation surfaces are hidden; queued suggestions remain valid data and appear when the flag is ON.
- **Lossy export unchanged**: export surfaces are Phase 1 scope; curation state does not alter exported BOM content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST add the 13 ecosystem values to the component-provider taxonomy via the three-way update (research/registry + shared constants + schema constraint migration), including the documented `ecosystem`→provider mapping (with `docker`/`oci` resolved from registry hostname) and the `cdxType`→category mapping, recorded in ADR-013 Amendment 2.
- **FR-002**: On every completed import run, the system MUST run a BOM matching pass that resolves reported BOM entries to catalog components by normalized purl identity and stages pending dependency suggestions with reason and score; failed/cancelled/interrupted runs MUST NOT trigger it, and no dependency edge MUST ever be created automatically.
- **FR-003**: The system MUST persist dependency suggestions with the ADR-113 lifecycle — only `PENDING` is actionable, decisions are terminal, and the (consuming component, library) pair is unique so decided pairs are never resurrected.
- **FR-004**: Editors MUST be able to preview and create one Library component per package (identity = normalized version-free purl) with derived name/category/provider/slug; the create-with-links operation MUST be atomic.
- **FR-005**: When a component already matches the package identity (normalized `externalId` equality across all providers/categories), the system MUST offer Link instead of create — linking all consumers or staging suggestions — and MUST never create a duplicate identity.
- **FR-006**: Accepting a suggestion (singly or in bulk) MUST create the dependency edge and mark the suggestion `ACCEPTED`; dismissing marks `DISMISSED`; bulk accept MUST be server-rejected unless every targeted suggestion is `PURL_EXACT`.
- **FR-007**: The UI MUST surface curation per UX-ADD/UX-SUG/UX-LIB: the Add/Link dialog with preview and "Mapped from" note, the dependency segment with grouped/bulk review and unchanged product-edge behaviour + nav pill, the In-catalog column states and `catalog` filter on the BOM tab and `/packages`, Show-libraries toggle, coverage exclusion, grouped provider filter, Library detail (Used by / Versions in use), and the Relationships libraries summary node with the bounded contract.
- **FR-008**: All write endpoints MUST require Editor+ (advisory-hiding UI, API-enforced); list/read endpoints stay Viewer-accessible and side-effect-free; every new/changed endpoint MUST be added to `docs/openapi.yaml` in the same change (ADR-104).
- **FR-009**: The feature MUST ship behind flag `bomCuration` flipping ON with a G38 gap-registry entry; OFF hides every curation surface.
- **FR-010**: Ratify **ADR-132** (promotion rules: Editor-only, Library identity = version-free purl, ADR-113-following suggestion queue, no auto-wiring) and land all documentation deltas in the same change: `docs/ux.md` (segments, surfaces, flag), `researches/ux-rewrite-gaps.md` (G38), `docs/roadmap.md`, vocabulary, and the coverage-spec amendment recording `LIBRARY` exclusion (UX-LIB-02).
- **FR-011**: The spec MUST ship Playwright coverage of the curation surface (dialog flows, suggestions queue, library legibility) per the testing principle, plus unit/integration tests for the matching pass, suggestion lifecycle, and atomic write paths.

### Key Entities *(include if feature involves data)*

- **BomComponentSuggestion**: a staged "component X depends on library Y" candidate — carries bomEntryId, parent/child component ids, reason (`PURL_EXACT` | `PURL_NAME_MATCH` | `CATALOG_SLUG_MATCH`), score, status (`PENDING` | `ACCEPTED` | `DISMISSED` | `SUPERSEDED`), decision timestamp/decider; unique per (parent, child).
- **Library Component**: a regular `Component` curated from package data — category derived from `cdxType` (usually `LIBRARY`), provider from `ecosystem`, `resourceType` = purl type, `externalId` = normalized version-free purl, slug `pkg-{type}-{name}`(+suffix). One per package workspace-wide.
- **Dependency edge** (`component_depends_on_component`, existing): the meaning-layer relationship created only by human accept/add/link actions.
- **ComponentProvider** additions: `NPM`, `PYPI`, `MAVEN`, `NUGET`, `GOLANG`, `CARGO`, `RUBYGEMS`, `PACKAGIST`, `GHCR`, `ECR`, `DEBIAN`, `RPM`, `ALPINE`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A curator can take a reported package from row menu to a linked Library component — preview, confirm, toast — in under 60 seconds.
- **SC-002**: A bulk accept on an exact-match group of N creates exactly N relationships with zero auto-created edges anywhere else; a failed bulk operation creates none.
- **SC-003**: A workspace with 1,000 Library components shows unchanged default Components list, unchanged coverage/dashboard numbers, and reveals libraries only via the toggle.
- **SC-004**: A component with 200+ library dependencies renders one summary node on Relationships within the bounded read — no library nodes drawn.
- **SC-005**: Phase-2 completion checks hold on seeded data: ≥1 `LIBRARY` component exists, ≥1 dependency edge exists via human action, `GET /components/:id/relationships` reports library deps via `libraryCounts` (Libraries are excluded from the normal `dependsOn`/`dependedOnBy` lanes per US5 legibility — accepted human-created edges still appear in the consumer's `dependsOn`), and the suggestion queue operates end-to-end (stage → group → decide → edge).
- **SC-006**: Re-running imports after decisions creates zero duplicate or resurrected suggestions for decided pairs.
- **SC-007**: ADR-132 is ratified and ADR-013 Amendment 2 landed; regenerated OpenAPI/docs checks pass in the same change.

## Assumptions

- Phase 1/1b contracts stand: `resolvedComponentId`/`pendingSuggestionId` on BOM rows and `catalogComponent`/`pendingSuggestionCount` on `/packages` are already shaped — this spec populates them rather than changing contract shape.
- The existing `edge_suggestions` implementation and `/suggestions` queue are the structural template; the dependency segment extends rather than forks it.
- "Exact match" for identity purposes uses the normalized version-free purl produced by the Phase 1 normalization pipeline (`purlIdentity`), applied symmetrically to `components.externalId` for match checks.
- Library components participate in normal component detail/edit/delete flows; only their list visibility, coverage accounting, relationships rendering, and detail-card composition differ.
- SBOM/package version data stays on `bom_entries`/instances; Library components carry no version field.
- Per-entry promote/wire routes are optional thin aliases and are not part of the tested surface.
- Viewers retain read access to all surfaces including suggestion history; only write items are hidden/rejected.
