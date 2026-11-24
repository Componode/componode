### ADR-131 — BomEntry entity: factual package inventory

> **Status:** Ratified (2026-11-21 grilling, spec 073)
> **Supersedes**: none
> **Amends**: ADR-057 (Amendment 1 — `bomEntries` field)

**Context**: Phase 1 of the SBOM / Bill of Materials programme gives every
component a *bill of materials* — the packages it contains (npm, PyPI, OS
packages, container layers, firmware). The data is factual inventory, not
graph structure, so it belongs beside `components`/`component_instances`,
never in an edge table. Requirements that shaped the model: nested
assemblies (image layer → OS package → language package), multiple
independent reporting Sources, replacement-on-success semantics with
preservation-on-failure, and a later curation phase that must not
invalidate Phase-1 rows.

**Decision**:

1. **`bom_entries` table** — one row per
   `(componentId, purl, scope, componentInstanceId, parentBomEntryId)`.
   `componentInstanceId` NULL = component-scoped entry; non-NULL binds the
   row to one instance. `parentBomEntryId` self-FK carries the reported
   tree — no flattening, arbitrary depth.
2. **Source-scoped diff-replace on COMPLETED runs** — a finished run
   replaces its Source's set inside each reported
   `(componentId, componentInstanceId)` scope: matching keys update in
   place (`lastReportedAt` bumps), absent keys are deleted. Failed,
   cancelled, and interrupted runs delete nothing.
3. **Field presence is per-scope completeness** (ADR-057 Amendment 1):
   `bomEntries` present — including `[]` — means "collection ran, this is
   the set"; absent means "collection not attempted or failed, keep prior
   rows". The distinction survives through remote runs the same way.
4. **Unique indexes use `NULLS NOT DISTINCT`** (Postgres 15+) so the NULL
   `componentInstanceId`/`parentBomEntryId` scopes participate in
   uniqueness — a plain UNIQUE would treat NULLs as distinct and allow
   duplicates.
5. **Dedupe key excludes `sourceId`** — one package reported by two
   Sources stays one row; the later report updates it and `sourceId`
   attribution reflects the latest writer (spec Q6).
6. **`direct` is authoritative for directness**; `TRANSITIVE` scope is
   retained for CycloneDX/SPDX round-trip fidelity. Explicit importer
   `direct` beats the `scope !== "TRANSITIVE"` default.
7. **`resolvedComponentId` is Phase-2 surface only** — nothing writes it
   in Phase 1; it reserves the future catalog-curation link so a migration
   is not needed later. *(Superseded by spec 075 / ADR-132: the column is
   now written by the Phase-2 matching pass — exact-identity matches
   only — and by the `/packages/add-to-catalog` / `/packages/link`
   curation endpoints.)*
8. **Run counters** — `import_runs` gains
   `packagesCreated/Updated/Unchanged/Removed`, dedupe-key diffs written
   at run completion on both in-process and remote paths.
9. **No native enum** — `scope`, `evidenceSource`, `cdxType` are text
   columns with CHECK constraints driven from `packages/core` constants,
   per the project rule.

**Consequences**: stale-detection is honest (`lastReportedAt` per row and
per Source drives the UI warning), exports can stream arbitrary depth
without join recursion client-side, and Phase-2 curation attaches without
re-keying. Accepted costs: a scope-drifting package occupies a second row
by design (the key is the contract), and lossy export mappings are
restored via namespaced `componode:*` CycloneDX properties rather than a
lossless native field.

---

### Amendment 2 — `purlIdentity` column + where-used reads (spec 074)

Phase 1b (packages explorer) adds a **stored** `purlIdentity` text column —
the normalized, version-free purl computed at write time with the same
`normalizePurlIdentity` helper Phase 2 uses for Library `externalId`
matching (strip version/qualifiers/subpath, per-type normalization).
Decision: identity is computed once on write, not per read query — one
normalization path, an index the rollup and consumers queries actually
use, and the Phase-2 promotion flow reuses the column without re-deriving.
Migration 034 backfills from verbatim `purl` (unparseable rows fall back
to the verbatim value so nothing is dropped), then sets `NOT NULL` and
indexes it. The where-used reads (`GET /packages`,
`GET /packages/consumers`, the search Packages group) group on
`purlIdentity` and join **ACTIVE components only** — retired components
keep their rows but don't inflate "where is it used".

---

### Amendment 3 — `resolvedComponentId` is live (spec 075)

Phase 2 (ADR-132) gives the reserved column its writers: the
run-completion matching pass sets it on **exact-identity matches only**
(`purlIdentity` = component `externalId`, normalized — fuzzy name/slug
matches stage suggestions instead, never resolve), and the
`/packages/add-to-catalog` / `/packages/link` curation endpoints set it on
every entry of the identity — Link re-points deliberately when a different
component is chosen. BOM rows stay factual: the link is a pointer to
curated catalog data, never a graph edge on the row itself.

---

### Amendment 4 — product-level package roll-up reads (spec 080)

The Packages tab on product detail is a **derived projection, never a
persisted roll-up entity**: `GET /products/:slug/packages` groups
`bom_entries` on `purlIdentity` across the product's full reachable
component set — direct `DEPENDS_ON` component edges, component-group
member expansion, and `COMPOSES`-descendant inheritance — and
`GET /products/:slug/packages/consumers` attributes each contributing
component with its reachability source (direct / group / inherited).
Consistent with Amendment 2, the aggregation joins ACTIVE components
only: retired contributing components keep their rows but neither
inflate the roll-up nor produce a declared marker; the declared signal
itself is reachability of the matched Library component through the
same edge set. Both routes are `verifySession` reads — inventory-only
posture, no mutation surface.
