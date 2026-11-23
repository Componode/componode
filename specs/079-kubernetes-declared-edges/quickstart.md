# Quickstart: Kubernetes Declared-Edge Carrier

Validation scenarios proving spec `079-kubernetes-declared-edges` end-to-end. Commands assume repo root on branch `079-kubernetes-declared-edges`.

## Scenario A — unit-level opt-in emission (importer contract)

```bash
pnpm --filter @componode/importer-kubernetes test
pnpm --filter @componode/importer-kubernetes typecheck
```

Expect: `declared-edges.test.ts` green — opted-in runs emit `relationships` on every bom-bearing workload asset, one `LIBRARY` asset per purl identity per run with the run-wide union of `DEPENDS_ON` package→package + `→ docker-image:{digest}` declarations; `relationships: []` authoritative-empty when the doc has no graph; field absent on marker-only workloads; partial image coverage declares only the resolved set; all assets pass `validateDiscoveredAsset`; opt-out yields the pre-feature shape; `importDeclaredEdges` without `includePodImageSbom` fails schema parse.

```bash
pnpm --filter @componode/core test
pnpm --filter @componode/importer-docker test
```

Expect: core + docker suites green **unchanged** — the only shared artifact (`ImageBomResult.edges`) was delivered by spec 078 (SC-005).

## Scenario B — backend machinery unchanged

```bash
pnpm --filter @componode/backend test
```

Expect: existing edge-pass suites (`import-run-edges.test.ts`) green with zero edits — `declaredEdgesConfigKey` + field-presence gate cover the fourth carrier (FR-007, SC-005).

## Scenario C — end-to-end journey (Playwright)

```bash
cd playwright && pnpm e2e --grep "kubernetes.*declared|kubernetes.*edge"
```

Expect the journey spec green: `mock-kubernetes` serves pod/RS fixtures whose image digest points at `mock-docker-engine:5000`'s OCI listener (scenario `sbom`) → kubernetes config (`endpoint`, `includePodImageSbom` + `importDeclaredEdges`) completes a run → the `apps/v1:Deployment` workload component's Relationships tab shows **Added by importer** `DEPENDS_ON` rows to `LIBRARY` components with Source/run links → `express → accepts` library edge exists; `pw-lib → docker-image:{digest}` does **not** exist (same-run drop) → **Hide edge** on the disposable pair → re-run does not recreate it → `sbom-reduced` re-run retires exactly `express → accepts` → second identical run adds zero duplicates → the create/edit form shows the opt-in switch (review-bypass copy) under flag `bomImporterEdges` and hides it when the flag is OFF → `importDeclaredEdges` without `includePodImageSbom` is rejected at save.

## Scenario D — docs + governance

```bash
pnpm docs:importers && pnpm docs:importers:check
```

Expect: `docs/importers/kubernetes.md` regenerated table includes `importDeclaredEdges` with the review-bypass copy; check passes (no drift). ADR-133 carrier note names kubernetes as the fourth carrier; `docs/roadmap.md` shipped note updated.

## Failure modes to spot-check

- Pod image with no resolvable digest (`busybox:latest`) or no attestation → `bomInventory` marker only; no `relationships`, no LIBRARY contribution.
- `sourceKey`-only config (no `endpoint`) → same marker-only yield; prior importer edges untouched.
- One workload's images all fail while another's resolve → the failed workload is non-authoritative (no `relationships`); the resolved one declares its set.
- An image that resolved last run failing this run on a shared workload → its entries AND its prior importer edges retire (partial-coverage authority — same doctrine as `bomEntries`).
- `importDeclaredEdges` ON + `includePodImageSbom` OFF → rejected at config save (400) before any run.
