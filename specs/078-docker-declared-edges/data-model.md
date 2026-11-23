# Data Model: Docker Importer Declared-Edge Carrier

Phase 1 output for spec `078-docker-declared-edges`. **No persisted schema changes** — every entity below already exists; the feature changes only what the importer emits.

## Contract types touched

### `ImageBomResult` (packages/core, `utils/oci-referrers.ts`) — additive field

| Field | Type | Change | Rule |
|---|---|---|---|
| `entries` | `DiscoveredBomEntry[]` (optional) | unchanged | Present iff a parseable SBOM was collected; presence = completeness (ADR-057 A1). |
| `edges` | `SpdxEdge[]` (optional) | **NEW** | Present iff `entries` is present — the parsed document's dependency graph, normalized version-free purl identities, `SPDX_EDGE_SUBJECT` sentinel intact (callers substitute). Absent ⇔ `entries` absent. |
| `marker` | `BomCapabilityMarker` | unchanged | `OK` / `FORBIDDEN` / `ERROR` / `UNAVAILABLE` for `capabilities.bomInventory`. |

Population sources (all three must produce `edges`):

| Path | Format(s) | Where edges come from |
|---|---|---|
| OCI referrers attestation | CycloneDX JSON | `parseCycloneDxDocument(...).edges` (was discarded in `parseDoc`) |
| OCI referrers attestation | SPDX JSON | `parseSpdxDocument(...).edges` (same discard) |
| Syft subprocess fallback | CycloneDX JSON | `parseCycloneDxDocument(...).edges` (discarded at the call site) |

### `DiscoveredAsset.relationships` (existing, ADR-133) — emitted by this carrier

| Rule | Carrier assets (workload `CONTAINER`, `docker-image:*` `PACKAGE_REGISTRY`) | `LIBRARY` assets |
|---|---|---|
| Presence | Field **present** (possibly `[]`) iff the asset received `bomEntries` under opt-in; omitted otherwise — mirrors `bomEntries` completeness | Present only when non-empty (`buildLibraryAsset` invariant) |
| `from === SUBJECT` | Substitute the carrier's own externalId | Never matches (identities are purls) |
| `to === SUBJECT` | Substitute `docker-image:{digestRef}` | Substitute `docker-image:{digestRef}` of the digest the library was first seen under |
| Type | `DEPENDS_ON` only | `DEPENDS_ON` only |
| Opt-out | Field never emitted | Assets never yielded |

### `LIBRARY` asset (shared `buildLibraryAsset`) — yield contract

| Field | Value |
|---|---|
| `category` / `resourceType` | `LIBRARY` / purl type segment (`generic` fallback) |
| `externalId` | normalized version-free purl identity (dedup key within the run AND the catalog `(category, provider, externalId)` triple) |
| `provider` | `mapEcosystemToProvider(purlType, purl)` |
| `slug` | `pkg-{type}-{name}` (`unnamed` fallback) |
| `instances` / `details` | `[]` / `{ purl, version? }` |
| `relationships` | outgoing `DEPENDS_ON` entries (omitted when empty) |
| Run-level dedup | yielded at most once per run per identity (first digest wins) |

## Edge projection rules (doc graph → catalog edges)

| Document edge | Emitted as | Resolved when |
|---|---|---|
| `SUBJECT → pkg` | `carrier-externalId → pkg-identity` on each SBOM-bearing asset | `pkg` yielded as LIBRARY (or other carrier) in-run |
| `pkgA → pkgB` | `pkgA-identity → pkgB-identity` on pkgA's LIBRARY asset | `pkgB` yielded in-run |
| `pkg → SUBJECT` | `pkg-identity → docker-image:{digestRef}` on the LIBRARY asset | image asset emitted in-run (`includeImages` on); else silent drop |
| purl-less endpoint | — | parser-level skip (counted in `skipped`) |
| self / duplicate | — | parser `dedupeEdges` collapse |

## Validation rules from requirements

- `dockerConfigSchema`: `importDeclaredEdges` boolean default `false`; `.refine(!importDeclaredEdges || includeSbom)` at save; manifest `declaredEdgesConfigKey` activates the backend gate + flagged form switch.
- Every emitted asset passes `validateDiscoveredAsset` before yield (FR-009).
- `FAILED`/`CANCELLED`/`INTERRUPTED`/degraded runs: no `relationships` field on bomless carriers → the run is non-authoritative for edges (ADR-057 A1-style presence doctrine, spec 077 T021).
