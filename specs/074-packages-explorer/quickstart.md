# Quickstart: Packages Explorer (Phase 1b)

**Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

Runnable validation proving the feature end-to-end. Assumes the repo dev stack (`docker compose` Postgres + `pnpm dev`) and an importer that has reported BOM data — or the seeded fixtures below.

## Prerequisites

```bash
pnpm install
docker compose up -d postgres        # or the repo's standard stack
pnpm --filter @componode/backend db:migrate
pnpm dev                             # backend + frontend
```

Seed BOM data either by (a) running the `importer-sbom-file` importer against a CycloneDX fixture targeting an existing component (fastest — see `docs/importers/sbom-file.md`), or (b) inserting `bom_entries` rows directly with `purlIdentity = normalizePurlIdentity(purl)` for two+ components sharing a package (e.g. `pkg:npm/lodash` at `4.17.21` and `4.17.20`).

## Scenario 1 — Browse, search, filter, paginate (US1)

1. Sidebar → Catalog → **Packages** → `/packages` renders the header + subtitle and one row per version-free purl (lodash appears once even though two versions exist).
2. `?q=lodash` returns the lodash row; `?q=pkg:deb` returns all deb-ecosystem rows; single-character `q` shows the hint and sends nothing.
3. Apply Ecosystem + Scope filters, sort by *Components*, go to page 2 — reload the URL: identical view; change a filter: `page` resets to 1.
4. **Expected**: server-paginated `{data, pagination}` responses (Network tab); default sort `components desc` then `name asc`.

## Scenario 2 — Expand consumers + version chip (US2)

1. Expand the lodash row → consumers list shows each consuming component (name → `/components/{slug}?tab=bom&q={purl}`), category, version, scope, direct/transitive, last reported.
2. Click the `4.17.21 × 3` chip → consumers narrows to `version=4.17.21` rows only.
3. Follow a component link → lands on that component's **Bill of materials** tab filtered to the package.
4. **Expected**: consumers fetch is a separate paginated call; >pageSize consumers paginate inside the row.

## Scenario 3 — Entry points (US3)

1. `Ctrl+K` → type `lodash` → **Packages** group shows `{name} · {ecosystem} · {n} components` → select → lands on `/packages?q=pkg:npm/lodash`.
2. Any component BOM tab → row `⋯` menu → **See where it's used** → lands on `/packages?q={purl}`.
3. **Expected**: both deep links arrive with the query applied; the group/item are absent when `packagesExplorer` is off.

## Scenario 4 — Empty + flag states

1. Fresh workspace with no BOM data → *no inventory yet* empty state (Admin sees the Importers link; Viewer sees the explanation only).
2. `?q=no-such-package` → *no results* + **Clear filters**.
3. `packagesExplorer` off → no sidebar item, palette group, route content, or row-menu item (hidden, never disabled).

## Scenario 5 — API spot checks

```bash
curl -s -b session.cookie "http://localhost:3001/api/v1/packages?search=lodash" | jq
curl -s -b session.cookie "http://localhost:3001/api/v1/packages/consumers?purl=pkg%3Anpm%2Flodash&version=4.17.21" | jq
curl -s -b session.cookie "http://localhost:3001/api/v1/search?q=lodash" | jq '.packages'
```

**Expected**: rollup row fields per `contracts/packages-api.md`; consumers rows merged per `(component, version, scope)`; `packages` array present in search.

## Verification commands

```bash
pnpm --filter @componode/core test          # schemas + contract shapes
pnpm --filter @componode/backend test       # migration backfill, service grouping, route tests
pnpm --filter @componode/frontend test      # table/consumers/mapper units
cd playwright && pnpm e2e -- tests/journeys/packages.spec.ts
pnpm --filter @componode/backend docs:api   # regenerate docs/api.md after openapi.yaml edit
```
