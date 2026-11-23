### ADR-132 — Catalog promotion of BOM entries: Editor-only curation

> **Status:** Ratified (spec 075)
> **Supersedes**: none
> **Amends**: ADR-013 (Amendment 2 — ecosystem providers), ADR-131
> (`resolvedComponentId` gains writers), ADR-019 (human-decided extends to
> component→library pairs)

**Context**: Phase 1 (spec 073) landed `bom_entries` as factual, importer-
written package inventory and Phase 1b (spec 074) shipped the `/packages`
where-used rollup with `catalogComponent`/`pendingSuggestionCount` held
inert. Phase 2 turns that inventory into curated catalog meaning: a BOM
entry's package should be able to *become* a catalog Component that
consumers `DEPENDS_ON`. The tensions: identity must never duplicate (one
component per package across providers/categories), graph writes stay
human per constitution V and ADR-113, and thousands of promoted libraries
must not bury the catalog.

**Decision**:

1. **Human curation only — no auto-wiring, ever.** A run-completion
   matching pass may *resolve* identities and *stage* suggestions, but
   only a human accept (suggestion decide, Link-all, Add-and-link) writes
   `component_depends_on_component`. Even `PURL_EXACT` — the strongest
   possible match — produces a suggestion, not an edge.
2. **Library identity is the normalized version-free purl**, stored
   verbatim in `components.externalId` (the `purlIdentity` column value —
   version/qualifiers/subpath stripped, per-type normalization). One
   Library per identity workspace-wide; **dedupe is service-layer**
   normalized-identity equality across **all** providers and categories —
   `components.externalId` carries no DB unique constraint. Versions never
   live on the Library component (they stay on the consumers' BOM rows).
3. **Curation endpoints are Editor-only writes.** `POST
   /packages/add-to-catalog` and `POST /packages/link` are atomic: set
   `resolvedComponentId` on every entry of the identity, then wire all
   consumer edges (`ON CONFLICT DO NOTHING`, per-edge audit) **or** stage
   `PURL_EXACT` suggestions per `linkConsumers` — never both, never
   neither. `409` on an already-covered identity (Link instead); the
   preview read (`GET /packages/add-to-catalog/preview`) is any-role.
   Writes gate on the new `component:edge:add` permission (EDITOR) —
   creating a Library and wiring consumers *is* edge authoring.
4. **`bom_component_suggestions` follows the ADR-113 lifecycle
   verbatim** — one row per `(parentComponentId, childComponentId)` pair,
   reasons `PURL_EXACT` | `PURL_NAME_MATCH` | `CATALOG_SLUG_MATCH`,
   centi-score, `PENDING` the only actionable state, `ACCEPTED`/
   `DISMISSED`/`SUPERSEDED` terminal, `SUPERSEDED` tombstones carry NULL
   reason/score, decided pairs never resurrect.
5. **Supersede parity with the edge queue.** Accepting a suggestion whose
   pair is already wired lands `SUPERSEDED`, not `ACCEPTED`; a pair
   gaining an edge by other means (manual authoring) tombstones in the
   same transaction. The one deliberate exception: **Link-all is itself
   the human's decide** — a covered `PENDING` row lands `ACCEPTED`.
   Bulk accept is server-gated to all-`PURL_EXACT` groups; bulk dismiss
   takes any reason.
6. **`resolvedComponentId` writers** are the matching pass (exact-identity
   matches only — a fuzzy name/slug match stages a suggestion without
   resolving) and the curation endpoints (which re-point deliberately when
   a different component is chosen). ADR-131 §7 is amended accordingly.
7. **Slug scheme `pkg-{type}-{name}`** slugified (`@scope/name` →
   `pkg-npm-scope-name`) with a numeric `-2`, `-3`… suffix on collision
   (ADR-046). `category` maps from `cdxType`, `provider` from `ecosystem`
   (ADR-013 Amendment 2's 13 package-registry values), `resourceType` is
   `{purlType}:package`. Curated components have no importer source —
   provenance is `createdBy` + audit.
8. **Library legibility** — `LIBRARY`-category components are excluded
   from the default `/components` population (opt-in `libraries=1`, the
   response reports `librariesHidden`), from the coverage population and
   dashboard denominators (UX-LIB-02, spec 023 amendment), and from the
   `dependsOn`/`dependedOnBy` relationship lanes (bounded `libraryCounts`
   carries the totals).

**Consequences**: the meaning layer fills from real BOM data without a
single non-human edge write; the dependency segment on `/suggestions`
reuses every queue convention (PENDING/decided views, RETIRED-endpoint
read-side filtering, sort mapping); migration 035 adds the suggestion
table and 036 rebuilds the provider CHECK for the 13 new values. Accepted
costs: service-layer dedupe means the "one component per identity"
invariant is guarded by the curation path and the match pass rather than
a constraint (consistent with `externalId` being importer-managed), and
name/slug matches require per-row human review because bulk accept is
exact-only by design.

**Alternatives considered**: auto-wiring `PURL_EXACT` pairs on run
completion — rejected outright (violates constitution V / ADR-113's
ratified "candidates, never edges" stance). Storing the package version
on the Library component — rejected (version is per-consumer fact, not
identity; the preview/`versions` reads aggregate it). A DB unique
constraint on `externalId` — rejected (`externalId` semantics are
provider-scoped for importers; normalized purl identity is a curation
domain, enforced where curation happens).

> **Shipped in spec `075-bom-catalog-promotion`**: matching pass invoked
> on completed runs (in-process and remote), the Add/Link curation
> endpoints + dialog, the `kind=dependency` segment with grouped bulk
> review, library legibility surfaces, and the `bomCuration` flag ON
> (gap G38 resolved). Phase 3 (importer-native declared edges) remains a
> separate spec.
