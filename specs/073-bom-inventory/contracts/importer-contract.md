# Contract: importer BOM inventory (ADR-057 Amendment 1)

**Feature**: `073-bom-inventory` | **Date**: 2026-11-20

## `DiscoveredBomEntry` — the yield shape

```ts
interface DiscoveredBomEntry {
  purl: string;                        // REQUIRED — valid Package URL (canonical identity)
  name: string;                        // REQUIRED
  evidenceSource: BomEvidenceSource;   // REQUIRED — where it was found
  evidenceDetail?: string | null;      // e.g. lockfile path, "k8s:pod-spec:image:{ref}"
  version?: string | null;
  scope?: BomDependencyScope;          // default RUNTIME
  direct?: boolean;                    // default scope !== 'TRANSITIVE' (direct wins on conflict, Q4)
  licenses?: string[];                 // SPDX expressions
  supplier?: string | null;
  cdxType?: BomCdxType | null;         // CycloneDX component.type (round-trip; Phase-2 category)
  cdxBomRef?: string | null;           // intra-document ref
  children?: DiscoveredBomEntry[];     // nested assemblies / SPDX CONTAINS
  details?: Record<string, unknown> | null;  // CPE, checksums, extras
}
```

Carried on `DiscoveredAsset.bomEntries` **and** `DiscoveredAssetInstance.bomEntries` — factual observational data (like `details`/`rawConfig`), never a graph-edge declaration. The `relationships[]` prohibition is unchanged.

## Completeness contract (normative)

| Yield | Meaning | Effect on the Source's prior set in that scope |
|---|---|---|
| field **absent** | not attempted / collection failed | **preserved** (staleness accrues) |
| `bomEntries: []` | collection finished, truth is empty | **replaced → deleted** |
| `bomEntries: [...]` | collection finished | **replaced** (upsert present keys, delete absent) |

Replace happens only on `COMPLETED` runs, per `(componentId, componentInstanceId|null)` scope the run reported on. Importers that cannot collect MUST omit the field and report `bomInventory` non-OK — never yield `[]` to signal failure.

## Per-importer config additions

**GitHub** (`githubConfigSchema`):

```ts
includeDependencyGraph: z.boolean().default(false)
  .describe("Import each repository's package inventory into its bill of materials. Uses GitHub's dependency graph, so private repositories need the 'Dependency graph' permission on the token.")
```

Fetch `GET /repos/{owner}/{repo}/dependency-graph/sbom` (SPDX 2.3 → `bomEntries`, `evidenceSource=REGISTRY_API`, component-level scope); fallback per research's lockfile/manifest table (`LOCK_FILE`/`MANIFEST_FILE` with the file path as `evidenceDetail`).

**Docker** (`includeSbom`, default false): OCI Referrers API for SBOM attestations (CycloneDX or SPDX); Syft subprocess fallback on the agent host per research. `evidenceSource=IMAGE_LAYER`; `cdxType="container"` nesting preserved. Images without attestations report no inventory (helper text says so).

**Kubernetes** (`includePodImageSbom`, default false): per pod `containers[].image` → OCI referrers → `bomEntries` on the workload asset; `evidenceDetail="k8s:pod-spec:image:{image_ref}"`; helper text names required registry access.

**`importer-sbom-file` (NEW package)** — manifest `name: "sbom-file"`, `reportsSourceIdentity: true`:

```ts
{
  sbomUrl: z.string().url() + url-safety refinement (HTTPS required),
  componentSlug: z.string().min(1)
    .describe("Slug of the catalog component this SBOM describes. The document is attached to that component — if it no longer exists at run time the import fails; it never creates a component.")
}
```

- Save-time: `componentSlug` MUST resolve to an `ACTIVE` component (config validation hook on create/update — same place other scope rules validate).
- Dispatch-time: backend resolves slug → `(category, provider, externalId)` triple, injected into the importer scope; the importer yields one `DiscoveredAsset` with that identity + `bomEntries` so normal dedup merges onto the component and the sbom-file Source becomes an additional reporter. Unresolvable at dispatch → run fails with clear error.
- Format auto-detect: `bomFormat === "CycloneDX"` → CycloneDX parser; `spdxVersion` present → SPDX parser; else `VALIDATION_FAILED`.

## `bomInventory` capability family

Every importer that adds a BOM toggle reports `bomInventory` status via its existing capability mechanism (GitHub `capabilities.ts`; others their degradation pattern). Statuses: `OK` | `UNAVAILABLE` | `FORBIDDEN` | `ERROR` with message + affected count. Non-OK never fails the run. Frontend `CAPABILITY_LABELS` += `"Dependency inventory"` (UX-IMP-03).
