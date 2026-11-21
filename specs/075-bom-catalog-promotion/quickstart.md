# Quickstart: BOM Catalog Promotion (Phase 2)

**Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md) | **Contracts**: [contracts/](./contracts)

End-to-end validation scenarios proving each user story. Prerequisites: stack running (`pnpm dev` or Compose), seeded BOM data (`playwright/data/seed-app-flows.ts` fixtures extended for this spec), an EDITOR and a VIEWER session.

## Scenario A — Add to catalog (US1)

1. Seed: ≥3 components reporting `pkg:npm/lodash` (two versions), plus a `pkg:deb/openssl` consumed by zero catalog-matched components.
2. As EDITOR, open a consumer's `?tab=bom` → row menu → **Add to catalog**.
3. Verify: dialog title "Add lodash to the catalog"; preview shows `LIBRARY` / `npm` provider group "Package registries" / identity `pkg:npm/lodash` / "Used by 3 components" — matches `GET /packages/add-to-catalog/preview?purl=pkg:npm/lodash`.
4. Confirm with **Link all 3** → toast + View action.
5. Verify: `GET /components/pkg-npm-lodash` → `LIBRARY`, `externalId=pkg:npm/lodash`; `GET /components/{consumer}/relationships` → `dependsOn` excludes the library but `libraryCounts.dependsOn = 1`; BOM rows show *Linked*; `resolvedComponentId` set on all three entries.
6. Repeat on openssl with **Only add to catalog** → zero edges; suggestions staged.

## Scenario B — Link to existing (US2)

1. Create a component via the normal form whose `externalId` is `pkg:pypi/requests` (or seed one under a different provider).
2. Row-menu action on that package → dialog is **Link to existing component** naming the seeded component — no create form.
3. **Link all N** → edges to the existing component; no new component created.

## Scenario C — Matching pass (US3)

1. Seed a Library (`pkg:npm/left-pad`) then complete an import run whose component reports `left-pad`.
2. Verify: entry `resolvedComponentId` set; `GET /suggestions?kind=dependency` shows a `PURL_EXACT` PENDING row; **zero** `component_depends_on_component` rows created.
3. Seed a component *named* "requests" (no purl match) → `PURL_NAME_MATCH` suggestion, `resolvedComponentId` stays NULL.
4. Re-run → no duplicate/decided-pair resurrection.

## Scenario D — Suggestion review (US4)

1. `/suggestions?kind=dependency`: groups render per library with badge/count/purl; nav badge still counts product edges only.
2. Exact group → **Accept all N** → confirm dialog with count + finality → N edges created, rows `ACCEPTED`, live-region announcement.
3. Name-match group → no *Accept all*; per-row Accept works; **Dismiss all** works.
4. `POST /suggestions/dependencies/bulk {action:"accept"}` on a mixed group → `409`.
5. History shows dependency decisions with decider; product-edge History unchanged.

## Scenario E — Legibility (US5)

1. Seed 200+ libraries wired to one consumer.
2. `/components` → libraries hidden; "Show libraries (N)" reveals them via `?libraries=1`; direct `/components/pkg-*` link resolves.
3. Coverage filter + dashboard wired/unwired counts identical to pre-seed (libraries excluded).
4. Provider filter shows *Platforms* / *Package registries* groups.
5. Library detail: identity block (purl/ecosystem/provider), Used-by paginated consumers, Versions-in-use chips filter it; no Instances card.
6. Consumer's Relationships tab: one "N libraries" summary node; response carries `libraryCounts`, not 200 nodes.

## Scenario F — Roles + flag

1. VIEWER: no write items in row menus; `/suggestions?kind=dependency` read-only (no buttons); `POST` calls → 403.
2. `bomCuration` OFF (localStorage override): In-catalog column, row-menu write items, dependency segment, and library surfaces all hidden — not disabled.

## Automated

- `pnpm test` in `core`/`backend`/`frontend`; backend route tests for every endpoint above incl. 403/404/409 paths.
- `pnpm e2e` in `playwright/` — journeys for A, C-staging→D, E(1,5,6), F(1).
