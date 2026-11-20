# Implementation Plan: BOM Inventory (Phase 1)

**Branch**: `073-bom-inventory` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/073-bom-inventory/spec.md` (research basis: `researches/sbom_research.md` — Phase 1 sections, UX requirements, mapping tables and read contract are normative; all 8 grill questions resolved 2026-11-20)

## Summary

Phase 1 of the SBOM programme makes package inventory a first-class, importer-reported fact. `DiscoveredAsset` gains an optional `bomEntries` list (factual inventory, **not** a graph edge — ADR-057 Amendment 1), stored in a new typed `bom_entries` table whose `parentBomEntryId` self-FK preserves nested assemblies at arbitrary depth (ADR-131). Writes are **source-scoped, diff-based replace**: a `COMPLETED` run upserts the keys its Source reported and deletes that Source's absent keys per `(componentId, componentInstanceId)` scope — only for assets that yielded `bomEntries` present (field-presence completeness); failed/cancelled/interrupted runs never replace. Four importer surfaces produce data in Phase 1: GitHub `includeDependencyGraph`, Docker `includeSbom`, Kubernetes `includePodImageSbom`, and a new `importer-sbom-file` package that ingests CycloneDX/SPDX JSON from a URL onto a `componentSlug`-targeted component. Reads are server-paginated per the ADR-130 list contract (`page`/`pageSize`/`sort`/`order`/`search`, `{data, pagination}` envelope) plus a summary endpoint and a streamed export in Componode JSON / CycloneDX 1.5 / SPDX 2.3. The frontend gains a read-only **Bill of materials** tab behind the `componentBom` flag (G36) implementing the full UX-BOM/UX-FRESH/UX-EXP/UX-IMP/UX-STATE/UX-A11Y requirement set, plus a Components-list BOM filter, a dashboard BOM line, and run-detail package counts. No graph edges, no suggestions, no Library components — Phases 1b/2/3 are separate specs.

## Technical Context

**Language/Version**: TypeScript 6 across `core`/`backend`/`frontend`/`agent`/`importer-*`, Zod 4 schemas, Kysely migrations (next free: `032`)

**Primary Dependencies**: existing stack only + **`packageurl-js`** (new dep in `@componode/core` — purl parsing/normalization/ecosystem extraction for the shared purl helper and `importer-sbom-file`; pinned `^` release ≥7 days old per dependency policy) + **`ajv`** (dev-only, backend tests — validates CycloneDX/SPDX exports against vendored official schemas offline). No CycloneDX/SPDX runtime libraries: both mappings are deterministic field mappings hand-rolled per the research tables (importer-sbom-file parses; `bom-service` serializes).

**Storage**: PostgreSQL — new `bom_entries` table (migration `032_bom_entries`) with two partial unique indexes using `NULLS NOT DISTINCT`; `import_runs` gains 4 package-counter columns; `app_settings` gains the `bom.staleThresholdDays` key (default 7).

**Testing**: Vitest unit tests (`packages/core`, `packages/backend`, `packages/importer-*`, `packages/frontend`), backend route/service tests incl. schema-validation of exports via ajv + vendored CycloneDX 1.5 / SPDX 2.3 schemas, Playwright coverage under `playwright/tests/` (BOM tab flows, states, tree, export menu, importer form toggles, run tile, list filter).

**Target Platform**: monorepo — `packages/core`, `packages/backend`, `packages/frontend`, `packages/agent` (dep + shared contract only), `packages/importer-github`, `packages/importer-docker`, `packages/importer-kubernetes`, new `packages/importer-sbom-file`.

**Project Type**: web-service (pnpm workspaces + Turborepo)

**Performance Goals**: a 5,000-entry component BOM renders its first page from one paginated request; tree expansion fetches only that node's children (50/page); export streams without buffering the whole document (SC-004, UX-EXP-05).

**Constraints**: importers are pull-only `AsyncGenerator<DiscoveredAsset>` and never touch the DB (constitution II); `bomEntries` is factual inventory — zero graph-edge writes (Principle V, ADR-113); source-scoped replace honours the field-presence contract and never delete-all/recreates (grill Q2); `NULLS NOT DISTINCT` upsert keys; read-only BOM tab (D7); no security-posture signals (D8); `GET`s side-effect-free (ADR-094); Zod `.strict()` query validation (ADR-095); `docs/openapi.yaml` + generated docs in the same change (ADR-104); `pnpm audit --prod` stays clean (new deps are runtime/core-leaf-safe).

**Scale/Scope**: 1 new table + indexes, 4 import_runs columns, 3 new API routes + 1 instance-scoped variant, 1 new importer package, contract/schema additions in core, BOM write/read/export service, frontend tab + primitives (tree-grid, export menu) + list/dashboard/run-detail touchpoints, 2 ADR writes (057 A1, 131) + constitution clarification + ADR index, docs (ux.md, gaps registry, openapi, importer guides, generated docs). Phase 1b/2/3 explicitly excluded.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface; `app_settings` is workspace-level by design (grill Q1). |
| II. Importer-first | PASS | All writes flow through the pull-only generator contract; `bomEntries` rides the existing yield; `importer-sbom-file` is a normal in-tree importer (URL fetch, not browser upload — D3). |
| III. Two-level taxonomy | PASS | No new categories/providers — BOM entries are inventory rows, not components (promotion is Phase 2). |
| IV. Environment-as-instance | PASS | `componentInstanceId` scopes entries to real instances; no environment semantics invented. |
| V. Factual vs. meaning | PASS — **with Amendment** | `bomEntries` is factual observational data like `details`/`rawConfig`, explicitly *not* a relationship declaration; ADR-057 Amendment 1 + a Principle V clarification note ship in this change so the constitution text stays honest. No junction-table writes anywhere in Phase 1. |
| VI. Test-first | PASS | tasks.md sequences failing tests first: contract validation, migration/upsert-replace semantics, read/export APIs incl. schema-valid CycloneDX/SPDX, importer unit tests exercising `validateDiscoveredAsset`, frontend units, Playwright journeys. |
| VII. Observability | PASS | `bomInventory` capability family reuses the marker + degraded-report mechanism; package counters on the run; stale/freshness is surfaced data (`lastReportedAt`, per-Source), not log noise. |

No violations → Complexity Tracking not required (Principle V is amended, not violated — recorded in FR-028 and the ADR work).

## Project Structure

### Documentation (this feature)

```text
specs/073-bom-inventory/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D10
├── data-model.md        # Phase 1 output — bom_entries + contract shapes
├── contracts/
│   ├── bom-api.md       # REST read/export/summary contract + Zod query schemas
│   └── importer-contract.md  # bomEntries yield contract + importer config fields
├── quickstart.md        # Phase 1 output — end-to-end validation scenarios
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── constants/bom-entry.ts          # NEW — BOM_DEPENDENCY_SCOPES, BOM_EVIDENCE_SOURCES, BOM_CDX_TYPES
│   ├── contracts/bom-entry.ts          # NEW — BomEntry, BomEntryListItem, BomSummary view contracts
│   ├── contracts/discovered-asset.ts   # +DiscoveredBomEntry (children[]), +bomEntries? on asset AND instance
│   ├── contracts/importer.ts           # +bomInventory capability family declaration (if manifest-level)
│   ├── validation/discovered-asset.ts  # +discoveredBomEntrySchema (recursive), purl check
│   ├── schemas/bom.ts                  # NEW — listBomQuerySchema (.strict(), listParamsBaseSchema)
│   ├── lib/purl.ts                     # NEW — parse/normalize/ecosystem helpers (packageurl-js)
│   └── importer-registry.ts            # IMPORTER_PACKAGES += @componode/importer-sbom-file
├── backend/src/
│   ├── db/migrations/032_bom_entries.ts        # NEW — table, FKs, CHECKs, NULLS NOT DISTINCT upsert indexes
│   ├── db/migrations/033_import_run_package_counts.ts  # NEW — 4 counter columns
│   ├── db/types.ts                            # +BomEntryRow, +run counters
│   ├── services/bom-service.ts                # NEW — upsertBomTree, diffReplace scopes, list/summary/export builders
│   ├── services/import-run-service.ts         # processAsset → processBomEntries; completion → bom diff-delete + counters
│   ├── services/settings-service.ts           # +getBomStaleThresholdDays (key bom.staleThresholdDays, env BOM_STALE_THRESHOLD_DAYS)
│   ├── routes/components.ts                   # GET /components/:id/bom[/summary|/export]
│   ├── routes/component-instances.ts          # GET /component-instances/:id/bom
│   └── test/fixtures/schemas/                 # vendored cyclonedx-1.5 + spdx-2.3 JSON schemas (ajv)
├── agent/                                     # package.json += importer-sbom-file (lockstep, ADR-116 #7)
├── importer-github/src/
│   ├── config.ts                              # +includeDependencyGraph (default false, cost-named .describe)
│   ├── github-repos.ts / github-inventory.ts  # dep-graph SBOM fetch → bomEntries; lockfile fallback
│   └── capabilities.ts                        # +bomInventory family
├── importer-docker/src/                       # +includeSbom → OCI referrers attestations (IMAGE_LAYER, nested)
├── importer-kubernetes/src/                   # +includePodImageSbom → pod image SBOMs on workload assets
├── importer-sbom-file/                        # NEW package — manifest, config (sbomUrl + componentSlug),
│                                              #   CycloneDX/SPDX parsers → DiscoveredBomEntry tree
└── frontend/src/
    ├── ux/lib/flags.ts                        # +componentBom (OFF → G36), +G40 note (no flag, never rendered)
    ├── ux/lib/domain.ts                       # +BOM_SCOPE_META, BOM_EVIDENCE_META (label/tone/tooltip)
    ├── ux/lib/view-types.ts                   # +BomEntryView, BomSummaryView
    ├── api/hooks/bom.ts, api/mappers/bom.ts   # NEW — list/summary/children/export SWR hooks + mappers
    ├── ux/components/catalog/component-bom.tsx        # NEW — the tab (summary strip, toolbar, table)
    ├── ux/components/catalog/component-detail.tsx     # third tab ?tab=bom, flag-gated, count
    ├── ux/components/patterns/tree-grid.tsx           # NEW — treegrid primitive (UX-A11Y-01)
    ├── ux/components/catalog/bom-export-menu.tsx      # NEW — export menu (UX-EXP)
    ├── ux/components/patterns/status-badge.tsx        # BomScopeBadge, BomEvidenceBadge
    ├── ux/components/importers/run-detail.tsx         # Packages tile
    ├── ux/components/catalog/components-table.tsx     # BOM filter
    └── ux/components/dashboard/*                       # "Components with a BOM" line

docs/
├── openapi.yaml                # +BOM endpoints (ADR-104; docs:api regenerates api.md)
├── ux.md                       # route map + tab + vocabulary + §7 flags
├── importers/sbom-file.md      # NEW setup guide (componentSlug rule named)
├── importers/{github,docker,kubernetes}.md  # new fields + bomInventory behaviour
└── api.md / architecture.md    # regenerated regions

researches/
├── adrs/ADR-057-*.md           # Amendment 1 appended
├── adrs/ADR-131-bom-entry-entity.md   # NEW
├── architecture-decisions.md   # register ADR-131
└── ux-rewrite-gaps.md          # G36 (componentBom) + G40 (deferred, no flag)

.specify/memory/constitution.md # Principle V clarification note
```

**Structure Decision**: Follows the existing pnpm-workspace layout exactly — contract in `core`, storage/read/export in `backend`, inventory producers in `importer-*`, UI in `frontend`, one new importer package registered via `IMPORTER_PACKAGES` in core and depended on by backend + agent (lockstep).

## Phase 0 → Phase 1 artifacts

- `research.md` — decisions D1–D10 (write path, completeness signalling, counters, settings key, purl helper, format strategy, streaming, instance-scope, capability plumbing, agent lockstep).
- `data-model.md` — `bom_entries` columns/indexes, run counters, contract shapes, state/lifecycle notes.
- `contracts/bom-api.md` — endpoint params/response items/summary shape/filenames; Zod schema definitions.
- `contracts/importer-contract.md` — `DiscoveredBomEntry` shape, completeness rules, per-importer config fields + capability family.
- `quickstart.md` — runnable validation for every spec acceptance scenario.
