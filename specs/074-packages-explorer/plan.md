# Implementation Plan: Packages Explorer (Phase 1b)

**Branch**: `074-packages-explorer` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/074-packages-explorer/spec.md` (research basis: `researches/sbom_research.md` — § UX-PKG, § G37 flags table, § BOM read contract, § Copy Deck are normative; Phase 1 shipped in spec 073)

## Summary

Phase 1b answers *"which of our components contain package X?"* with a read-only **`/packages` explorer** — a server-paginated list grouping `bom_entries` **one row per normalized version-free purl**, plus an expandable per-package **consumers** list, and entry points in the sidebar, `Ctrl+K`, and the BOM row menu. No new entity is invented, but the grouping key does not exist in storage: `bom_entries.purl` is verbatim (includes `@version`), so a new `purlIdentity` column (normalized via `normalizePurlIdentity`, backfilled in migration `034`, indexed) becomes the stored, indexable package identity that this spec groups on and Phase 2 reuses for `resolvedComponentId` matching. Two read endpoints land — `GET /packages` (paginated rollup: `purl`, `name`, `ecosystem`, `versionCount`, top-5 `versions[]`, `componentCount`, `catalogComponent`, `pendingSuggestionCount`) and `GET /packages/consumers` (paginated `(component, version, scope)` rows filtered by normalized `purl` + optional `version`, ACTIVE components only) — and `GET /search` gains a `packages` group for the palette. The frontend adds the `/packages` page (`PageHeader` → `ListToolbar` → table → `ListPagination`, all state URL-driven via `useListState`), a reusable `package-consumers` expander, nav/palette/row-menu entry points, and the `packagesExplorer` flag shipping **ON** (G37 resolved). Docs (openapi.yaml, ux.md, gaps registry, roadmap) update in the same change.

## Technical Context

**Language/Version**: TypeScript 6 across `core`/`backend`/`frontend`, Zod 4 schemas, Kysely migrations (next free: `034`)

**Primary Dependencies**: existing stack only — `packageurl-js` is already a `core` dep (`normalizePurlIdentity` reused as the grouping identity); no new packages.

**Storage**: PostgreSQL — migration `034` adds `bom_entries.purlIdentity` (`text NOT NULL`, backfilled per-row in TS via `normalizePurlIdentity`, fallback verbatim purl) + `bom_entries_purl_identity_idx`. No other schema change; upsert keys stay verbatim-purl-keyed.

**Testing**: Vitest unit tests (`core` schema/contract, `backend` route/service incl. grouping/merge/ACTIVE-filter cases, `frontend` table/consumers/mapper units), backend route tests for the two endpoints + search extension, Playwright coverage under `playwright/tests/journeys/packages.spec.ts` (browse/search/filter/paginate, expand + version-chip filter, Ctrl+K group, BOM row-menu deep link); `playwright/data/seed-app-flows.ts` bomRow gains `purlIdentity` + multi-component package fixtures.

**Target Platform**: monorepo — `packages/core` (schemas + view contracts), `packages/backend` (migration, packages service, routes, search), `packages/frontend` (page, expander, hooks/mappers, nav, palette, row menu, flag).

**Project Type**: web-service (pnpm workspaces + Turborepo)

**Performance Goals**: a workspace where one package is consumed by 1,000 components paginates consumers server-side — no request returns more than one page (SC-004); `GET /packages` grouping stays index-assisted via `purlIdentity`.

**Constraints**: read-only surface — zero write affordances, `GET`s side-effect-free (ADR-094); session-gated, all roles incl. Viewer (ADR-097); Zod `.strict()` query schemas (ADR-095); error envelope `{code,message,details?}` (ADR-071); Kysely parameterized only — no `sql.raw`/fragments (ADR-084); `docs/openapi.yaml` in the same change with contract-test coverage (ADR-104); flag governance — hidden fallback, never disabled (docs/ux.md §7); no advisory/vulnerability UI, no forbidden copy words (G40/D8).

**Scale/Scope**: 1 migration (column + index + TS backfill), 2 new API routes + 1 search-extension, core schema/contract additions, packages service (~grouped rollup + consumers read), 1 new page + 1 reusable expander + 3 small entry-point touches, flag + gap-registry + ux.md + openapi + roadmap docs, unit + Playwright coverage. Phase 2/3 explicitly excluded (`catalogComponent`/`pendingSuggestionCount` ship inert).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | Workspace-wide rollup is the feature; no tenancy surface. |
| II. Importer-first | PASS | Read-only — no new write path; `bom_entries` remains importer-written only. |
| III. Two-level taxonomy | PASS | No new categories/providers; package rows are rollups, not Components (promotion is Phase 2). |
| IV. Environment-as-instance | PASS | Consumers roll up to component level; instance data untouched. |
| V. Factual vs. meaning | PASS | Pure reads of factual inventory; zero edges/suggestions created. |
| VI. Test-first | PASS | tasks.md sequences failing tests first: schema/contract, migration backfill, grouped rollup + consumers reads, search extension, frontend units, Playwright journeys. |
| VII. Observability | PASS | `lastReportedAt` surfaced per consumer row; no new signals needed. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/074-packages-explorer/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D7
├── data-model.md        # Phase 1 output — purlIdentity + rollup/consumer shapes
├── contracts/
│   └── packages-api.md  # REST contract: GET /packages, /packages/consumers, /search extension
├── quickstart.md        # Phase 1 output — end-to-end validation scenarios
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── contracts/packages.ts           # NEW — PackageListItem, PackageConsumerListItem,
│   │                                   #      SearchResults.packages shape
│   ├── schemas/packages.ts             # NEW — listPackagesQuerySchema,
│   │                                   #      listPackageConsumersQuerySchema (.strict())
│   └── index.ts                        # re-exports
├── backend/src/
│   ├── db/migrations/034_bom_entries_purl_identity.ts  # NEW — column, index, TS backfill
│   ├── db/types.ts                     # +BomEntryRow.purlIdentity
│   ├── services/bom-service.ts         # processBomEntries writes purlIdentity
│   ├── services/packages-service.ts    # NEW — listPackages (grouped rollup),
│   │                                   #      listPackageConsumers (DISTINCT ON merge)
│   ├── services/search-service.ts      # +packages[] group (purlIdentity prefix match)
│   └── routes/packages.ts              # NEW — GET /packages, GET /packages/consumers
│       (registered in app route wiring)
└── frontend/src/
    ├── ux/app/packages/index.tsx       # NEW — the page (header/toolbar/table/pagination)
    ├── ux/components/catalog/packages-table.tsx       # NEW — row + expander wiring (or co-located)
    ├── ux/components/catalog/package-consumers.tsx    # NEW — reusable consumers list (Phase 2 reuses)
    ├── ux/lib/flags.ts                 # +packagesExplorer ON (G37)
    ├── ux/lib/nav.ts                   # +Packages item (BlocksIcon) + SEGMENT_LABELS
    ├── ux/lib/view-types.ts            # +PackageView, PackageConsumerView
    ├── api/hooks/packages.ts           # NEW — list/consumers hooks
    ├── api/mappers/packages.ts         # NEW — view mappers
    ├── api/hooks/search.ts             # +packages group shape
    ├── ux/components/app/command-menu.tsx             # +Packages group (flag-gated)
    ├── ux/components/catalog/component-bom.tsx        # +See where it's used (flag-gated)
    └── routes.tsx                      # +/packages route

playwright/
├── tests/journeys/packages.spec.ts     # NEW — explorer journeys
└── data/seed-app-flows.ts              # bomRow +purlIdentity; multi-component package fixtures

docs/
├── openapi.yaml                        # +/packages, /packages/consumers, /search packages group
├── ux.md                               # §4 route map row, §7 flags row
└── roadmap.md                          # shipped entry + Next revision

researches/ux-rewrite-gaps.md             # G37 entry (RESOLVED by spec 074)
```

**Structure Decision**: mirrors spec 073 — leaf contracts/schemas in `core`, service + thin routes in `backend`, `ux/app/<segment>/index.tsx` page + `ux/components/catalog/*` components in `frontend`; the consumers expander is a standalone reusable component per the research file plan (Phase 2 Library detail *Used by* reuses it).

## Complexity Tracking

No violations — section not required.

## Review dispositions (code-review R1)

- **`?version=` URL param** — kept deliberately (spec finding, dispositioned). FR-006 constrains *toolbar* state (`q`, `ecosystem`, `scope`, `catalog`, `sort`, `order`, `page`, `pageSize`); FR-008 keeps row *expansion* client-only. The version chip is a consumers-list filter, and every filter in this codebase is URL-driven — a shareable deep link (`/packages?q=x&version=y`) is consistent with ADR-130's list-state convention rather than scope creep.
- **`versions[]` chip counts ignore active scope/search filters** — dispositioned. The chips summarize the package's version universe; the contract's counts are per-package rollups (D3), deliberately not the filtered subset.
