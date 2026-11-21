# Data Model: BOM Catalog Promotion (Phase 2)

**Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## New entity — `bom_component_suggestions` (migration `035`)

ADR-113 lifecycle clone of `edge_suggestions`, for component→library `DEPENDS_ON` candidates.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | UUID v7, SQL parameter (ADR-045) |
| `bomEntryId` | uuid NULL → `bom_entries(id)` ON DELETE SET NULL (amended by migration 037 — pruning must not cascade-delete decided rows, which would lose the pair-guard and resurrect DISMISSED pairs) | the factual row that produced the candidate |
| `parentComponentId` | uuid NOT NULL → `components(id)` ON DELETE CASCADE | the consuming component (edge source) |
| `childComponentId` | uuid NOT NULL → `components(id)` ON DELETE CASCADE | the library/candidate component (edge target) |
| `reason` | text NULL CHECK in (`PURL_EXACT`,`PURL_NAME_MATCH`,`CATALOG_SLUG_MATCH`) | nullable so SUPERSEDED tombstones drop it (`edge_suggestions` parity) |
| `score` | integer NULL | centi-score (score×100), matching the edge queue convention |
| `status` | text NOT NULL DEFAULT `PENDING` CHECK in (`PENDING`,`ACCEPTED`,`DISMISSED`,`SUPERSEDED`) | only PENDING actionable; terminal states final |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |
| `decidedAt` | timestamptz NULL | set on any terminal transition (incl. system tombstones) |
| `decidedBy` | uuid NULL → `persons(id)` ON DELETE SET NULL | NULL on system-marked rows |

**Constraints**: `UNIQUE (parentComponentId, childComponentId)` — one row per pair ever; decided pairs never resurrect (upsert touches PENDING only). Indexes: PK; unique pair; `(childComponentId, status)` for grouped pending reads; `(status)` for the queue.

**Core constants** (`constants/bom-component-suggestion.ts`): `BOM_SUGGESTION_REASONS`, `BOM_SUGGESTION_STATUSES` (reuse the shared status enum if identical — decide at implementation), badge meta mapping `PURL_EXACT`→"Exact package match", `PURL_NAME_MATCH`→"Name match", `CATALOG_SLUG_MATCH`→"Catalog name match".

### State machine

```text
            stage (matching pass / only-add path)
 PENDING ────────────────► PENDING (re-staged: reason/score refreshed)
    │ accept (human)      │ edge created elsewhere      │ dismiss (human)
    ▼                     ▼                             ▼
 ACCEPTED            SUPERSEDED (reason/score → NULL)  DISMISSED
    └──────── terminal — never transitions again ────────┘
```

- Accept writes `component_depends_on_component(parentId, childId)`; if the edge already existed the row lands `SUPERSEDED` not `ACCEPTED` (edge-queue parity).
- A PENDING row whose pair gains an edge through Link-all/manual authoring flips to `SUPERSEDED` in the same transaction (edge-queue `supersedeSuggestionPairs` parity) — except when the covering action itself is the human's decide (Link-all marks `ACCEPTED`, the decision was made).

## Library Component (existing `components` row, curated)

| Field | Value | Source |
|---|---|---|
| `category` | from `cdxType` mapping (usually `LIBRARY`) | `bom_entries.cdxType` |
| `provider` | from `ecosystem` mapping; `docker`/`oci` resolve registry hostname → `DOCKER`/`GHCR`/`ECR`; unmapped → `OTHER` | `bom_entries.ecosystem`/purl |
| `resourceType` | purl type verbatim (`npm:package`) | purl |
| `externalId` | **normalized version-free purl** (`purlIdentity`) | `bom_entries.purlIdentity` |
| `name` | package name | entry/`purlIdentity` |
| `slug` | `pkg-{type}-{name}` slugified (`@scope/name`→`pkg-npm-scope-name`), numeric `-N` suffix on collision | ADR-046 |
| `lifecycle` | `ACTIVE`; no importer source (manual provenance: `createdBy`, audit) | |

One Library per `purlIdentity` workspace-wide. Dedupe = normalized-identity equality on `components.externalId` across **all** providers/categories — service-layer (no DB unique constraint). Versions never live on the Library.

### `cdxType` → `ComponentCategory`

`library`,`framework`,`machine-learning-model`→`LIBRARY`; `container`→`CONTAINER`; `device`,`firmware`,`operating-system`,`platform`,`application`→`COMPUTE`; `service`→`API`; `file`,`data`→`STORAGE`; unmapped/other→`LIBRARY` (packages default) — the `mappedFrom` note surfaces every non-`library`/`framework` inference in the dialog.

### `ecosystem` → `ComponentProvider` (13 new values, migration `036`)

`npm`→`NPM`, `pypi`→`PYPI`, `maven`→`MAVEN`, `nuget`→`NUGET`, `golang`→`GOLANG`, `cargo`→`CARGO`, `gem`→`RUBYGEMS`, `composer`→`PACKAGIST`, `deb`→`DEBIAN`, `rpm`→`RPM`, `apk`→`ALPINE`, `docker`/`oci`→`DOCKER`|`GHCR`|`ECR` (registry hostname), other→`OTHER`. Provider UI groups: *Platforms* (existing 11) vs *Package registries* (new 13).

## `component_depends_on_component` (existing, first writer)

`(parentId, childId, createdAt)` PK `(parentId,childId)`, cascade FKs. Written ONLY by human actions: suggestion accept/bulk-accept, Link-all, Add-and-link. `INSERT … ON CONFLICT DO NOTHING` — pre-existing edges never error, counted separately for the result copy. Library deletion cascades edges and `SET NULL`s `bom_entries.resolvedComponentId` (schema already ships both).

## `bom_entries` (existing — populated, not altered)

`resolvedComponentId` gains writers: the matching pass (exact identity only) and the curation endpoints (all consumers' entries). `pendingSuggestionId` on the read contract = the PENDING suggestion id for the entry's `(componentId, purlIdentity)` scope — the join tolerates a NULL rep (post-pruning SET NULL) via the child's verbatim-normalized `externalId`. `catalog` filter (`linked|suggested|none`) activates: `linked`→`resolvedComponentId IS NOT NULL`; `suggested`→pending suggestion exists (when not linked — UI precedence); `none`→neither.

## `components` list contract delta

`libraries` param (`1`/`true` → include); default population excludes `category='LIBRARY'`; response adds `librariesHidden: number`. `coveragePopulationPredicate` gains `category != 'LIBRARY'` (feeds Coverage filter + dashboard denominators — amendment recorded in spec 023).

## `ComponentRelationships` contract delta

`libraryCounts: { dependsOn: number, dependedOnBy: number }` added; `dependsOn`/`dependedOnBy` lane arrays exclude `LIBRARY`-category neighbours. All other lanes unchanged.

## `/packages` contract delta (shipped fields, now live)

`catalogComponent`: the component whose `externalId` equals the row's `purl` (id/slug/name) or null. `pendingSuggestionCount`: distinct PENDING `bom_component_suggestions` whose `childComponentId` is that component — 0 when no catalog component. `catalog` filter: `linked`→has catalogComponent; `suggested`→pending>0; `none`→neither.

## Provider taxonomy migration (`036`)

Rebuild `components_provider_check` (drop/add, `015_alibaba_cloud_provider.ts` pattern) listing all 24 providers. `COMPONENT_PROVIDERS` + `COMPONENT_PROVIDER_META` gain the 13 entries with labels/descriptions from the research table.
