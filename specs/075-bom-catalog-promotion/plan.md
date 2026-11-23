# Implementation Plan: BOM Catalog Promotion (Phase 2)

**Branch**: `075-bom-catalog-promotion` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/075-bom-catalog-promotion/spec.md` (research basis: `researches/sbom_research.md` — § Phase 2, § UX-ADD, § UX-SUG, § UX-LIB, § Phase-2 write contract are normative; Phase 1/1b shipped in specs 073/074)

## Summary

Phase 2 turns factual package inventory into curated catalog meaning. Three mechanisms land together: (1) a **`bom_component_suggestions`** queue (new table, migration `035`) that clones the ADR-113 `edge_suggestions` lifecycle for component→library `DEPENDS_ON` pairs — staged by a **matching pass** that runs on completed import runs and by the "only add to catalog" path, never auto-wired; (2) **catalog curation endpoints** — `GET /packages/add-to-catalog/preview`, `POST /packages/add-to-catalog`, `POST /packages/link` — that create one `LIBRARY` Component per normalized version-free purl (identity = `components.externalId`, slug `pkg-{type}-{name}`, category from `cdxType`, provider from `ecosystem` via 13 new `ComponentProvider` values + CHECK rebuild in migration `036`) and optionally write all consumer edges **atomically**; (3) the **dependency segment** on `/suggestions` (`kind=edge|dependency`, grouped pending rows, per-row accept/dismiss, bulk accept gated to `PURL_EXACT` server-side, bulk dismiss, shared History) plus legibility surfaces — `LIBRARY` hidden from `/components` by default behind a `libraries=1` toggle (with hidden count), excluded from coverage denominators, grouped provider filter, Library detail (Used-by + Versions-in-use), and a Libraries summary node on Relationships fed by a bounded `libraryCounts` contract extension. The inert Phase-1/1b contract fields (`resolvedComponent`, `pendingSuggestionId`, `catalogComponent`, `pendingSuggestionCount`, `catalog` filters) populate for real. Flag `bomCuration` ships **ON** (G38). ADR-132 ratified; ADR-013 Amendment 2 lands the provider taxonomy.

## Technical Context

**Language/Version**: TypeScript 6 across `core`/`backend`/`frontend`, Zod 4 schemas, Kysely migrations (next free: `035`, `036`)

**Primary Dependencies**: existing stack only — `packageurl-js`/`normalizePurlIdentity` (core, shipped in 073/074) is the identity primitive; no new packages.

**Storage**: PostgreSQL — migration `035` creates `bom_component_suggestions` (uuid PK, `bomEntryId` FK cascade, `parentComponentId`/`childComponentId` FK cascade, `reason` CHECK, `score` int, `status` CHECK default `PENDING`, `createdAt`, `decidedAt`, `decidedBy` FK→persons SET NULL, UNIQUE `(parentComponentId, childComponentId)`); migration `036` rebuilds `components_provider_check` with the 13 new ecosystem providers (same drop/re-add pattern as migration `015`).

**Testing**: Vitest unit + integration (`core` schemas/constants/mappings; `backend` services — matching pass, curation atomicity, suggestion lifecycle incl. SUPERSEDED tombstones, bulk-accept gate, provider constraint; `frontend` dialog/segment/toggle/detail units); backend route tests for every new/changed endpoint + ADR-104 openapi contract test; Playwright under `playwright/tests/` for the curation journeys (add-to-catalog, link, grouped suggestions + bulk, show-libraries, library detail, relationships summary node) with seed fixtures.

**Target Platform**: monorepo — `packages/core` (provider constants, contracts, query schemas), `packages/backend` (migrations 035/036, curation + dependency-suggestion services, matching pass, route changes, coverage/relationships reads), `packages/frontend` (dialog, suggestions segment, list toggle, library detail, summary node, flags/nav).

**Performance Goals**: grouped suggestion list and all new reads server-paginated (ADR-130); a consumer with 200+ library deps returns one `libraryCounts` pair — the relationships read stays bounded (SC-004); matching pass is batched like `generateSuggestions` (in-memory candidate prep, chunked upserts ≤500).

**Constraints**: `component_depends_on_component` writes are human-action only — no auto-wiring ever (ADR-132); writes are `EDITOR`+ via new permission `component:edge:add`; GETs side-effect-free (ADR-094), session-gated all roles (ADR-097); Zod `.strict()` (ADR-095); `{code,message,details?}` envelope (ADR-071); Kysely parameterized only (ADR-084); openapi.yaml + contract test in the same change (ADR-104); terminal suggestion states; hidden-not-disabled flag governance (docs/ux.md §7); UUID v7 + unique slug (ADR-045/046); `pnpm audit` clean.

**Scale/Scope**: 2 migrations, ~10 new/changed endpoints, 3 new backend services/pass, ~6 frontend surfaces, docs/ADR/flag/gap-registry/roadmap/coverage-spec deltas, unit + integration + route + Playwright coverage. Phase 3 (importer-declared edges, provenance/suppression) explicitly excluded.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | Workspace-wide curation; no tenancy surface. |
| II. Importer-first | PASS | Importers untouched — the matching pass is core-side post-run work, mirroring `runSuggestionPass`. |
| III. Two-level taxonomy | PASS | 13 providers added via the documented three-way update (research + `core` constants + CHECK migration); `LIBRARY` already exists as a category. |
| IV. Environment-as-instance | PASS | Libraries carry no instances by default; Used-by replaces the Instances card. |
| V. Factual vs. meaning | PASS | `bom_entries` stays factual/importer-written; promotion + edges are human-curated meaning-layer writes; suggestions stage, never auto-wire (ADR-113 parity; the ADR-131 clarification keeps BOM rows non-edges). |
| VI. Test-first | PASS | tasks.md sequences failing tests first per surface: constants/mappings, migration, matching pass, curation atomicity, suggestion lifecycle + bulk gate, reads/filters, frontend units, Playwright journeys. |
| VII. Observability | PASS | Matching pass emits the same pass metrics/logs pattern (`suggestion*` family or parallel `bomMatch*` counters); audit events on component/edge creation reuse `writeEntityChange`. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/075-bom-catalog-promotion/
├── plan.md                              # This file
├── research.md                          # Phase 0 output — decisions D1–D12
├── data-model.md                        # Phase 1 output — entities + mappings + state machine
├── contracts/
│   ├── bom-curation-api.md              # preview/add/link/versions + deltas to /packages, /components, /components/:id/bom, /components/:id/relationships
│   └── dependency-suggestions-api.md    # kind param, groups read, per-id + bulk decide
├── quickstart.md                        # Phase 1 output — end-to-end validation scenarios
├── checklists/
│   └── requirements.md                  # Spec quality checklist
└── tasks.md                             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/
│   ├── component-providers.ts           # +13 ecosystem providers + provider-group meta
│   └── bom-component-suggestion.ts      # NEW: reason/status enums + match-reason meta
├── contracts/
│   ├── bom-component-suggestion.ts      # NEW: queue item, group row, decide results
│   ├── bom-curation.ts                  # NEW: preview result, add/link requests/results
│   ├── component-relationships.ts       # + libraryCounts { dependsOn, dependedOnBy }
│   └── packages.ts                      # catalogComponent/pendingSuggestionCount now live
└── schemas/
    ├── bom-curation.ts                  # NEW: add/link bodies (strict)
    ├── packages.ts                      # + versions query
    ├── suggestions.ts                   # + kind enum, dependency-groups query
    └── components.ts                    # + libraries flag param

packages/backend/src/
├── db/migrations/
│   ├── 035_bom_component_suggestions.ts # NEW table (ADR-113 clone)
│   └── 036_ecosystem_providers.ts       # NEW CHECK rebuild (015 pattern)
├── services/
│   ├── bom-match-service.ts             # NEW: run-completion pass — resolve + stage/tombstone
│   ├── bom-curation-service.ts          # NEW: preview/add/link atomic writes
│   ├── dependency-suggestion-service.ts # NEW: list/groups/accept/dismiss/bulk
│   ├── bom-service.ts                   # resolvedComponent/pendingSuggestionId + catalog filter live
│   ├── packages-service.ts              # catalogComponent/pendingSuggestionCount + catalog filter + versions read
│   ├── component-relationship-service.ts# libraryCounts + LIBRARY lane exclusion
│   ├── component-catalog-service.ts     # libraries param + librariesHidden count
│   ├── catalog-coverage-service.ts      # LIBRARY excluded from population predicate
│   ├── import-run-service.ts            # invoke runBomMatchPass after runSuggestionPass
│   └── remote-run-service.ts            # same hook on the agent path (verify parity)
├── plugins/rbac.ts                      # + "component:edge:add": "EDITOR"
└── routes/
    ├── packages.ts                      # + preview/add/link/versions
    ├── suggestions.ts                   # + kind, groups, dependency decide/bulk
    └── components.ts                    # + libraries passthrough

packages/frontend/src/
├── api/hooks|mappers|types              # curation + dependency-suggestion clients
├── ux/app/
│   ├── suggestions.tsx                  # kind segment + dependency queue + history
│   └── packages/index.tsx               # row-menu Add/Link entry
├── ux/components/catalog/
│   ├── bom-add-to-catalog-dialog.tsx    # NEW: preview + outcome radio + atomic submit
│   ├── dependency-suggestion-groups.tsx # NEW: grouped rows + bulk confirm
│   ├── package-details.tsx              # NEW: Library detail — Used-by + Versions-in-use
│   ├── component-detail.tsx             # LIBRARY card swap
│   ├── component-relationships.tsx      # Libraries summary node
│   ├── components-table.tsx             # Show-libraries toggle + grouped provider filter
│   └── component-bom.tsx                # In-catalog cell states + row-menu write items
├── ux/lib/
│   ├── flags.ts                         # bomCuration → ON (G38)
│   └── domain.ts                        # reason badges, provider groups, LIBRARY metas
```

**Structure Decision**: backend mirrors the `edge-suggestion-service` decomposition (pass service + queue service + route module); curation writes live in a dedicated service so `packages-service` stays read-only. Frontend reuses spec-074 surfaces (`package-consumers` expander doubles as the Used-by list) and spec-029 flag/pattern conventions.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass.
