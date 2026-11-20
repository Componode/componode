# SBOM / Bill of Materials — Architecture Research

**Purpose:** Define the architecture and data model for introducing
Software Bill of Materials (SBOM) / Bill of Materials (BoM) support into
Componode DPAM. Every component (repository, container, server, API) is
itself composed of sub-components: npm packages, Python modules, OS packages,
firmware, Go modules, Maven dependencies, etc. This research defines how to
catalog that layer in a way that is scalable across all 25 existing component
categories and all future ones.

**Scope:** Data model, importer contract extension, CycloneDX / SPDX
bidirectional compatibility, three-phase rollout strategy, and ADR impact.
This document is informative — where findings conflict with a ratified ADR the
conflict is flagged explicitly, not silently overridden. Claims are grounded in
the actual codebase state at the time of writing (2026-11-20).

**Status:** Research complete — ready for `speckit-specify` (Phase 1 first).

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

## ADR Impact Summary

| ADR | Type | Phase | Key content |
|---|---|---|---|
| **ADR-057 Amendment 1** | Amendment | 1 | Add `DiscoveredBomEntry` and `bomEntries?: DiscoveredBomEntry[]`. Explicitly state: `bomEntries` is factual inventory, not a graph edge. Prohibition on `relationships[]` for edge declarations is unchanged. |
| **ADR-013 Amendment 2** | Amendment | 2 | Add 13 ecosystem `ComponentProvider` values. Add `cdxType → ComponentCategory` mapping. Update DB CHECK constraint. |
| **New ADR-131** | Ratification | 1 | BomEntry entity: tree via `parentBomEntryId`; upsert-on-report; no orphan/retirement semantics; source-scoped; `resolvedComponentId` set by matching pass only. |
| **New ADR-132** | Ratification | 2 | Catalog promotion: EDITOR-only; Library Component identity = version-free purl; `bom_component_suggestions` follows ADR-113; no auto-wiring ever. |
| **New ADR-133** | Ratification | 3 | v2 importer contract: lifts `relationships[]` prohibition; same-run scope only; auto-reconciliation to junction tables; `ON CONFLICT DO NOTHING` for human edges. |
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
   Draft ADR-057 Amendment 1 and new ADR-131 in the same spec run.
2. `speckit-plan` → `plan.md` and `data-model.md`
3. `speckit-tasks` → `tasks.md` broken into the Phase 1 touchpoints above
4. Phase 2 (`NNN-bom-catalog-promotion`) and Phase 3 (`NNN-bom-importer-native`)
   are separate specs, run after the previous phase ships.
