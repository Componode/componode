# Quickstart: SBOM File Declared-Edge Carrier

End-to-end validation that the second carrier materializes declared edges.

## Prerequisites

- Repo deps installed (`pnpm install`), backend + DB up (dev stack or
  Playwright stack for e2e).
- A catalog component to target (any existing component — sbom-file
  attaches, never creates, the subject).
- A CycloneDX or SPDX JSON document reachable over HTTPS **with a
  dependency graph** (`dependencies[]` / `DEPENDS_ON` relationships) —
  without a graph, the opt-in yields LIBRARY components but zero edges.

## Scenario A — unit level (fastest)

```bash
cd packages/importer-sbom-file && pnpm test
```

Expected: new opt-in cases pass — SPDX + CycloneDX emit `relationships[]`
on the component and LIBRARY assets, `SUBJECT` substitutes in both
positions, opt-out output matches the pre-feature shape; every emitted
asset passes `validateDiscoveredAsset`.

## Scenario B — live run

1. Create/edit an SBOM File importer config: `sbomUrl` → a CycloneDX
   document with `dependencies[]`, `componentSlug` → the target
   component, and enable **Import declared dependencies as catalog
   edges** (the switch shows the review-bypass copy).
2. Trigger a run; wait for `COMPLETED`.
3. Open the target component → **Relationships** tab.
   Expected: subject-declared edges collapse into the bounded
   "N libraries" summary (spec 075 hides LIBRARY neighbours); opening a
   declared library → **Relationships** shows the target in its
   "Depended on by" lane labelled **Added by importer**, with provenance
   links reaching the Source + run.
4. Open a library that declared its own deps → its "N libraries" summary
   counts the libraries it declared (LIBRARY→LIBRARY edges never render
   as rows); its **Used by** surface shows consumers with the
   importer-provenance badge.
5. **Hide edge** one importer-added edge (Editor) → re-trigger the run →
   the hidden edge does not return; other edges re-materialize cleanly
   (no duplicates).
6. Turn the opt-in OFF → trigger a run → no new edges/libraries; existing
   importer edges persist.

## Scenario C — Playwright e2e

```bash
cd playwright && pnpm e2e --grep "sbom-file"
```

Expected: the spec creates its own opted-in config targeting the seeded
non-LIBRARY `pw-edge-*` component (a dedicated mock URL keeps its
ImporterSource isolated); importer-added edges render on the libraries'
dependedOnBy lanes with provenance + durable **Hide edge**, a curated
edge on a declared pair stays **Curated**, and the opt-in switch renders
its review-bypass copy on the sbom-file form.

## Failure checks

- Document without a dependency graph + opt-in → run completes, LIBRARY
  components exist, zero edges, no error.
- `componentSlug` pointing at a deleted component → run fails at dispatch
  (unchanged behavior), no partial edge state.
