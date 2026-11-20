# SBOM / Bill of Materials — Architecture Research

**Purpose:** Define the architecture and data model for introducing
Software Bill of Materials (SBOM) / Bill of Materials (BoM) support into
Componode DPAM. Every component (repository, container, server, API) is
itself composed of sub-components: npm packages, Python modules, OS packages,
firmware, Go modules, Maven dependencies, etc. This research defines how to
catalog that layer in a way that is scalable across all 25 existing component
categories and all future ones.

**Scope:** Data model, importer contract extension, CycloneDX / SPDX
bidirectional compatibility, three-phase rollout strategy, **UX requirements**
(see [UX Requirements](#ux-requirements)), and ADR impact.
This document is informative — where findings conflict with a ratified ADR the
conflict is flagged explicitly, not silently overridden. Claims are grounded in
the actual codebase state at the time of writing (2026-11-20).

**Status:** Research complete — ready for `speckit-specify` (Phase 1 first).
Revised 2026-11-20 with the accepted UX review: the **UX Requirements** section
is normative input to every spec, and four contract changes it requires are
applied in place below and marked *(UX amendment)*: a paginated BOM read,
`direct` and `lastReportedAt` on `bom_entries`, "Add to catalog" / "Link"
instead of "promote" / "wire", and a Phase 1b where-used explorer.

**Conflicts with ratified ADRs:** None. The recommended approach formally
amends ADR-057 and ADR-013 through the standard Amendment mechanism rather
than overriding them. The prohibition on `relationships[]` in ADR-057 is not
violated — `bomEntries` is a categorically different concept (factual inventory,
not graph edge declaration) and the amendment makes this explicit.

---

## Existing Foundation (Codebase State 2026-11-20)

The following elements already exist and require no structural changes:

| Element | Location | Status |
|---|---|---|
| `LIBRARY` ComponentCategory | `packages/core/src/constants/component-categories.ts` | Exists, no importer populates it |
| `component_depends_on_component` junction table | migration 001 | Exists, zero writers |
| Relationships read endpoint `GET /components/:id/relationships` | spec 060 | Fully implemented, lanes show honest empty states |
| `edge_suggestions` / `runSuggestionPass` pattern | ADR-113 | Fully implemented — reused for BOM suggestions in Phase 2 |
| `ComponentGroup` auto-managed pattern | ADR-129 | Reused as prior art for importer-managed entities |
| Component detail tabs + read-only Relationships tab behind `componentRelationships` | `packages/frontend/src/ux/components/catalog/`, `ux/lib/flags.ts` | Shipped (spec 060, ADR-128) — the BOM tab follows this tab's conventions |
| Suggestions queue (Pending / History, terminal decisions) | `ux/app/suggestions.tsx`, `suggestion-queue.tsx` | Shipped (ADR-113) — extended with a dependency segment in Phase 2 |
| `/components/:slug/promote` (component → Platform product) | `ux/components/components/promote-form.tsx` | Shipped — **owns the word "promote"**; BOM curation therefore uses "Add to catalog" |
| Schema-driven importer forms + GitHub `CapabilityNotice` | `ux/components/importers/` | Shipped (spec 072) — BOM toggles and `bomInventory` capability reuse them |
| Server-paginated lists, `useListState`, `ListToolbar`, `ListPagination` | `ux/components/` | Shipped (spec 068, ADR-130) — every BOM list must follow it |
| Gap flags + gap registry | `ux/lib/flags.ts`, `researches/ux-rewrite-gaps.md` | Shipped (`docs/ux.md` §7) — each phase adds a flag and a gap entry |

The gap is: no importer yields package inventory data, and there is no typed
storage layer for it. `DiscoveredAsset.relationships[]` was explicitly removed
from v1 (ADR-057, line 31 of `packages/core/src/contracts/discovered-asset.ts`)
— not reserved, removed — and cannot be re-added without a formal amendment.

---

## Five Design Principles

1. **BOM data is factual, never curated.** `bom_entries` rows are written
   exclusively by importers, like `rawConfig` on a ComponentInstance. Humans
   promote entries to catalog Components and wire edges; they never author
   `bom_entries` directly.

2. **purl is the canonical package identity.** Every `bom_entry` carries a
   Package URL (`pkg:npm/lodash@4.17.21`). purl is shared by CycloneDX, SPDX,
   Dependabot, Trivy, Syft, and GitHub dependency graph — it is the universal
   interoperability key and encodes name + version + ecosystem without
   schema proliferation.

3. **`bomEntries` on `DiscoveredAsset` is factual inventory, not a relationship
   declaration.** ADR-057 removed `relationships[]` to avoid importer-declared
   graph edges that require human curation (cycle risk, ownership ambiguity).
   Package inventory is observational data like `details` JSONB and `rawConfig`,
   not a semantic edge. The amendment clarifies this explicitly.

4. **Library Components follow the same lifecycle as all Components.** A
   promoted `LIBRARY`-category component is a full first-class `Component` row —
   same reconciliation, source membership, lifecycle, and graph as any component.
   No shadow table.

5. **BOM inventory drives relationship discovery; it never auto-wires edges.**
   When a BOM entry matches a catalog Component, a suggestion (ADR-113 pattern)
   is generated. A human accepts it. No automatic `component_depends_on_component`
   row is ever created (until Phase 3, which is a separate ADR).

These are data principles. The matching UX principles (inventory is fact,
scale first, reuse before inventing, never imply security posture, keep the
catalog legible, be honest about freshness) are under
[Design Principles (UX)](#design-principles-ux).

---

## Phase 1 — BOM Inventory

### Goal

Importers can yield package inventory for any component. The system stores it
in a typed, queryable `bom_entries` table with full tree structure (supporting
nested/multi-layer assemblies). A read API surfaces it. CycloneDX and SPDX
documents can be ingested and exported. No changes to the Component graph.

**Phase 1 is complete when:**
- `bom_entries` table is live and populated by at least one real importer
- `GET /components/:id/bom` returns real data
- CycloneDX JSON and SPDX JSON ingest both work via `importer-sbom-file`
- CycloneDX and SPDX export work via `?format=cyclonedx` / `?format=spdx`
- ADR-057 Amendment 1 is ratified
- Nested assemblies (multi-layer containers) are stored with correct tree depth
- *(UX amendment)* The component detail page has a **Bill of materials** tab
  behind the `componentBom` flag, with summary, filters, flat/tree views,
  server-side pagination, honest loading/empty/error/stale states, and export,
  all meeting the MUST requirements in [UX Requirements](#ux-requirements)
- *(UX amendment)* The GitHub and SBOM-file importer forms expose the new
  options and the `bomInventory` capability notice

---

### New enum constants

**`packages/core/src/constants/bom-entry.ts`** — new file:

```typescript
// Dependency scope — maps to CycloneDX component.scope and SPDX relationship types
export const BOM_DEPENDENCY_SCOPES = [
  "RUNTIME",    // required at runtime; CycloneDX "required"; SPDX RUNTIME_DEPENDENCY_OF
  "DEV",        // development-only; SPDX DEV_DEPENDENCY_OF
  "BUILD",      // build-time only; SPDX BUILD_DEPENDENCY_OF
  "TEST",       // test execution only; SPDX TEST_DEPENDENCY_OF
  "SYSTEM",     // OS-level: kernel module, firmware, OS library
  "OPTIONAL",   // declared optional; CycloneDX "optional"; SPDX OPTIONAL_DEPENDENCY_OF
  "BUNDLED",    // vendored / embedded; SPDX DYNAMIC_LINK or STATIC_LINK
  "TRANSITIVE", // indirect, not declared directly by subject
] as const;
export type BomDependencyScope = typeof BOM_DEPENDENCY_SCOPES[number];

// How the entry was detected
export const BOM_EVIDENCE_SOURCES = [
  "LOCK_FILE",     // package-lock.json, Pipfile.lock, go.sum, Cargo.lock, etc.
  "MANIFEST_FILE", // package.json, requirements.txt, pom.xml, etc.
  "SBOM_DOCUMENT", // ingested CycloneDX or SPDX document
  "IMAGE_LAYER",   // extracted from container image layer (Syft/Trivy/OCI Referrers)
  "REGISTRY_API",  // fetched from a package registry API (GitHub dep graph, etc.)
  "VCS_ANALYSIS",  // inferred from repository file analysis
] as const;
export type BomEvidenceSource = typeof BOM_EVIDENCE_SOURCES[number];

// CycloneDX component.type values — stored for round-trip fidelity; also drives
// ComponentCategory when a bom_entry is promoted to a full Component (Phase 2)
export const BOM_CDX_TYPES = [
  "library", "framework", "container", "device", "firmware", "file",
  "machine-learning-model", "data", "operating-system", "platform",
  "application", "service",
] as const;
export type BomCdxType = typeof BOM_CDX_TYPES[number];
```

---

### `bom_entries` table — with tree structure

The critical design decision is **`parentBomEntryId`** — a self-referential FK
that enables a tree of arbitrary depth within one component's BOM. This maps
directly to CycloneDX `component.components[]` (nested sub-assemblies) and SPDX
`CONTAINS` / `CONTAINED_BY` relationships.

**Migration `032_bom_entries.ts`:**

```sql
CREATE TABLE bom_entries (
  id                    uuid PRIMARY KEY,
  "componentId"         uuid NOT NULL
    REFERENCES components(id) ON DELETE CASCADE,
  "componentInstanceId" uuid
    REFERENCES component_instances(id) ON DELETE CASCADE,

  -- Tree structure for nested assemblies (CycloneDX component.components[],
  -- SPDX CONTAINS relationships). NULL = top-level entry for this component.
  "parentBomEntryId"    uuid
    REFERENCES bom_entries(id) ON DELETE CASCADE,

  purl                  text NOT NULL,   -- e.g. pkg:npm/lodash@4.17.21
  name                  text NOT NULL,
  version               text,
  ecosystem             text NOT NULL,   -- purl type fragment: npm, pypi, deb, rpm …

  scope                 text NOT NULL
    CHECK (scope IN ('RUNTIME','DEV','BUILD','TEST','SYSTEM','OPTIONAL','BUNDLED','TRANSITIVE')),

  "evidenceSource"      text NOT NULL
    CHECK ("evidenceSource" IN ('LOCK_FILE','MANIFEST_FILE','SBOM_DOCUMENT','IMAGE_LAYER','REGISTRY_API','VCS_ANALYSIS')),
  "evidenceDetail"      text,

  supplier              text,
  licenses              jsonb NOT NULL DEFAULT '[]',  -- SPDX expressions

  -- (UX amendment) directness is independent of scope; see UX Requirements Q4
  direct                boolean NOT NULL DEFAULT false,
  -- (UX amendment) bumped on every report of this entry; drives freshness UX
  "lastReportedAt"      timestamptz NOT NULL DEFAULT now(),

  -- CycloneDX round-trip fields
  "cdxType"             text,    -- BomCdxType; drives ComponentCategory on promotion
  "cdxBomRef"           text,    -- for intra-document dependency resolution

  "importRunId"         uuid REFERENCES import_runs(id) ON DELETE SET NULL,
  "sourceId"            uuid REFERENCES importer_sources(id) ON DELETE SET NULL,
  "resolvedComponentId" uuid REFERENCES components(id) ON DELETE SET NULL,  -- Phase 2

  details               jsonb,   -- CPE, checksums, SPDX-specific fields
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);

-- Top-level idempotent upsert key (parentBomEntryId IS NULL)
CREATE UNIQUE INDEX bom_entries_top_level_upsert_key
  ON bom_entries ("componentId", purl, scope, "componentInstanceId")
  WHERE "parentBomEntryId" IS NULL;

-- Child-level idempotent upsert key
CREATE UNIQUE INDEX bom_entries_child_upsert_key
  ON bom_entries ("componentId", purl, scope, "componentInstanceId", "parentBomEntryId")
  WHERE "parentBomEntryId" IS NOT NULL;

CREATE INDEX bom_entries_component_idx    ON bom_entries ("componentId");
CREATE INDEX bom_entries_instance_idx     ON bom_entries ("componentInstanceId");
CREATE INDEX bom_entries_parent_idx       ON bom_entries ("parentBomEntryId");
CREATE INDEX bom_entries_purl_idx         ON bom_entries (purl);       -- cross-component CVE impact
CREATE INDEX bom_entries_resolved_idx     ON bom_entries ("resolvedComponentId");
CREATE INDEX bom_entries_source_idx       ON bom_entries ("sourceId");
CREATE INDEX bom_entries_ecosystem_idx    ON bom_entries (ecosystem);
```

**Tree traversal query:**

```sql
WITH RECURSIVE bom_tree AS (
  SELECT *, 0 AS depth, ARRAY[id] AS path
  FROM bom_entries
  WHERE "componentId" = $1 AND "parentBomEntryId" IS NULL
  UNION ALL
  SELECT e.*, t.depth + 1, t.path || e.id
  FROM bom_entries e
  JOIN bom_tree t ON e."parentBomEntryId" = t.id
  WHERE NOT (e.id = ANY(t.path))  -- defensive cycle guard
)
SELECT * FROM bom_tree ORDER BY depth, name;
```

**Multi-layer container example (concrete tree):**

```
bom_entry [id=A]  purl=pkg:deb/debian@bullseye  scope=SYSTEM  parent=NULL
  bom_entry [id=B]  purl=pkg:deb/libssl1.1@1.1.1n  scope=SYSTEM  parent=A
  bom_entry [id=C]  purl=pkg:deb/libc6@2.31  scope=SYSTEM  parent=A
bom_entry [id=D]  purl=pkg:pypi/python@3.11.0  scope=RUNTIME  parent=NULL
  bom_entry [id=E]  purl=pkg:pypi/pip@23.0.1  scope=RUNTIME  parent=D
bom_entry [id=F]  purl=pkg:pypi/flask@2.3.2  scope=RUNTIME  parent=NULL
  bom_entry [id=G]  purl=pkg:pypi/werkzeug@2.3.6  scope=TRANSITIVE  parent=F
```

---

### `DiscoveredAsset` extension (ADR-057 Amendment 1)

**`packages/core/src/contracts/discovered-asset.ts`** — additions:

```typescript
export interface DiscoveredBomEntry {
  purl: string;                        // required: canonical Package URL
  name: string;                        // required: human-readable name
  evidenceSource: BomEvidenceSource;   // required

  evidenceDetail?: string | null;
  version?: string | null;
  scope?: BomDependencyScope;         // defaults to RUNTIME
  licenses?: string[];                // SPDX expressions
  supplier?: string | null;
  cdxType?: BomCdxType | null;        // CycloneDX component.type (round-trip)
  cdxBomRef?: string | null;          // CycloneDX bomRef
  children?: DiscoveredBomEntry[];    // CycloneDX component.components[] / SPDX CONTAINS
  details?: Record<string, unknown> | null;  // CPE, checksums, etc.
}

export interface DiscoveredAsset {
  // ... all existing fields unchanged ...

  // ADR-057 Amendment 1 — package/software/firmware inventory.
  // Factual observational data (like details/rawConfig), NOT a graph edge.
  bomEntries?: DiscoveredBomEntry[];
}
```

---

### CycloneDX / SPDX bidirectional mapping

#### CycloneDX → `DiscoveredBomEntry` (ingest)

| CycloneDX field | `DiscoveredBomEntry` field | Notes |
|---|---|---|
| `component.purl` | `purl` | Direct |
| `component.name` | `name` | Direct |
| `component.version` | `version` | Direct |
| `component.type` | `cdxType` | Stored; drives `ComponentCategory` on promotion |
| `component.scope` | `scope` | See scope mapping below |
| `component.licenses[].expression` | `licenses[]` | SPDX expressions |
| `component.supplier.name` | `supplier` | Direct |
| `component.bomRef` | `cdxBomRef` | For intra-document resolution |
| `component.hashes[]` | `details.checksums` | JSONB overflow |
| `component.cpe` | `details.cpe` | JSONB overflow |
| `metadata.tools[].name` | `evidenceDetail` | "syft@0.86.1,trivy@0.45.0" |
| `component.components[]` | `children[]` | Recursive nesting |

**CycloneDX `scope` → `BomDependencyScope`:**

| CycloneDX `scope` | `BomDependencyScope` |
|---|---|
| `required` | `RUNTIME` (default; refine from `dependencies[]` if present) |
| `optional` | `OPTIONAL` |
| `excluded` | `DEV` |
| _(absent)_ | `RUNTIME` |

**`BomDependencyScope` → CycloneDX `scope` (reverse / export):**

| `BomDependencyScope` | CycloneDX `scope` | Note |
|---|---|---|
| `RUNTIME` | `required` | |
| `BUILD` | `excluded` | Granularity lost on export; preserved internally |
| `DEV` | `excluded` | |
| `TEST` | `excluded` | |
| `OPTIONAL` | `optional` | |
| `BUNDLED` | `required` | |
| `SYSTEM` | `required` | |
| `TRANSITIVE` | `required` | |

#### SPDX → `DiscoveredBomEntry` (ingest)

| SPDX field | `DiscoveredBomEntry` field |
|---|---|
| `externalRefs[referenceType=purl].referenceLocator` | `purl` |
| `name` | `name` |
| `versionInfo` | `version` |
| `licenseConcluded` | `licenses[0]` |
| `supplier` | `supplier` (strip `"Organization:"` prefix) |
| Relationship type (see below) | `scope` or tree nesting |
| `checksums[]` | `details.checksums` |
| `downloadLocation` | `details.downloadLocation` |
| `SPDXID` | `cdxBomRef` |

**SPDX `relationshipType` → `BomDependencyScope`:**

| SPDX `relationshipType` | `BomDependencyScope` | Notes |
|---|---|---|
| `RUNTIME_DEPENDENCY_OF` | `RUNTIME` | |
| `DEV_DEPENDENCY_OF` | `DEV` | |
| `BUILD_DEPENDENCY_OF` | `BUILD` | |
| `TEST_DEPENDENCY_OF` | `TEST` | |
| `OPTIONAL_DEPENDENCY_OF` | `OPTIONAL` | |
| `OPTIONAL_COMPONENT_OF` | `OPTIONAL` | |
| `DEPENDS_ON` | `RUNTIME` | Generic; default |
| `DEPENDENCY_OF` | `RUNTIME` | Inverse; default |
| `DEV_TOOL_OF` | `DEV` | |
| `BUILD_TOOL_OF` | `BUILD` | |
| `TEST_TOOL_OF` | `TEST` | |
| `PROVIDED_DEPENDENCY_OF` | `OPTIONAL` | |
| `DYNAMIC_LINK` | `RUNTIME` | |
| `STATIC_LINK` | `BUNDLED` | Statically linked = bundled |
| `CONTAINS` | _(nesting)_ | Use `parentBomEntryId` tree |
| `CONTAINED_BY` | _(nesting)_ | Child of referenced entry |
| `DESCRIBES` | _(subject)_ | Identifies the BOM subject / Component |

**`BomDependencyScope` → SPDX `relationshipType` (reverse / export):**

| `BomDependencyScope` | SPDX `relationshipType` |
|---|---|
| `RUNTIME` | `RUNTIME_DEPENDENCY_OF` |
| `DEV` | `DEV_DEPENDENCY_OF` |
| `BUILD` | `BUILD_DEPENDENCY_OF` |
| `TEST` | `TEST_DEPENDENCY_OF` |
| `OPTIONAL` | `OPTIONAL_DEPENDENCY_OF` |
| `BUNDLED` | `DYNAMIC_LINK` |
| `SYSTEM` | `RUNTIME_DEPENDENCY_OF` |
| `TRANSITIVE` | `DEPENDENCY_OF` |

Nesting (`parentBomEntryId`) exports as `CONTAINS` relationships in SPDX.
SPDX relationships are expressed as "pkg is X_OF subject" (the related element
is the predicate object), which is the inverse of how they read in English.

---

### Importer capabilities (Phase 1)

#### GitHub — `includeDependencyGraph: true`

Calls `GET /repos/{owner}/{repo}/dependency-graph/sbom` (GitHub SPDX 2.3).
Fallback: read and parse lock files from the default branch via Contents API.

| File | Ecosystem | Evidence source |
|---|---|---|
| `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | npm | `LOCK_FILE` |
| `Pipfile.lock`, `poetry.lock` | pypi | `LOCK_FILE` |
| `go.sum` | golang | `LOCK_FILE` |
| `Cargo.lock` | cargo | `LOCK_FILE` |
| `pom.xml` | maven | `MANIFEST_FILE` |
| `*.csproj` | nuget | `MANIFEST_FILE` |
| `Gemfile.lock` | rubygems | `LOCK_FILE` |

#### Docker — `includeSbom: true`

1. OCI Referrers API for SBOM attestations (CycloneDX or SPDX)
2. Fallback: Syft subprocess on Import Agent host

`cdxType="container"` entries with `component.components[]` produce the
multi-layer tree. Evidence source: `IMAGE_LAYER`.

#### `importer-sbom-file` (new package)

Reads a CycloneDX JSON or SPDX JSON file from a URL (`sbomUrl` config). Format
auto-detected: `bomFormat === "CycloneDX"` → CycloneDX parser; `spdxVersion`
present → SPDX parser.

#### Kubernetes — `includePodImageSbom: true`

For each pod, extracts container image refs from `containers[].image`, calls
OCI Referrers API per image, populates `bomEntries` on the workload asset.
`evidenceDetail` = `"k8s:pod-spec:image:{image_ref}"`.

---

### New API surface (Phase 1)

**`GET /components/:id/bom`**

```
Query params:
  ?scope=RUNTIME,SYSTEM        (multi-value, OR)
  ?ecosystem=npm,pypi           (multi-value, OR)
  ?instanceId={uuid}
  ?depth=0                      (0 = flat; default = full tree)
  ?format=json | cyclonedx | spdx

Response (Componode JSON): { entries: BomEntry[] (tree via children[]) }
Response (CycloneDX):      CycloneDX 1.5 JSON
Response (SPDX):           SPDX 2.3 JSON
```

**`GET /component-instances/:id/bom`** — instance-scoped BOM.

Both endpoints added to `docs/openapi.yaml` in the same change (ADR-104).

> **(UX amendment)** The unpaginated "full tree" response above does not
> survive real inventories (a single container can hold thousands of
> packages). For `format=json` the endpoint MUST be server-paginated per
> ADR-130 (`{ items, total, limit, offset }`, `limit` default 50, max 200),
> support `search`, `direct`, `licenseId`, `sort`/`order`, and `parentId`
> (lazy children for the tree view), and a companion summary read
> (`GET /components/:id/bom/summary`) supplies the header counts and per-Source
> freshness. `cyclonedx` / `spdx` exports stay unpaginated and stream. The
> exact parameter and response shapes are normative in
> [BOM Read Contract Required by the UX](#bom-read-contract-required-by-the-ux).

---

### Cross-component impact queries (enabled by purl index)

```sql
-- "Which components in my catalog use lodash?"
SELECT DISTINCT c.id, c.name, c.category, be.version, be.scope
FROM bom_entries be
JOIN components c ON c.id = be."componentId"
WHERE be.purl = 'pkg:npm/lodash' AND c.lifecycle = 'ACTIVE';

-- "Which versions of OpenSSL appear across all containers?"
SELECT be.purl, be.version, c.name AS component, be.scope
FROM bom_entries be
JOIN components c ON c.id = be."componentId"
WHERE be.purl LIKE 'pkg:openssl/%'
ORDER BY be.version, c.name;

-- "Blast radius of CVE affecting pkg:pypi/cryptography@40.0.0"
SELECT DISTINCT c.id, c.name, dp.id AS product_id, dp.name AS product
FROM bom_entries be
JOIN components c ON c.id = be."componentId"
LEFT JOIN product_depends_on_component pdc ON pdc."componentId" = c.id
LEFT JOIN digital_products dp ON dp.id = pdc."productId"
WHERE be.purl = 'pkg:pypi/cryptography@40.0.0';
```

A future `GET /bom/impact?purl=...` endpoint exposes this in the UI.

---

## Phase 2 — Catalog Promotion

### Goal

BOM entries that match catalog Components generate suggestions (ADR-113 pattern).
Curators promote unmatched entries to new `LIBRARY` Components and wire
`component_depends_on_component` edges. The spec 060 Relationships tab shows
real data for the first time.

**Phase 2 is complete when:**
- At least one `LIBRARY` Component exists in the catalog
- `component_depends_on_component` has at least one row (via wire action)
- `GET /components/:id/relationships` shows dependencies in `dependsOn[]`
- `bom_component_suggestions` queue is operational
- ADR-131 and ADR-132 ratified

---

### ComponentProvider taxonomy additions

New values to `packages/core/src/constants/component-providers.ts`:

| Value | Label | Description |
|---|---|---|
| `NPM` | npm | JavaScript packages from the npm registry |
| `PYPI` | PyPI | Python packages from PyPI |
| `MAVEN` | Maven | Java/JVM packages from Maven Central |
| `NUGET` | NuGet | .NET packages from NuGet.org |
| `GOLANG` | Go modules | Go packages from the Go module proxy |
| `CARGO` | Cargo | Rust packages from crates.io |
| `RUBYGEMS` | RubyGems | Ruby packages from rubygems.org |
| `PACKAGIST` | Packagist | PHP packages from Packagist |
| `GHCR` | GitHub Container Registry | Container images from GHCR |
| `ECR` | Amazon ECR | Container images from AWS ECR |
| `DEBIAN` | Debian apt | OS packages from Debian/Ubuntu apt |
| `RPM` | RPM | OS packages from Red Hat/Fedora RPM |
| `ALPINE` | Alpine apk | OS packages from Alpine Linux apk |

Requires DB migration (033) to update the CHECK constraint on `components.provider`
per ADR-013 Amendment 2.

**`ecosystem` → `ComponentProvider` mapping (used during promotion):**

| `ecosystem` | `ComponentProvider` |
|---|---|
| `npm` | `NPM` |
| `pypi` | `PYPI` |
| `maven` | `MAVEN` |
| `nuget` | `NUGET` |
| `golang` | `GOLANG` |
| `cargo` | `CARGO` |
| `gem` | `RUBYGEMS` |
| `composer` | `PACKAGIST` |
| `deb` | `DEBIAN` |
| `rpm` | `RPM` |
| `apk` | `ALPINE` |
| `docker` / `oci` | `DOCKER` or `GHCR` / `ECR` (from registry hostname) |
| _(other)_ | `OTHER` |

**`cdxType` → `ComponentCategory` mapping (used during promotion):**

| `cdxType` | `ComponentCategory` | Notes |
|---|---|---|
| `library` | `LIBRARY` | |
| `framework` | `LIBRARY` | Frameworks are a subtype |
| `container` | `CONTAINER` | Base image layers |
| `device` | `COMPUTE` | No `DEVICE` category yet — use COMPUTE |
| `firmware` | `COMPUTE` | No `FIRMWARE` category yet — use COMPUTE |
| `operating-system` | `COMPUTE` | |
| `platform` | `COMPUTE` | |
| `application` | `COMPUTE` | |
| `service` | `API` | |
| `file` | `STORAGE` | |
| `data` | `STORAGE` | |
| `machine-learning-model` | `LIBRARY` | |

---

### Library Component identity convention

| Field | Value | Rationale |
|---|---|---|
| `category` | From `cdxType` → `ComponentCategory` | Semantic type |
| `provider` | From `ecosystem` → `ComponentProvider` | Registry source |
| `resourceType` | purl type verbatim: `npm:package` | ADR-013 convention |
| `externalId` | **Version-free purl**: `pkg:npm/lodash` | One Component per package |
| `name` | Package name: `lodash` | |

One catalog Component per package (logical identity); version lives in
`ComponentInstance.version` and `bom_entries.version`. Matches how `REPOSITORY`
Components work.

---

### `bom_component_suggestions` table (migration 034)

Follows the exact structure of `edge_suggestions` (ADR-113):

```sql
CREATE TABLE bom_component_suggestions (
  id                    uuid PRIMARY KEY,
  "bomEntryId"          uuid NOT NULL REFERENCES bom_entries(id) ON DELETE CASCADE,
  "parentComponentId"   uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  "childComponentId"    uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  reason                text NOT NULL
    CHECK (reason IN ('PURL_EXACT', 'PURL_NAME_MATCH', 'CATALOG_SLUG_MATCH')),
  score                 integer,
  status                text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED')),
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "decidedAt"           timestamptz,
  "decidedBy"           uuid REFERENCES persons(id) ON DELETE SET NULL,
  UNIQUE ("parentComponentId", "childComponentId")
);
```

Same terminal-state semantics as `edge_suggestions`: only PENDING is actionable;
ACCEPTED/DISMISSED/SUPERSEDED are final. `(parentComponentId, childComponentId)`
unique constraint — once a pair is decided it is never resurrected.

---

### BOM matching pass

Triggered at run completion alongside `runSuggestionPass` and `runAutoGroupPass`.
Finds unresolved `bom_entries` → matches against catalog Components →
sets `resolvedComponentId` → creates `bom_component_suggestions` rows.

No auto-wiring, ever. Even an exact purl match generates a suggestion, not a
direct junction table write.

---

### New API surface (Phase 2)

- `POST /bom-entries/:id/promote` — creates `Component` (category=LIBRARY,
  provider from ecosystem mapping, externalId=version-free purl). EDITOR role.
- `POST /bom-entries/:id/wire` — links BOM entry to existing Component, writes
  `component_depends_on_component` row. EDITOR role.
- `GET /bom-entries/impact?purl={purl}` — cross-component impact query.

> **(UX amendment)** Route names are unchanged, but the user-facing language
> is not: the UI says **Add to catalog** (not "promote", which already means
> component → Platform product in `/components/:slug/promote`) and **Link to
> existing component** (not "wire"). The impact query is also exposed in
> Phase 1b as the where-used explorer, and bulk curation endpoints supersede
> per-entry calls (see [BOM Read Contract](#bom-read-contract-required-by-the-ux)
and UX-ADD). Entries that are
> already catalogued stay editable only through the Relationships tab.

---

## Phase 3 — Importer-Native Library Components (v2 Contract)

### Goal

Importers can yield full `LIBRARY`-category `DiscoveredAsset` objects and
declare `component_depends_on_component` edges within the same run, without
human review.

**Phase gate:** Phase 3 must not start until Phase 2 has been operating in
production. The v2 contract is irreversible — once importers auto-write edges,
the system relies on correct importer behavior. Phase 2 provides the
validation period.

**Why a new ADR, not an amendment to ADR-057:**
ADR-057 Amendment 1 (Phase 1) added `bomEntries` as factual inventory —
deliberately narrow, not crossing the "importer-declared edge" line.
Phase 3 crosses that line explicitly and deserves its own ADR (ADR-133) that
formally lifts the v1 prohibition on `relationships[]`, defines the same-run
scope constraint, and defines conflict rules for human-curated edges.

---

### `relationships[]` on `DiscoveredAsset` (ADR-133)

```typescript
export interface DiscoveredAssetRelationship {
  type: "DEPENDS_ON" | "SOURCES_FROM" | "EXPOSES";
  targetExternalId: string;  // externalId of target asset within the same run
}

export interface DiscoveredAsset {
  // ... all existing fields including bomEntries (Phase 1) ...
  relationships?: DiscoveredAssetRelationship[];  // ADR-133 (Phase 3 only)
}
```

**Safety constraint:** `targetExternalId` must resolve within the same run's
assets. Cross-run edges are silently dropped. `ON CONFLICT DO NOTHING` preserves
human-curated edges.

---

## UX Requirements

**Status:** Accepted UX direction (2026-11-20). This section is the UX input to
`speckit-specify` for each phase. It was produced by assessing this research
against the shipped v1.1 UX (`docs/ux.md`, `packages/frontend/src/ux`) and the
Suggestions, promote, importer-form and Relationships surfaces on this branch.
An interactive mock-up of every screen below accompanies the PR discussion;
the written requirements here are normative, the mock-up is illustrative.

**How to read this section**

- Requirement IDs (`UX-<area>-<nn>`) are stable so `spec.md`, `tasks.md` and
  tests can reference them. **MUST** = acceptance-blocking, **SHOULD** =
  expected unless the spec records a reason, **MAY** = optional.
- Tags `[P1]`, `[P1b]`, `[P2]`, `[P3]` give the phase that delivers the
  requirement. `[API]` marks a requirement that changes a contract defined
  earlier in this document; those changes are also applied in place in the
  Phase 1 / Phase 2 API sections above.
- Routes are written as in the `docs/ux.md` §4 route map (root-relative).
- Open points are listed under **Open UX Questions**; each carries a
  recommended default so the specify step can accept or overrule it.

### UX Assessment Summary

The research is a sound data-model and importer plan, and its curation model
(inventory first, human-approved promotion, auto-wiring last) matches
Componode's "nothing changes until you accept" philosophy. As a product plan it
was incomplete in five ways, all of which this section closes:

| # | Gap in the original research | Resolution in this document |
|---|---|---|
| 1 | No frontend scope in any phase's critical-files table; no flag or gap-registry entry (required by `docs/ux.md` §7) | Flags and Gap Governance; per-phase Frontend Touchpoints |
| 2 | `GET /components/:id/bom` returned the whole tree unpaginated, while every list in the product is server-paginated (spec 068 / ADR-130) | BOM Read Contract (Phase 1 API amended in place) |
| 3 | "Promote" already means *component → Platform product* in the UI (`/components/:slug/promote`) | Vocabulary: UI says **Add to catalog** / **Link to existing component**; API renamed |
| 4 | Thousands of `LIBRARY` components would dilute coverage, the Components list, the Provider filter and the Relationships canvas | UX-LIB |
| 5 | The highest-value question ("which components use package X?") was deferred as a "future endpoint" | Pulled forward as Phase 1b: UX-PKG |

Also resolved here: stale-data visibility (no retirement semantics in ADR-131),
tree accessibility, export interaction (the product's first file download),
suggestion volume and bulk decisions, importer capability reporting, and the
"SBOM implies vulnerability scanning" expectation gap.

### Decisions Taken

Accepted with the UX proposal; the spec MUST NOT reopen them without a reason.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Where-used ships in Phase 1b**, immediately after Phase 1, as the `/packages` explorer. | Needs no new entities (query over `bom_entries` + purl index); it is the feature stakeholders ask for first. |
| D2 | **Viewers can read and export a BOM.** | The data is already readable to Viewers; export is a read. |
| D3 | **SBOM ingestion is URL/importer based only.** File upload is deferred. | Upload needs a rule for matching a file to a component and a new one-shot flow (Bootstrap-import precedent). |
| D4 | **Library components are hidden from the Components list by default**, with a visible "Show libraries" toggle. | Keeps the catalog legible. |
| D5 | **Library components are excluded from coverage denominators** and the wired/unwired rollups. | Otherwise one import tanks coverage. |
| D6 | **UI vocabulary differs from research vocabulary** (see Vocabulary); API paths follow the UI vocabulary. | Keep "promote" unique to its existing meaning. |
| D7 | **The BOM tab is read-only.** The only writes are two row-level catalog actions for Editors. | Mirrors the read-only Relationships tab (ADR-128). |
| D8 | **Inventory only, never a security posture.** No risk/success/warning tones on package data; copy never says "safe", "secure" or "vulnerable". | Avoids implying a vulnerability scan that does not exist. |

### Open UX Questions (for the specify / grill step)

| # | Question | Recommended default |
|---|---|---|
| Q1 | **Stale threshold**: when does "Last reported" turn to the warning treatment? | 7 days, workspace-level setting; revisit tying it to each importer's schedule (e.g. 2 × interval) once schedules are exposed per Source. |
| Q2 | **Retirement semantics** (ADR-131): does a successful run replace its source's set for that component/instance, or only upsert? | Replace per `(componentId, componentInstanceId, sourceId)` on a *successful, complete* run; failed or partial runs never remove entries. UX needs one of the two to be explicit; both are compatible with UX-FRESH-*. |
| Q3 | Does export honour the active filters? | No. Export always produces the **full** BOM for the selected instance and the menu says so. Filtered exports are a later enhancement. |
| Q4 | What happens to the `TRANSITIVE` scope value once `direct` exists? | Keep it for CycloneDX/SPDX round-trip, but treat directness as the `direct` column: the UI Direct/Transitive filter reads `direct`; `TRANSITIVE` is rendered with its label and is not offered as a separate scope filter option when `direct` is populated. |
| Q5 | How does `importer-sbom-file` match a document to a component? | Spec decides (by URL → component externalId, or an explicit target on the importer config). UX requirement: the form's helper text names the rule. |
| Q6 | Licence filtering / licence page. | Out of scope for Phase 1; licences are displayed and searchable (`q`) only. |
| Q7 | Product-level package roll-up (products already have Components and Dependencies tabs). | Evaluate after Phase 2 using existing product-component edges; no Phase 1–3 commitment. |
| Q8 | Dependency suggestions: a separate queue page or a kind segment in `/suggestions`? | Segment in `/suggestions` (UX-SUG-01); revisit only if volume breaks performance targets. |

### Design Principles (UX)

These complement the five data principles at the top of this document.

1. **Inventory is fact, curation is a choice.** BOM data is read-only. The two
   write actions (Add to catalog, Link to existing component) are Editor-only,
   row-level, and visually and verbally separate from the data.
2. **Scale first.** Every BOM list is server-paginated with URL state. Flat is
   the default projection; tree is opt-in and loads children on expand.
3. **Reuse before inventing.** Tabs, `ListToolbar`, `ListPagination`,
   `useListState`, `StatusBadge` META tables, `MonoValue`, `EmptyState`,
   `ErrorState`, `ForbiddenState`, the Suggestions queue, `CapabilityNotice`,
   schema-driven importer forms. Only four patterns are new (below).
4. **Never imply security posture.** (D8) Scope/evidence/catalog badges use
   neutral, brand and info tones only. Warning/destructive tones on package
   rows are forbidden; the only warning tone in the feature is *stale data*.
5. **Keep the catalog legible.** Libraries get their own lane, filter and
   layout; they never inflate coverage, the default Components list or the
   Relationships canvas.
6. **Be honest about freshness.** Show who reported the data and when; make
   stale data visible rather than present it as current.

### Vocabulary

UI copy and, where practical, API paths use the middle column.

| Research term | UI term | Reason |
|---|---|---|
| Promote a BOM entry to a Library component | **Add to catalog** | "Promote" already means promoting a component to a Platform product (`promote-form.tsx`). Keep that meaning unique. |
| Wire a BOM entry to an existing component | **Link to existing component** | "Wired" is already the Coverage filter (component has a product edge). Do not overload it. |
| BOM entry | **Package** (row), **Bill of materials** (tab title) | Plain words. Use "BOM" only in tight spaces (tab count, flag names). |
| `scope` values | Runtime, Dev, Build, Test, System, Optional, Bundled, Transitive | Sentence-case labels from a `BOM_SCOPE_META` table, as with every other enum. |
| `evidenceSource` | **Found in** (Lockfile, Manifest, SBOM file, Image layer, Registry, Repository analysis) | States where it was found without jargon. |
| Edge created by a Phase 3 importer | **Added by importer** vs **Curated** | Provenance, not mechanism. |

### Information Architecture Changes

| Where | Change | Phase |
|---|---|---|
| Component detail | New third tab **Bill of materials** (with count) at `?tab=bom`, rendered only when `componentBom` is ON. Instance picker, view toggle, filters, sort, page live in the URL. | P1 |
| Sidebar → Catalog group | New item **Packages** after *Component groups*, route `/packages`, icon `BlocksIcon` (`PackageIcon` is taken by Products). Added to `NAV_SECTIONS` and `SEGMENT_LABELS`. No count pill. | P1b |
| `Ctrl+K` command palette | New **Packages** result group (name or purl) → opens `/packages?q=…`. | P1b |
| `/suggestions` | Segmented control **Product edges \| Component dependencies** (URL-driven `kind`). Nav pill keeps counting *product edges only*. | P2 |
| Library component detail | Category-specific section (same mechanism as `GithubDetailsSection`): **Used by** and **Versions in use**, replacing the environment-oriented Instances card. | P2 |
| Component detail → Relationships tab | **Libraries** lane renders one summary node linking to the BOM tab. | P2 |
| `/components` list | New **BOM** filter (Has BOM / No BOM) beside Coverage `[P1]`; **Provider** filter grouped (Platforms / Package registries) and **Show libraries** toggle (off by default) `[P2]`. | P1 / P2 |
| Dashboard | Coverage card gains a **Components with a BOM** line `[P1]`; `LIBRARY` excluded from the existing wired/unwired denominators `[P2]`. | P1 / P2 |
| Importer forms, run detail | Toggles arrive from the schema; run overview shows package counts; Changes tab stays component-only. | P1 |
| Edges (Relationships, Library detail) | **Added by importer** / **Curated** badge, Source link, **Hide edge** action. | P3 |

### Net-New UI Patterns (everything else is reuse)

1. **Tree-grid table**: expandable rows, lazy children, keyboard model (UX-A11Y-01).
2. **Grouped review row**: one Suggestions row standing for *N* decisions with
   a count-bearing bulk action.
3. **Export menu**: the product's first file download.
4. **Summary node** in the Relationships canvas standing for a collapsed lane.

### Roles

Advisory in the UI, enforced by the API. Per `docs/ux.md`, actions a user
cannot take are **hidden**, never shown disabled.

| Role | Can |
|---|---|
| Viewer | Read the BOM tab, use `/packages`, export, see suggestion history |
| Editor | Everything above, plus Add to catalog, Link to existing component, accept/dismiss dependency suggestions, hide an importer-added edge (P3) |
| Admin | Everything above, plus configure importers and agents (unchanged) and the **Configure importer** shortcut in the BOM empty state |

### Flags and Gap Governance

`docs/ux.md` §7: a flag ships only alongside a detailed entry in
`researches/ux-rewrite-gaps.md` and stays OFF until the backend capability
exists. Numbering continues after G35; the spec confirms final numbers.

| Gap | Flag (`ux/lib/flags.ts`) | Surface | Flips ON when |
|---|---|---|---|
| G36 — Component bill of materials | `componentBom` | BOM tab, run package counts, BOM list filter, dashboard BOM line | `GET /components/:id/bom` (+ summary, export) returns real data (Phase 1) |
| G37 — Packages explorer (where-used) | `packagesExplorer` | `/packages`, sidebar item, `Ctrl+K` group, row deep links | `GET /packages` + consumers endpoint live (Phase 1b) |
| G38 — BOM catalog curation | `bomCuration` | Add to catalog / Link dialogs, dependency suggestions segment, Library detail, Libraries lane, list toggles | Phase 2 endpoints + `bom_component_suggestions` live |
| G39 — Importer-added edge provenance | `bomImporterEdges` | Provenance badge, Hide edge, opt-in switch | Phase 3 provenance + suppression record live |
| G40 — Package advisories (DEFERRED, unscheduled) | none | Intentionally **not rendered**: no advisories column, not even disabled | A vulnerability data source is chosen (separate research) |

Each gap entry MUST list: UX surface, the capability needed, the flag, and the
fallback behaviour (always *hidden*, never a disabled control). `docs/ux.md` §4
(route map, tabs), §5 (conventions, if new patterns are added) and §9 are
updated in the same change as each phase.

---

### UX-BOM — Bill of Materials tab on component detail `[P1]`

Route `/components/:slug?tab=bom`. Flag `componentBom` (OFF ⇒ tab not rendered).

**Layout, top to bottom**

1. Tab bar: Overview · Relationships · **Bill of materials `312`** (count is
   the unfiltered total for the current instance selection; omitted while
   loading and on error).
2. **Summary strip** (five facts): *Packages*, *Direct*, *Ecosystems*,
   *Licenses* (distinct count), *Last reported* (relative time, plus
   "by {Source link}").
3. **Toolbar** (`ListToolbar`): search; filters *Ecosystem*, *Scope*, *Found
   in*, *Catalog*, *Depth* (All / Direct / Transitive); **Instance** picker;
   **Flat / Tree** toggle; **Export** menu.
4. **Table** (flat or tree).
5. **Pagination** (`ListPagination`) and a one-line footer disclaimer.

**Requirements**

- **UX-BOM-01 (MUST)** The tab is read-only: no inline editing, no bulk
  selection, no destructive actions.
- **UX-BOM-02 (MUST)** All toolbar state is URL-driven via `useListState`:
  `q`, `ecosystem`, `scope`, `found`, `catalog`, `depth`, `instance`, `view`,
  `sort`, `order`, `page`, `pageSize`. Reloading or sharing the URL reproduces
  the view. Changing any filter resets `page` to 1.
- **UX-BOM-03 (MUST)** Default view is **Flat**, default sort `name asc`,
  default page size per the existing list standard. Search matches name, purl
  and licence text, case-insensitively, server-side.
- **UX-BOM-04 (MUST)** Table columns (flat): **Package** (name, with the purl
  beneath as `MonoValue`, truncated with full value on focus/hover, and a muted
  "in {parent}" line when the entry has a parent), **Version**, **Scope**
  (badge), **Licenses**, **Found in**, **In catalog**, row menu. A muted
  *Transitive* tag follows the name when `direct = false`.
- **UX-BOM-05 (MUST)** **Scope** badge follows the `StatusBadge` contract
  (dot + label + tooltip) from `BOM_SCOPE_META`. Tones restricted to
  neutral / brand / info. Recommended mapping: Runtime = brand; System,
  Bundled = info; Dev, Build, Test, Optional, Transitive = neutral.
  Tooltips explain each scope (Copy Deck).
- **UX-BOM-06 (MUST)** **Found in** shows the `BOM_EVIDENCE_META` label with
  `evidenceDetail` (e.g. lockfile path) in the tooltip. Mapping: `LOCK_FILE`
  Lockfile · `MANIFEST_FILE` Manifest · `SBOM_DOCUMENT` SBOM file ·
  `IMAGE_LAYER` Image layer · `REGISTRY_API` Registry · `VCS_ANALYSIS`
  Repository analysis.
- **UX-BOM-07 (MUST)** **Licenses** renders SPDX expressions verbatim; the
  first expression inline, remaining as a `+N` chip with the full list in a
  tooltip; empty ⇒ muted "Unknown". No licence-risk colouring (D8).
- **UX-BOM-08 (MUST)** **In catalog** cell has three states: *Linked*
  (links to the Library component), *Suggested* (a pending suggestion exists;
  links to `/suggestions?kind=dependency` filtered to this package), or empty.
  While `bomCuration` is OFF the column is **not rendered**.
- **UX-BOM-09 (MUST)** **Row menu** (`⋯`, labelled "Actions for {name}"):
  *See where it's used* (all roles; hidden unless `packagesExplorer` is ON),
  *Copy purl* (all roles), and, for Editors when `bomCuration` is ON: *Add to
  catalog* (only when no Component exists for the purl) or *Link to existing
  component*, and *View library component* when linked. Viewers never see write
  items.
- **UX-BOM-10 (MUST)** **Instance picker** is shown only when the component
  has BOM data for more than one instance. Options: *All (merged)* (default)
  plus each instance (name + `ENVIRONMENT_META` badge). In merged view each
  package appears once and shows "in 3 of 4 instances" on hover/focus; choosing
  an instance shows exactly that instance's entries. State is `?instance=`.
- **UX-BOM-11 (MUST)** **Flat / Tree toggle** is shown only when the summary
  reports `hasNesting = true` (nested assemblies such as multi-layer
  containers). In tree view, top-level rows are paginated; children load on
  expand via `parentId` (UX-BOM-12). Applying search or any filter while in
  tree view **switches to flat** and announces it ("Switched to flat view:
  filters apply to all packages."); the user can switch back manually.
- **UX-BOM-12 (MUST)** Expanding a tree row fetches its direct children
  (page size 50). More than 50 children ⇒ a "Show 50 more" row at the end of
  that group. Expansion state is client-only and not in the URL. A fetch
  failure shows an inline retry row, not a page-level error.
- **UX-BOM-13 (MUST)** **Export menu** per UX-EXP.
- **UX-BOM-14 (MUST)** Footer line always visible with the paging summary:
  "Showing 1–25 of 312 packages · Inventory only. Componode does not scan for
  vulnerabilities."
- **UX-BOM-15 (SHOULD)** Rows open nothing in Phase 1 (no detail drawer); all
  row-level information fits the row plus tooltips.
- **UX-BOM-16 (MUST)** No advisories/vulnerabilities column is rendered, not
  even disabled (G40).

### UX-FRESH — Freshness and provenance `[P1]`

ADR-131 is upsert-on-report with no retirement, so removed packages could read
as current. The UI MUST make age visible.

- **UX-FRESH-01 (MUST)** `[API]` Every entry exposes `lastReportedAt`; the
  summary exposes per-Source `lastReportedAt` (and per-instance when
  instance-scoped).
- **UX-FRESH-02 (MUST)** *Last reported* in the summary strip shows relative
  time (`RelativeTime`) and links the reporting Source (Sources, ADR-119).
- **UX-FRESH-03 (MUST)** **Stale**: when the most recent `lastReportedAt` is
  older than the threshold (default 7 days, Q1) the *Last reported* value uses
  the warning tone with a tooltip ("No import run has reported this inventory
  since {date}."). Rows keep normal styling.
- **UX-FRESH-04 (MUST)** **Multi-source**: when more than one Source reported
  entries, *Last reported* becomes a popover listing each Source and its time;
  row hover shows which Source reported that entry.
- **UX-FRESH-05 (SHOULD)** If Q2 resolves to "replace on successful run", the
  run overview's package tile includes a **removed** count (UX-IMP-04).

### UX-EXP — Export `[P1]`

The first file download in the product. Catalog export (gap G19, `advancedOps`)
remains separate and OFF.

- **UX-EXP-01 (MUST)** A single **Export** button opens a menu with three
  items, each with a one-line audience description: **Componode JSON** (all
  fields, all scopes), **CycloneDX 1.5** (for scanners and compliance tools),
  **SPDX 2.3** (for licence and procurement reviews).
- **UX-EXP-02 (MUST)** The menu shows, above the items, the lossy-mapping
  notice: "CycloneDX and SPDX can't express Build, Dev and Test scopes, so
  those are exported as Runtime or Optional."
- **UX-EXP-03 (MUST)** Export covers the **full** BOM for the selected
  instance (Q3), ignores list filters, and the menu says so.
- **UX-EXP-04 (MUST)** Filenames: `{component-slug}-bom.json`,
  `{component-slug}-bom.cdx.json`, `{component-slug}-bom.spdx.json`; with an
  instance selected: `{component-slug}-{instance-name}-bom…`. Set by
  `Content-Disposition` on the API response.
- **UX-EXP-05 (MUST)** `[API]` Export is **streamed** (large BOMs) and
  available to Viewers (D2). The UI announces start ("Preparing export…") and
  completion ("Downloaded {filename}") through a polite live region; failures
  use the existing toast error pattern with retry.

### UX-PKG — Packages explorer `[P1b]`

Route `/packages`. Flag `packagesExplorer`. Sidebar: Catalog → **Packages**.
Answers "which of our components contain X?" (the Log4Shell question).

- **UX-PKG-01 (MUST)** Page header "Packages" with subtitle "Where every
  package and version is used across the catalog. Inventory only: Componode
  does not scan for vulnerabilities."
- **UX-PKG-02 (MUST)** `ListToolbar` with one search box (name **or** purl,
  server-side, URL `q`), filters *Ecosystem*, *Scope*, *In catalog*; sort
  whitelist `name`, `components`, `versions`, `ecosystem`; default sort
  `components desc` then `name asc`. Server-paginated; URL-driven.
- **UX-PKG-03 (MUST)** Rows are **one per version-free purl**: **Package**
  (name + purl), **Ecosystem**, **Versions in use** (chips `2.14.1 × 2`, top 5
  by count, then "+N more"), **Components** (count), **Catalog** (Linked /
  Suggested / none, as UX-BOM-08).
- **UX-PKG-04 (MUST)** A row expands (same expand pattern as the instances
  table) to a paginated **consumers** list: component name (link to its BOM
  tab filtered to this package, `?tab=bom&q={purl}`), category, version,
  scope, direct/transitive, last reported. Clicking a version chip filters the
  consumers list to that version (`version` param).
- **UX-PKG-05 (MUST)** Reachable from `Ctrl+K` (result group **Packages**, top
  5, "{name} · {ecosystem} · {n} components") and from the BOM tab row menu
  (*See where it's used* → `/packages?q={purl}`).
- **UX-PKG-06 (MUST)** Empty states: *no inventory yet* (package data appears
  after an importer with dependency inventory runs; Admins get a link to
  Importers) and *no results* (Clear filters).
- **UX-PKG-07 (SHOULD)** `q` shorter than 2 characters is not sent; the UI
  shows a hint instead.

### UX-IMP — Importer configuration and run feedback `[P1]`

- **UX-IMP-01 (MUST)** Toggles (`includeDependencyGraph`, `includeSbom`,
  `includePodImageSbom`, and the `importer-sbom-file` fields) render through
  the existing schema-driven importer forms; **no bespoke form code**. The Zod
  `.describe()` text becomes helper text and MUST name (a) what is imported
  and (b) the cost or prerequisite.
- **UX-IMP-02 (MUST)** Minimum helper text:
  - GitHub `includeDependencyGraph`: "Import each repository's package
    inventory into its bill of materials. Uses GitHub's dependency graph, so
    private repositories need the 'Dependency graph' permission on the token."
  - Docker `includeSbom`: states that image SBOM attestations/referrers are
    read and that images without one report no inventory.
  - Kubernetes `includePodImageSbom`: states it reads the SBOM of images in
    running pods and which registry access it needs.
  - `importer-sbom-file`: names the component-matching rule (Q5).
- **UX-IMP-03 (MUST)** `[API]` Add a `bomInventory` capability family to every
  importer that adds a BOM toggle, using the existing capability-degradation
  mechanism (GitHub `CapabilityNotice`, spec 072). Extend `CAPABILITY_LABELS`
  with "Dependency inventory". Only non-OK families are surfaced, exactly like
  GitHub branches/releases today. Example: "Some GitHub inventory data is
  incomplete. Dependency inventory (UNAVAILABLE): dependency graph is disabled
  for 3 private repositories."
- **UX-IMP-04 (MUST)** Run detail overview adds a **Packages** tile with
  created / unchanged / updated counts (and removed per UX-FRESH-05). The
  **Changes** tab stays itemised for **components only**; package changes are
  summarised, never itemised, so a first run does not bury it.
- **UX-IMP-05 (SHOULD)** The BOM empty state (UX-STATE-02) deep-links Admins to
  the importer edit form at the relevant toggle.

### UX-ADD — Add to catalog / Link to existing component `[P2]`

Entry points: BOM tab row menu, `/packages` row menu. Editors only (hidden for
Viewers). Flag `bomCuration`. The decision is **per package** (version-free
purl), not per version or per component.

- **UX-ADD-01 (MUST)** *Add to catalog* opens a dialog (`FormSection` +
  `DescriptionList`) titled "Add {name} to the catalog" with the sentence
  "Creates one Library component that every component using {name} can depend
  on. Versions stay on each component's own bill of materials."
- **UX-ADD-02 (MUST)** The dialog **previews what will be created before
  commit**, read-only: Name, Category (from the `cdxType` mapping), Provider
  (from the `ecosystem` mapping, shown with its group, e.g. "PyPI (package
  registry)"), Identity (version-free purl), **Used by N components** (link to
  `/packages?q=`). `[API]` A preview endpoint returns this derived shape and
  any existing match.
- **UX-ADD-03 (MUST)** Two outcomes via a radio group ("After adding"):
  1. **Link all N components that use it** (default): creates N dependency
     relationships in one step; helper "Review them on the Suggestions page
     first if you prefer."
  2. **Only add to the catalog**: dependencies appear as pending suggestions.
- **UX-ADD-04 (MUST)** If a Component already exists for the purl, the same
  entry point opens **Link to existing component** instead: shows the matched
  component and the same two outcomes. Never allow creating a duplicate
  `externalId`.
- **UX-ADD-05 (MUST)** The primary button label states the exact count when
  relationships are created ("Add and link 9 components"). The operation is
  atomic: on failure nothing is created; the dialog shows the error inline with
  Retry.
- **UX-ADD-06 (MUST)** Success: toast "Added {name} to the catalog" with a
  **View** action to the new Library component; the BOM row's *In catalog* cell
  updates without a full reload (SWR revalidation).
- **UX-ADD-07 (MUST)** Mapping anomalies are visible, not silent: when the
  category was inferred through a lossy mapping (e.g. `firmware` / `device` →
  `COMPUTE`), the dialog shows a muted note "Mapped from {cdxType}".
- **UX-ADD-08 (SHOULD)** No category/provider override in Phase 2; the Library
  component's normal edit form handles that afterwards.

### UX-SUG — Dependency suggestions `[P2]`

`/suggestions` today is one queue of product edges, with no bulk actions,
terminal decisions (ADR-113) and a nav pill counting all pending. Component
dependencies can reach thousands, so they need grouping and bulk accept.

- **UX-SUG-01 (MUST)** Add a segmented control **Product edges | Component
  dependencies** (URL param `kind`, default `edge`) next to the existing
  Pending / History tabs. The segment shows its own pending count. Existing
  behaviour and URLs for product edges are unchanged.
- **UX-SUG-02 (MUST)** The **nav pill keeps counting product edges only.**
- **UX-SUG-03 (MUST)** In the dependency segment, Pending rows are **grouped by
  library**: "lodash is used by 14 components", strongest match reason as a
  badge, versions count, purl, and **Accept all 14** / **Dismiss all**; the
  chevron expands to per-component rows with **Accept** / **Dismiss**. Groups
  are server-paginated; sort offers *Highest score* (default), *Most
  components*, *Name*.
- **UX-SUG-04 (MUST)** Match-reason badges: `PURL_EXACT` → "Exact package
  match", `PURL_NAME_MATCH` → "Name match", `CATALOG_SLUG_MATCH` → "Catalog
  name match", mapped onto the existing confidence tones.
- **UX-SUG-05 (MUST)** **Bulk accept is only offered for `PURL_EXACT` groups.**
  Name/slug matches require per-row review; their group header shows
  **Dismiss all** only. `[API]` The server enforces this.
- **UX-SUG-06 (MUST)** Bulk accept and bulk dismiss require a confirmation
  dialog stating the exact count and finality: "Accept 14 dependencies on
  lodash? This creates 14 dependency relationships. Accepted and dismissed
  suggestions are final and can't be undone." Buttons: Cancel / Accept all.
- **UX-SUG-07 (MUST)** Results are announced in a polite live region ("14
  dependencies accepted") and via toast; partial failures report how many
  succeeded and failed, with a retry for the failed subset.
- **UX-SUG-08 (MUST)** History works for both kinds; dependency history rows
  show the library, the component and the decider, as for product edges.
- **UX-SUG-09 (MUST)** Page subtitle: "Relationships Componode inferred from
  traces, tags, ownership and package inventories. Nothing changes in the
  catalog until you accept."

### UX-LIB — Keeping the catalog legible `[P2]`

- **UX-LIB-01 (MUST)** `/components` hides `LIBRARY` components by default. A
  **Show libraries** toggle (URL `libraries=1`) includes them and shows the
  hidden count ("Show libraries (212)"). Direct links to a Library component
  always work.
- **UX-LIB-02 (MUST)** `[API]` `LIBRARY` is excluded from the Coverage filter
  and from dashboard wired/unwired denominators (D5). This amends the coverage
  spec and MUST be recorded there.
- **UX-LIB-03 (MUST)** **Provider** filter becomes grouped: *Platforms* (the
  existing 11) and *Package registries* (the 13 new ecosystem providers).
- **UX-LIB-04 (MUST)** Library component detail replaces the
  environment-shaped **Instances** card with **Used by** (paginated consuming
  components with version, scope, direct/transitive; links to the consumer's
  BOM tab filtered to this package) and **Versions in use** (chips with counts;
  clicking filters *Used by*). The identity block shows purl (`MonoValue`),
  ecosystem and provider.
- **UX-LIB-05 (MUST)** Relationships tab: `LIBRARY` neighbours are not drawn as
  individual nodes. The **Libraries** lane renders a single **summary node**
  ("214 libraries") linking to `?tab=bom` (for a consumer) or to the Used by
  section (for a Library component). Collapsed by default; existing
  `LANE_LIMIT` behaviour for other lanes is unchanged. `[API]` The
  relationships read returns library counts (`dependsOn`, `usedBy`) separately
  from lane nodes so the contract stays bounded (spec 060).

### UX-EDGE — Importer-added edges `[P3]`

Phase 3 bypasses human review, so it needs visibility first. It MUST NOT ship
until all of the following exist in the UI and API.

- **UX-EDGE-01 (MUST)** Every dependency edge displays provenance: **Curated**
  (human) or **Added by importer** (with a link to the Source and run).
- **UX-EDGE-02 (MUST)** **Hide edge** (Editor) suppresses an importer-added
  edge so a re-import does not recreate it. `[API]` A suppression record is
  honoured by the Phase 3 pass; with `ON CONFLICT DO NOTHING` alone, a
  user-deleted edge would silently return.
- **UX-EDGE-03 (MUST)** The Phase 3 switch is **opt-in**, with explicit copy:
  "Imported dependencies are added to the catalog without review. You can hide
  any edge later."
- **UX-EDGE-04 (MUST)** Exit criteria: a user can answer "why does this edge
  exist?" in one click, and a hidden edge stays hidden across runs.

---

### BOM Read Contract Required by the UX

`[API]` These requirements replace the original unpaginated
`GET /components/:id/bom` (also amended in place in Phase 1 above).

**List: `GET /components/:id/bom`**

| Param | Behaviour |
|---|---|
| `page`, `pageSize` | Server pagination; same bounds and envelope as other list endpoints (spec 068 / ADR-130) |
| `sort`, `order` | Whitelist: `name` (default), `version`, `scope`, `ecosystem`, `lastReportedAt` |
| `q` | Case-insensitive match on name, purl, licences |
| `scope`, `ecosystem`, `found` | Multi-value (OR) |
| `catalog` | `linked` \| `suggested` \| `none` (Phase 2; ignored before) |
| `direct` | `true` \| `false` |
| `instanceId` | Omitted ⇒ merged view (one row per purl + version + scope, with `instanceCount` / `instanceTotal`) |
| `view` | `flat` (default) \| `tree` (top-level only, with `hasChildren`, `childCount`) |
| `parentId` | When set, returns that entry's direct children (paginated) |

Each item MUST include: `id`, `purl`, `name`, `version`, `ecosystem`, `scope`,
`direct`, `evidenceSource`, `evidenceDetail`, `licenses[]`, `supplier`,
`cdxType`, `source { id, name }`, `lastReportedAt`, `parentId`, `hasChildren`,
`childCount`, `instanceCount`, `instanceTotal`,
`resolvedComponent { id, slug, name } | null`, `pendingSuggestionId | null`.

**Summary: `GET /components/:id/bom/summary`** (accepts `instanceId`)

`{ total, direct, ecosystems[], licenseCount, hasNesting, lastReportedAt,
sources[ { id, name, importerKind, lastReportedAt } ], instances[ { id, name,
environment, entryCount } ] }`. The UI renders the summary strip, instance
picker, tree toggle and stale state from this single call.

**Export: `GET /components/:id/bom/export?format=json|cyclonedx|spdx&instanceId=`**

Separate from the list endpoint so the list stays a paginated read and export
is a streamed download with `Content-Disposition`. The research's `?format=` on
the list endpoint is superseded (the spec may keep it as an alias). Always the
full BOM.

**New model fields** `[API]`: `direct boolean` (so "Direct 24" is honest and
directness filters independently of phase/origin scope; see Q4) and
`lastReportedAt` (updated on every report of the entry, distinct from
`updatedAt`).

**Packages: `GET /packages`** and
**`GET /packages/consumers?purl=&version=&page=&pageSize=`** (purl as a query
parameter, not a path segment). `GET /packages` returns one row per
version-free purl: `purl`, `name`, `ecosystem`, `versionCount`,
`versions[ { version, componentCount } ]` (top 5), `componentCount`,
`catalogComponent | null`, `pendingSuggestionCount`. Replaces the research's
future `GET /bom-entries/impact?purl=` for the UI; the impact SQL remains the
implementation basis.

**Phase 2 write contract** `[API]`

- `GET /packages/add-to-catalog/preview?purl=` → derived Name, Category,
  Provider (+ group), Identity, consumer count, `existingComponent | null`,
  `mappedFrom`.
- `POST /packages/add-to-catalog` `{ purl, linkConsumers: boolean }` → creates
  the Library component and, if requested, the dependency edges atomically;
  returns `{ component, linked }`. Editor+.
- `POST /packages/link` `{ purl, componentId, linkConsumers }` → links to an
  existing component. Editor+.
- These supersede `POST /bom-entries/:id/promote` and `/wire`; per-entry routes
  MAY remain as thin aliases but are not used by the UI.
- `GET /suggestions?kind=edge|dependency` (default `edge`), grouped listing
  `GET /suggestions/dependencies/groups`, and
  `POST /suggestions/dependencies/bulk` `{ childComponentId, action:
  accept|dismiss }`. `accept` is rejected server-side unless every targeted
  suggestion is `PURL_EXACT`. Pending counts per kind are returned for the
  segment chip; the nav-pill count is unchanged.

### State Matrix: Bill of Materials Tab

Follows `docs/ux.md` §5. Every row is a distinct reason the tab can look the
way it does.

| ID | State | Trigger | Treatment |
|---|---|---|---|
| UX-STATE-01 | Loading | First fetch | Skeleton for summary strip and 8 table rows; toolbar stays interactive |
| UX-STATE-02 | Empty: capability off | No importer reporting this component has BOM enabled | `EmptyState` "No bill of materials yet" + Admin-only **Configure importer** action; non-admins see the explanation only |
| UX-STATE-03 | Empty: awaiting first run | Capability on, no entries reported yet | "Waiting for the next import run" with the Source and next scheduled time |
| UX-STATE-04 | Empty: filters | Filters exclude all rows | Standard filtered-empty with **Clear filters** |
| UX-STATE-05 | Refetching | Filter, sort, page or instance change | Keep previous rows, dim to 60%, no layout shift |
| UX-STATE-06 | Partial | Capability reports non-OK status for this repo | Alert above the table using the `CapabilityNotice` pattern |
| UX-STATE-07 | Stale | Last reported older than threshold | *Last reported* in warning tone with tooltip; rows unchanged |
| UX-STATE-08 | Multi-source | More than one Source reported | *Last reported* becomes a popover per Source; row hover names the Source |
| UX-STATE-09 | Error | API failure | `ErrorState` with Retry; summary strip hidden |
| UX-STATE-10 | Forbidden / not found | No access / unknown component | Existing `ForbiddenState` / not-found page |
| UX-STATE-11 | Flag off | `componentBom` false | Tab not rendered (hidden, not disabled), as for Relationships |

The same loading / empty / filtered-empty / error / forbidden treatments apply
to `/packages` and the dependency-suggestions segment.

### Copy Deck

Strings are requirements: plain tone, never alarmist, never claiming safety.

| Where | Copy |
|---|---|
| BOM footer / Packages subtitle | Inventory only. Componode does not scan for vulnerabilities. |
| Empty: capability off | No bill of materials yet. Turn on dependency inventory on the importer that reports this component and the next run will fill this in. |
| Empty: awaiting run | Waiting for the next import run. {Source} is scheduled to run in about {duration}. |
| Stale tooltip | No import run has reported this inventory since {date}. |
| Scope tooltip: Transitive | Pulled in by another package rather than declared directly. |
| Scope tooltip: System | Installed in the operating system layer of the image, not by a language package manager. |
| Scope tooltip: Bundled | Vendored or embedded in the component rather than installed separately. |
| Scope tooltip: Dev / Build / Test | Used only during development / the build / test execution. |
| Export warning | CycloneDX and SPDX can't express Build, Dev and Test scopes, so those are exported as Runtime or Optional. |
| Filters-to-flat notice | Switched to flat view: filters apply to all packages. |
| Add to catalog | Creates one Library component that every component using {name} can depend on. Versions stay on each component's own bill of materials. |
| Link outcome helper | Creates {N} dependency relationships. Review them on the Suggestions page first if you prefer. |
| Bulk accept confirm | This creates {N} dependency relationships. Accepted and dismissed suggestions are final and can't be undone. |
| Suggestions subtitle | Relationships Componode inferred from traces, tags, ownership and package inventories. Nothing changes in the catalog until you accept. |
| Phase 3 opt-in | Imported dependencies are added to the catalog without review. You can hide any edge later. |

Forbidden words in package UI: *safe, secure, clean, vulnerable, risk, threat,
compliant*. Licences are shown as data, not as compliance verdicts.

### Accessibility Acceptance Criteria

- **UX-A11Y-01 (MUST)** Tree mode uses `role="treegrid"`; rows carry
  `aria-level`, `aria-expanded` (parents only) and `aria-posinset` /
  `aria-setsize` where children are paginated. Right/Left arrows expand and
  collapse (Left on a collapsed row moves to its parent); Up/Down move between
  rows with a roving `tabindex`; Home/End jump to first/last row.
- **UX-A11Y-02 (MUST)** Every scope, evidence and catalog badge pairs a dot or
  icon with a text label; tone is never the only signal.
- **UX-A11Y-03 (MUST)** Row action menus are keyboard-reachable and labelled
  with the package name ("Actions for lodash").
- **UX-A11Y-04 (MUST)** Expansion results, view switches, export start/finish
  and bulk-decision results announce through a polite live region.
- **UX-A11Y-05 (MUST)** Long purls truncate with the full value available on
  focus (not hover alone) and are copyable through `MonoValue`.
- **UX-A11Y-06 (MUST)** Confirmation dialogs trap focus, return focus to the
  invoking control, and include the count in the confirm button's accessible
  name.
- **UX-A11Y-07 (SHOULD)** Respect reduced motion for the row dim and expand
  animations.

### Frontend Touchpoints by Phase

Paths are under `packages/frontend/src/` unless stated. The spec turns these
into tasks; they are not exhaustive of tests and docs.

**Phase 1 (`componentBom`)**

| File | Change |
|---|---|
| `ux/lib/flags.ts` | Add `componentBom` (OFF until backend lands), doc comment referencing G36 |
| `ux/lib/domain.ts` | `BOM_SCOPE_META`, `BOM_EVIDENCE_META` (label, tone, tooltip) |
| `ux/lib/view-types.ts` | `BomEntryView`, `BomSummaryView` |
| `api/hooks/bom.ts`, `api/mappers/bom.ts` | SWR hooks (list, summary, children, export trigger) and mappers |
| `ux/components/catalog/component-bom.tsx` (new) | The tab: summary strip, toolbar, flat/tree table |
| `ux/components/catalog/component-detail.tsx` | Third tab, URL tab state, count |
| `ux/components/patterns/status-badge.tsx` | `BomScopeBadge`, `BomEvidenceBadge` |
| `ux/components/patterns/tree-grid.tsx` (new) | Treegrid primitive (UX-A11Y-01) |
| `ux/components/catalog/bom-export-menu.tsx` (new) | Export menu |
| `ux/components/importers/run-detail.tsx`, `ux/components/catalog/github-details.tsx` | Packages tile; `bomInventory` capability label |
| `ux/components/components/components-table.tsx`, dashboard coverage card | BOM filter, "Components with a BOM" line |
| `docs/ux.md`, `researches/ux-rewrite-gaps.md` | Route/tab update; G36 and G40 entries |

**Phase 1b (`packagesExplorer`)**

| File | Change |
|---|---|
| `ux/app/packages/index.tsx` (new) | Packages page |
| `ux/components/catalog/package-consumers.tsx` (new) | Expandable consumers list (reused by Library detail) |
| `ux/lib/nav.ts` | Item in Catalog group; `SEGMENT_LABELS.packages`; `BlocksIcon` |
| Command palette module | Packages result group |
| `ux/lib/flags.ts`, gap registry, `docs/ux.md` | `packagesExplorer`, G37, route map |

**Phase 2 (`bomCuration`)**

| File | Change |
|---|---|
| `ux/app/suggestions.tsx`, `ux/components/catalog/suggestion-queue.tsx` | `kind` segment, grouped rows, bulk confirm |
| `ux/components/catalog/bom-add-to-catalog-dialog.tsx` (new) | Add to catalog / Link dialog |
| `ux/components/catalog/package-details.tsx` (new) | Category section for `LIBRARY` (like `GithubDetailsSection`) |
| Relationships tab component | Libraries summary node |
| `components-table.tsx`, dashboard coverage card, `ux/lib/domain.ts` | Show-libraries toggle, coverage exclusion, grouped providers |
| `ux/lib/flags.ts`, gap registry, `docs/ux.md` | `bomCuration`, G38 |

**Phase 3 (`bomImporterEdges`)**

| File | Change |
|---|---|
| Relationships and Library detail edge rows | Provenance badge, Source link, **Hide edge** |
| Importer form for the Phase 3 importer | Opt-in switch with review-bypass copy |
| `ux/lib/flags.ts`, gap registry | `bomImporterEdges`, G39 |

### UX Verification

Complements the per-phase checks in the Verification section below.

**Phase 1**

1. With `componentBom` OFF the tab is absent (not disabled); ON renders the
   summary strip and flat table from real data.
2. URL round-trip: set search, two filters, sort, page 2, instance and view;
   reload; the identical view returns. A filter change resets page to 1.
3. A 5,000-entry BOM stays interactive: first page renders from one paginated
   request; no request returns more than one page of rows; tree expand fetches
   only that node's children.
4. Tree: a keyboard-only walkthrough satisfies UX-A11Y-01; applying a filter
   switches to flat with the live-region announcement.
5. The instance picker appears only with more than one BOM-bearing instance;
   merged view shows one row per package with "in N of M instances".
6. Export: three formats download with the specified filenames; a large BOM
   streams without UI freeze; a Viewer can export; the lossy notice is visible.
7. Stale (>7 days), multi-source, partial-capability and empty-state variants
   each render per the state matrix.
8. No warning/destructive tone appears on package rows; copy contains none of
   the forbidden words.
9. The importer form shows the toggles with the specified helper text; run
   detail shows the Packages tile; the Changes tab lists components only.

**Phase 1b**

1. `/packages?q=lodash` and `?q=pkg:deb` return grouped rows; expanding shows
   consumers; clicking a version chip filters them.
2. `Ctrl+K` and the BOM row menu deep-link with the query applied.

**Phase 2**

1. The Add to catalog preview matches the created component (name, category,
   provider, identity); if a Component exists the dialog is in Link mode.
2. "Link all N" creates exactly N relationships atomically; failure creates none.
3. Dependency suggestions: grouping, exact-only bulk accept (name matches show
   no Accept all), count-bearing confirmation, nav pill unchanged.
4. A workspace with 1,000 Library components shows unchanged coverage and an
   unchanged default Components list; "Show libraries" reveals them.
5. The Relationships tab for a component with 200+ libraries renders one
   summary node and stays within the bounded read.

**Phase 3**

1. Every importer-added edge shows provenance; Hide edge persists across a
   re-import; a human-curated edge is never overwritten or relabelled.

### Out of Scope (UX)

- Vulnerability/advisory display, licence-risk analysis, SBOM diffing between
  runs or instances, and a package detail drawer.
- SBOM file upload from the browser (D3).
- Product-level package roll-up (Q7).
- Editing or deleting BOM entries by hand (D7).
- Filtered export (Q3).

---

## ADR Impact Summary

| ADR | Type | Phase | Key content |
|---|---|---|---|
| **ADR-057 Amendment 1** | Amendment | 1 | Add `DiscoveredBomEntry` and `bomEntries?: DiscoveredBomEntry[]`. Explicitly state: `bomEntries` is factual inventory, not a graph edge. Prohibition on `relationships[]` for edge declarations is unchanged. |
| **ADR-013 Amendment 2** | Amendment | 2 | Add 13 ecosystem `ComponentProvider` values. Add `cdxType → ComponentCategory` mapping. Update DB CHECK constraint. |
| **New ADR-131** | Ratification | 1 | BomEntry entity: tree via `parentBomEntryId`; upsert-on-report; no orphan/retirement semantics; source-scoped; `resolvedComponentId` set by matching pass only. |
| **New ADR-132** | Ratification | 2 | Catalog promotion: EDITOR-only; Library Component identity = version-free purl; `bom_component_suggestions` follows ADR-113; no auto-wiring ever. |
| **New ADR-133** | Ratification | 3 | v2 importer contract: lifts `relationships[]` prohibition; same-run scope only; auto-reconciliation to junction tables; `ON CONFLICT DO NOTHING` for human edges. |
| **docs/ux.md amendment** *(UX amendment)* | Amendment | 1 | Register the Bill of materials tab, the Packages explorer route, the BOM / dependency gap flags, and the BOM vocabulary (Package, Add to catalog, Link, Where used) in `docs/ux.md` and `researches/ux-rewrite-gaps.md`. |
| **Constitution Principle V** | Clarification | 1 | Add note: `bomEntries[]` is factual inventory, not a relationship declaration. The prohibition applies only to `relationships[]` edge declarations. |

---

## Migration Sequence

```
032_bom_entries.ts                  Phase 1 — bom_entries table + indexes
033_ecosystem_providers.ts          Phase 2 — provider enum + CHECK constraint
034_bom_component_suggestions.ts    Phase 2 — suggestion queue
```

---

## Critical Files by Phase

### Phase 1

| File | Change |
|---|---|
| `packages/core/src/constants/bom-entry.ts` | New: scope, evidence, cdxType enums |
| `packages/core/src/contracts/discovered-asset.ts` | Add `DiscoveredBomEntry` with `children[]`; add `bomEntries?` |
| `packages/core/src/contracts/bom-entry.ts` | New: `BomEntry` interface |
| `packages/core/src/validation/` | Zod schema: purl regex, enum checks, default scope=RUNTIME |
| `packages/core/src/index.ts` | Export new types |
| `packages/backend/src/db/types.ts` | `BomEntryRow`, `bom_entries` in `DB` |
| `packages/backend/src/db/migrations/032_bom_entries.ts` | New migration |
| `packages/backend/src/services/bom-service.ts` | New: upsertBomEntryTree, getBomForComponent, exportBomAsCycloneDx, exportBomAsSpdx |
| `packages/backend/src/services/import-run-service.ts` | processAsset: call processBomEntries; trigger runBomMatchingPass at completion |
| `packages/backend/src/routes/components.ts` | `GET /components/:id/bom`, `GET /component-instances/:id/bom` |
| `docs/openapi.yaml` | Add BOM endpoints (ADR-104) |
| `packages/importer-github/src/config.ts` | Add `includeDependencyGraph: boolean` |
| `packages/importer-github/src/github-repos.ts` | Fetch SPDX doc → `bomEntries[]` |
| `packages/importer-sbom-file/` | New importer package |
| `researches/adrs/ADR-057-discoveredasset-final-shape.md` | Append Amendment 1 |
| `.specify/memory/constitution.md` | Principle V clarification |
| `researches/architecture-decisions.md` | Register ADR-131 |
| `packages/frontend/src/ux/` *(UX amendment)* | BOM tab, summary, filters, flat/tree table, export menu, importer form options, `componentBom` flag, gap entry, docs/ux.md update. Full file-level list: [Frontend Touchpoints by Phase](#frontend-touchpoints-by-phase) |
| `docs/ux.md`, `researches/ux-rewrite-gaps.md` *(UX amendment)* | Register tab, flags, vocabulary |

### Phase 2

| File | Change |
|---|---|
| `packages/core/src/constants/component-providers.ts` | Add 13 ecosystem providers |
| `packages/backend/src/db/migrations/033_ecosystem_providers.ts` | Update CHECK constraint |
| `packages/backend/src/db/migrations/034_bom_component_suggestions.ts` | New migration |
| `packages/backend/src/services/bom-service.ts` | Add promoteBomEntry, wireBomEntry, runBomMatchingPass |
| `packages/backend/src/services/import-run-service.ts` | Trigger runBomMatchingPass at completion |
| `packages/backend/src/routes/components.ts` | POST /bom-entries/:id/promote, /wire, GET /impact |
| `docs/openapi.yaml` | Add Phase 2 endpoints |
| `researches/adrs/ADR-013-component-category-taxonomy.md` | Append Amendment 2 |
| `researches/adrs/ADR-131-bom-entry-entity.md` | New ADR |
| `researches/adrs/ADR-132-catalog-promotion-of-bom-entries.md` | New ADR |
| `researches/architecture-decisions.md` | Register ADR-131, ADR-132 |
| `packages/frontend/src/ux/` *(UX amendment)* | Add-to-catalog and Link dialogs, grouped dependency suggestions, Libraries lane, `bomCuration` / `dependencySuggestions` flags. See [Frontend Touchpoints by Phase](#frontend-touchpoints-by-phase) |

### Phase 3

| File | Change |
|---|---|
| `packages/core/src/contracts/discovered-asset.ts` | Add `DiscoveredAssetRelationship`, `relationships?` |
| `packages/core/src/validation/` | Zod schema for `DiscoveredAssetRelationship` |
| `packages/backend/src/services/import-run-service.ts` | Add processImporterEdges pass |
| `packages/importer-github-dependencies/` | New importer (or capability on existing) |
| `researches/adrs/ADR-133-v2-importer-relationship-contract.md` | New ADR |
| `researches/architecture-decisions.md` | Register ADR-133 |

---

## What Is NOT Recommended

- **BOM stored only in `details` JSONB:** No queryability; cross-component CVE
  impact queries impossible. Typed table with purl index is essential.
- **Flat `bom_entries` (no `parentBomEntryId`):** Loses CycloneDX nesting and
  SPDX CONTAINS. Multi-layer container BOMs cannot be faithfully represented.
- **Per-ecosystem tables:** purl encodes ecosystem; one table handles all.
- **Auto-wiring component_depends_on_component on purl match:** Violates
  Constitution Principle V and ADR-113. Human review required in v1.
- **`Component COMPOSES Component` relationship type:** Requires junction table
  (ADR-048), cycle detection (ADR-050), CTE extension (ADR-051), and amendment
  of Constitution Principle IV. `bom_entries` tree achieves the same
  observational goal without altering the graph model.
- **Starting Phase 3 before Phase 2 is validated:** Auto-wiring errors
  proliferate silently without the Phase 2 validation period.

---

## Verification

### Phase 1

1. GitHub importer with `includeDependencyGraph: true` → `GET /components/{id}/bom`
   returns entries with correct purl, version, scope, evidenceSource.
2. Run twice → same entries updated, not duplicated (unique index holds).
3. Ingest CycloneDX JSON via `importer-sbom-file` for a multi-layer container
   → tree depth > 1 in response.
4. `?format=cyclonedx` → valid CycloneDX 1.5 JSON (validate against CycloneDX schema).
5. `?format=spdx` → valid SPDX 2.3 JSON (validate against SPDX schema).
6. Round-trip: ingest SPDX → export as CycloneDX → reimport → no duplicates.
7. *(UX amendment)* All UX acceptance checks in [UX Verification](#ux-verification)
   for Phase 1 pass, including the 5,000-entry pagination check, the Stale and
   Partial states, and the accessibility criteria.

### Phase 2

1. `POST /bom-entries/{id}/promote` → `LIBRARY` Component with correct purl,
   provider=NPM (or appropriate), resourceType=`npm:package`.
2. `POST /bom-entries/{id}/wire` → `component_depends_on_component` row written.
3. `GET /components/{consuming-id}/relationships` shows library in `dependsOn[]`
   lane (first real data in this endpoint since spec 060).
4. PURL_EXACT match → `bom_component_suggestions` row created.
5. Accept suggestion → junction row written, suggestion SUPERSEDED.

### Phase 3

1. GitHub dependencies importer → `LIBRARY` Components created automatically.
2. `component_depends_on_component` rows written for all yielded edges.
3. Second run → `ON CONFLICT DO NOTHING` — no duplicates.
4. Human wire same pair via Phase 2 → importer re-run → human edge preserved.
5. `GET /components/{repo-id}/relationships` shows full dependency graph.

---

## Next Steps

Run the spec-kit workflow starting with Phase 1:

1. `speckit-specify` → `specs/NNN-bom-inventory/spec.md`  
   Draft ADR-057 Amendment 1 and new ADR-131 in the same spec run. Carry the
   `UX-BOM`, `UX-FRESH`, `UX-EXP` and `UX-IMP` requirements in as functional
   requirements (MUST items are acceptance criteria), resolve the
   [Open UX Questions](#open-ux-questions-for-the-specify--grill-step), and
   schedule `UX-PKG` as the Phase 1b follow-up spec.
2. `speckit-plan` → `plan.md` and `data-model.md`
3. `speckit-tasks` → `tasks.md` broken into the Phase 1 touchpoints above
4. Phase 2 (`NNN-bom-catalog-promotion`) and Phase 3 (`NNN-bom-importer-native`)
   are separate specs, run after the previous phase ships.
