# Data Model: Kubernetes Declared-Edge Carrier

Phase 1 output for spec `079-kubernetes-declared-edges`. **No persisted schema changes** — every entity below already exists; the feature changes only what the importer emits.

## Contract types touched

### `PodImageBom` (packages/importer-kubernetes, `k8s-pods.ts`) — additive field

| Field | Type | Change | Rule |
|---|---|---|---|
| `entries` | `DiscoveredBomEntry[]` (optional) | unchanged | Present iff ≥1 of the workload's pod images resolved a parseable SBOM; union across resolved images, `k8s:pod-spec:image:{image}` evidenceDetail. |
| `edges` | `{ from: string; to: string }[]` (optional) | **NEW** | Union across the same resolved images of each document's `ImageBomResult.edges` — version-free purl identities; `from === SPDX_EDGE_SUBJECT` intact (emission substitutes the workload's externalId); `to === SPDX_EDGE_SUBJECT` already resolved to `docker-image:{digestRef}` at collection. Present ⇔ `entries` present. |
| `marker` | `BomCapabilityMarker` | unchanged | `OK` when ≥1 image resolved; else worst cause — writes `capabilities.bomInventory`. |

`ImageBomResult`/`fetchImageBom` (core) are **unchanged** — spec 078 already populated `edges` on the referrers path kubernetes consumes.

### `DiscoveredAsset.relationships` (existing, ADR-133) — emitted by this carrier

| Rule | Carrier assets (workload `CONTAINER_ORCHESTRATION`) | `LIBRARY` assets |
|---|---|---|
| Presence | Field **present** (possibly `[]`) iff the asset received `bomEntries` under opt-in; omitted otherwise — mirrors `bomEntries` completeness | Present only when non-empty (`buildLibraryAsset` invariant) |
| `from === SUBJECT` | Substitute the workload's own externalId | Never matches (identities are purls) |
| `to === SUBJECT` | Substitute `docker-image:{digestRef}` (pre-resolved at collection) | Same — always absent from a kubernetes run → drops at the edge pass |
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
| `relationships` | run-wide union of outgoing `DEPENDS_ON` entries (omitted when empty) |
| Run-level dedup | yielded at most once per run per identity (first workload wins) |

## Edge projection rules (doc graph → catalog edges)

| Document edge | Emitted as | Resolved when |
|---|---|---|
| `SUBJECT → pkg` (of image X's document) | `workload-externalId → pkg-identity` on the workload carrying X's BOM | `pkg` yielded as LIBRARY (or other asset) in-run |
| `pkgA → pkgB` | `pkgA-identity → pkgB-identity` on pkgA's LIBRARY asset (run-wide union) | `pkgB` yielded in-run |
| `pkg → SUBJECT` (of image X's document) | `pkg-identity → docker-image:{X-digestRef}` on the LIBRARY asset | **Never** — no `docker-image:*` asset exists in a kubernetes run → silent drop (same-run scope, ADR-133 §2) |
| purl-less endpoint | — | parser-level skip (counted in `skipped`) |
| self / duplicate | — | parser `dedupeEdges` collapse + `(from,to)` map-key dedup at collection |

## Validation rules from requirements

- `kubernetesConfigSchema`: `importDeclaredEdges` boolean default `false`; refinement rejects `importDeclaredEdges && !includePodImageSbom` at save (error on the `importDeclaredEdges` path); manifest `declaredEdgesConfigKey` activates the backend gate + flagged form switch.
- **Partial-coverage authority**: a workload with ≥1 resolved image emits `bomEntries`+`relationships` for the resolved set only — authoritative for it (mirroring `bomEntries`' existing semantics); a workload with zero resolved images emits neither and is non-authoritative.
- Every emitted asset passes `validateDiscoveredAsset` before yield (FR-009).
- `FAILED`/`CANCELLED`/`INTERRUPTED`/marker-only yields: no `relationships` field → the run is non-authoritative for edges on that carrier (ADR-057 A1-style presence doctrine).
