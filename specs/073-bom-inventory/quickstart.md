# Quickstart Validation: BOM Inventory (Phase 1)

**Feature**: `073-bom-inventory` | **Date**: 2026-11-20

Runnable checks proving every spec acceptance scenario. Prereqs: `pnpm install && pnpm build`, docker-compose Postgres up, dev servers running (or the Playwright stack via `pnpm e2e` in `playwright/`).

## US1 — Importer-reported inventory lands and dedupes

1. Enable `includeDependencyGraph` on a GitHub importer config; run it against a repo with a lockfile/dep-graph.
   → `GET /api/v1/components/{id}/bom` returns entries with correct `purl`, `version`, `scope`, `evidenceSource`, `evidenceDetail`, `licenses`, `supplier`.
2. Re-run unchanged → same keys updated in place (`lastReportedAt` bumps, `packagesUnchanged` increments), zero duplicates; `packagesRemoved` counts entries the source stopped reporting.
3. Cancel a run mid-flight → previously stored entries unchanged.
4. Asset yielded **without** `bomEntries` → prior entries preserved; yielded with `bomEntries: []` → scope's entries deleted.
5. Nested document (multi-layer container SBOM) → tree depth > 1 in the read (`hasChildren`, `parentId` children).
6. Dep-graph disabled repo → asset yields without `bomEntries`; `bomInventory` capability shows non-OK with cause + count.

## US2 — BOM tab

1. `componentBom` ON → `?tab=bom` renders summary strip + flat table + pagination from real data; OFF → tab absent.
2. 5,000-entry BOM → first page from one paginated request; no response over one page.
3. Set `q`, two filters, `sort`, `order`, `page=2`, `instance`, `view=tree` → reload → identical view; filter change resets `page`.
4. Two BOM-bearing instances → picker shows *All (merged)* + each; merged shows "in N of M instances".
5. `hasNesting` → tree toggle; expand loads children lazily; apply a filter → switches to flat + announcement.
6. Force each UX-STATE row (loading, capability-off, awaiting-run, filtered-empty, refetch, partial, stale, multi-source, error, forbidden, flag-off) → specified treatment.
7. No warning/destructive tone, no advisories column, none of the forbidden words in rendered copy.

## US3 — `importer-sbom-file`

1. Config `{sbomUrl: <cyclonedx-json-url>, componentSlug: <active-component>}` → run → document components (incl. nested) on that component's BOM.
2. Same with an SPDX 2.3 doc → `relationshipType`→scope, `CONTAINS`→tree, `DESCRIBES`→subject.
3. Retire/rename the target between save and run → run fails with clear error; no component created.
4. Same doc twice → key-matched replace, no duplicates.

## US4 — Export

1. `format=cyclonedx` → validates against CycloneDX 1.5 schema (ajv test + manual download); filename `{slug}-bom.cdx.json`.
2. `format=spdx` → validates against SPDX 2.3 schema; nesting exported as `CONTAINS`.
3. BUILD/DEV/TEST entries → lossy mapping applied; menu shows the notice.
4. Large BOM → streamed, no UI freeze; Viewer role can export.
5. Filters applied → export still full BOM.

## US5 — Freshness

1. Two Sources reporting one component → *Last reported* popover per Source; row hover names Source.
2. Age past `bom.staleThresholdDays` → warning-tone *Last reported* + tooltip; rows normal.
3. Re-report → `lastReportedAt` bumps, `createdAt` preserved.

## US6 — Lists, runs, forms

1. Components list BOM filter → "Has BOM" filters correctly.
2. Run detail → Packages tile shows created/unchanged/updated/removed; Changes tab components-only.
3. Importer forms → toggles from schema with the specified helper text; no bespoke form code.
4. Degraded collection → `bomInventory` non-OK notice with cause + count.
5. Dashboard coverage card → "Components with a BOM" line.

## Governance checks

- `pnpm --filter @componode/backend docs:api:check`, `docs:importers:check`, `docs:schema:check`, `docs:oracle:check`, `docs:sidebar:check` all pass.
- `pnpm e2e` green (new BOM specs included).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `pnpm audit --prod --audit-level=high` clean.
- ADR-057 Amendment 1, ADR-131, constitution note, ADR index, `docs/ux.md`, `ux-rewrite-gaps.md` G36/G40 present in the diff.
