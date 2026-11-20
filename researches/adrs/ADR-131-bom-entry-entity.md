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
   is not needed later.
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
