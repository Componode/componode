# Quickstart: BOM Importer-Native Declared Edges (Phase 3)

End-to-end validation that the feature works. Assumes a seeded workspace (Phase 1–3 importers configured) — see `playwright/` seed fixtures for the scripted version of these steps.

## Scenario A — opt-in → declared graph (US1)

1. Edit a GitHub ImporterConfig: enable **Include dependency graph** and the new **Import declared edges** switch. The form shows: "Imported dependencies are added to the catalog without review. You can hide any edge later."
2. Trigger a run; wait for `COMPLETED`.
3. Open a repository component → Relationships tab: every dependency edge to a library shows **Added by importer**; `/packages` shows the auto-created LIBRARY components.
4. Trigger the same run again → run detail shows 0 new edges; the Relationships tab is identical (no duplicates).
5. Repeat against a repo whose dep graph changed → the dropped dependency's edge disappears; every other importer-added and curated edge is unchanged.

## Scenario B — provenance in one click (US2)

1. On any component with both curated and importer-added edges: curated rows show **Curated**, imported rows show **Added by importer**.
2. Click the importer badge → lands on the reporting Source; the run link lands on that run's detail page.
3. Manually link a component to a library the importer also reports (Phase-2 Link) → after the next run the edge still shows **Curated** (never relabelled).

## Scenario C — hide persists (US3)

1. As an Editor, open the row menu on an importer-added edge → **Hide edge** → confirm. The edge disappears immediately.
2. Re-run the importer (still declaring it) → the edge does not return.
3. As a Viewer, the same row shows no **Hide edge** item; a direct `POST /component-edge-suppressions` returns `403`.
4. Link the same pair manually (if reachable via a suggestion/link path) → the human edge lands and displays **Curated** — suppression only blocks importer recreation.

## Scenario D — off-switch is inert (edge cases)

1. Disable the opt-in switch → re-run → no edges written or removed; any `relationships[]` in the yield is ignored.
2. A run cancelled mid-flight writes no edges and deletes none.

## Verify

- `pnpm test` in `packages/core` (relationship schema + SPDX edge projection), `packages/backend` (migration, edge pass incl. opt-in/suppression/retire paths, hide route, provenance read, openapi contract), `packages/importer-github` (config + asset/relationships yield), `packages/frontend` (badge/hide/switch units).
- `pnpm e2e` in `playwright/` — the UX-EDGE journey specs.
