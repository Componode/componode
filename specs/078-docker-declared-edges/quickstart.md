# Quickstart: Docker Importer Declared-Edge Carrier

Validation scenarios proving spec `078-docker-declared-edges` end-to-end. Commands assume repo root on branch `078-docker-declared-edges`.

## Scenario A — unit-level opt-in emission (importer contract)

```bash
pnpm --filter @componode/importer-docker test
pnpm --filter @componode/importer-docker typecheck
```

Expect: `declared-edges.test.ts` green — opted-in runs emit `relationships` on every bom-bearing asset (workload + image), one `LIBRARY` asset per purl identity per run with `DEPENDS_ON` package→package + `→ docker-image:{digest}` declarations; `relationships: []` authoritative-empty when the doc has no graph; field absent when no bom; all assets pass `validateDiscoveredAsset`; opt-out yields the pre-feature shape; `importDeclaredEdges` without `includeSbom` fails schema parse.

```bash
pnpm --filter @componode/core test
pnpm --filter @componode/importer-kubernetes test
```

Expect: `oci-referrers` tests green — `ImageBomResult.edges` populated for CycloneDX + SPDX attestations; kubernetes suite unchanged (ignores the new field — SC-005 parity).

## Scenario B — backend machinery unchanged

```bash
pnpm --filter @componode/backend test
```

Expect: existing edge-pass suites (`import-run-edges.test.ts`) green with zero edits — `declaredEdgesConfigKey` + field-presence gate cover the third carrier (FR-007, SC-005).

## Scenario C — end-to-end journey (Playwright)

```bash
cd playwright && pnpm e2e --grep "docker.*declared|docker.*edge"
```

Expect the journey spec green: mock engine serves OCI `/v2/` routes for an SBOM-scenario image → docker config (`includeSbom` + `importDeclaredEdges`) completes a run → the workload component's Relationships tab shows **Added by importer** `DEPENDS_ON` rows to `LIBRARY` components with Source/run links → **Hide edge** on the disposable pair → re-run does not recreate it → second identical run adds zero duplicates → the create/edit form shows the opt-in switch (review-bypass copy) under flag `bomImporterEdges` and hides it when the flag is OFF → `importDeclaredEdges` without `includeSbom` is rejected at save.

## Scenario D — docs + governance

```bash
pnpm docs:importers && pnpm docs:importers:check
```

Expect: `docs/importers/docker.md` regenerated table includes `importDeclaredEdges` with the review-bypass copy; check passes (no drift). ADR-133 carrier note names docker as the third carrier; `docs/roadmap.md` shipped note updated.

## Failure modes to spot-check

- Image with no `RepoDigests` → `bomInventory` UNAVAILABLE marker only; no `relationships`, no LIBRARY contribution.
- Opted-in run, registry 404 on referrers, no `syft` → identical to today's degraded yield; a prior importer edge set is not retired.
- Two workloads on one image → each gains its own `workload → pkg` edges; one `LIBRARY` per package run-wide; second run adds nothing.
- `includeImages` on + doc edge `pkg → subject` → `pkg → docker-image:{digest}` edge materializes; with `includeImages` off it drops silently.
