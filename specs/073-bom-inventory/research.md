# Phase 0 Research: BOM Inventory (Phase 1)

**Feature**: `073-bom-inventory` | **Date**: 2026-11-20

The domain/architecture research already exists and is normative: `researches/sbom_research.md` (Phase 1 sections, UX requirements, CycloneDX/SPDX mapping tables, BOM read contract) plus the grill resolutions recorded in `spec.md` → Clarifications. This file resolves only the **implementation-level** unknowns left open — how the research maps onto the current codebase.

## Decisions

### D1 — Write path: per-asset upserts in `processAsset`, deferred diff-delete at completion

`processAsset` (`import-run-service.ts:248`) runs per asset inside its own transaction with `runId`, `sourceId` and the resolved instance ids available — `bomEntries` is processed there, after instance upsert (so `DiscoveredAssetInstance.bomEntries` can bind `componentInstanceId`). Every written row is stamped `importRunId = runId` and `lastReportedAt = now`.

The delete half of "replace" is **deferred to the completion step** (where `runAutoGroupPass`/`runSuggestionPass` already hook, before status flips to `COMPLETED`): for each `(componentId, componentInstanceId|null)` scope the run reported on (i.e., assets/instances that yielded `bomEntries` **present**), delete that Source's rows in the scope where `importRunId != runId`. Failed/cancelled/interrupted runs never reach this step → never replace, while already-upserted rows persist exactly like component upserts do today.

**Why not delete-all/recreate inside processAsset**: violates grill Q2 (wipes `resolvedComponentId` and would CASCADE-kill Phase-2 suggestion rows) and can't express "field absent → preserve".

**Alternatives rejected**: delete per-asset inside the transaction (wrong — the scope set isn't known until the run ends; also can't distinguish absent-vs-empty at run scope); a separate staging table (duplicates the upsert-key machinery for no benefit — `importRunId` on the row already distinguishes this run's payload).

### D2 — Completeness signal is field presence, tracked per scope

`bomEntries` is supported on **`DiscoveredAsset` AND `DiscoveredAssetInstance`**: asset-level → `(componentId, NULL)` scope; instance-level → `(componentId, instanceId)` scope. This is what the table's nullable `componentInstanceId` is for (GitHub dep-graph is naturally component-level; k8s pod-image SBOMs are naturally instance-level). Presence = "collection finished, this is the truth" (including `[]`); absence = "not attempted / failed" → preserve prior set. The run loop records the reported scope set; D1's delete pass consumes it. An importer that can't collect omits the field and reports `bomInventory` non-OK rather than yielding `[]`.

### D3 — Run package counters on `import_runs`

Four new nullable-int columns — `packagesCreated`, `packagesUpdated`, `packagesUnchanged`, `packagesRemoved` — matching the existing `assetsCreated`/`assetsUpdated`/`instancesOrphaned`/`componentsRetired` counter convention (migration `033`). Counted during upsert (insert vs key-match-with-payload-change vs key-match-identical) plus the D1 delete count. Run detail's Packages tile reads them; the Changes tab stays component-only (UX-IMP-04).

**Alternative rejected**: JSONB `details` bag — typed columns match the existing counters and keep run-summary queries trivial.

### D4 — Stale threshold via dedicated settings getter

`app_settings` key `bom.staleThresholdDays` (grill Q1) is read through a new `getBomStaleThresholdDays()` in `settings-service` — literal key, default `7`, env override `BOM_STALE_THRESHOLD_DAYS`. It is **not** added to `DEFAULT_SETTINGS`/`UpdateSettingsInput` (those are the typed workspace-settings surface; the threshold is an internal tunable — same pattern class as other app_settings internals). Surfaced to the UI on the BOM summary response (`staleThresholdDays` field) so the frontend renders staleness without a second settings read.

### D5 — purl: `packageurl-js` in `@componode/core`, verbatim storage + helpers

New dep `packageurl-js` (pinned `^x.y.z`, ≥7-day-old release) in `packages/core` — a leaf-safe runtime dep alongside zod. Core gains `lib/purl.ts`: `parsePurl`, `purlEcosystem` (type fragment → `bom_entries.ecosystem`), `normalizePurlIdentity` (version/qualifiers/subpath stripped, per-type casing — Phase-2 matching groundwork), `isValidPurl` (used by the Zod contract). **Verbatim** purl is stored on each entry (display/export); normalization is computed, not a column. Importers and `importer-sbom-file` reuse the same helpers — no hand-rolled per-ecosystem rules (grill amendment).

### D6 — CycloneDX/SPDX: hand-rolled mappers, ajv-verified in tests

No runtime SBOM libraries. `importer-sbom-file` contains two parsers (`bomFormat === "CycloneDX"` → CycloneDX; `spdxVersion` present → SPDX) implementing the research's field/scope/nesting tables. `bom-service` contains the two export serializers (scope reverse-mapping incl. the disclosed BUILD/DEV/TEST lossiness; nesting → CycloneDX `components[]` / SPDX `CONTAINS`). Tests validate emitted documents against **vendored official JSON schemas** (`cyclonedx-1.5.schema.json`, SPDX 2.3 schema) via `ajv` (backend devDependency) — hermetic, no network (SC-003).

### D7 — Export streams via Fastify `reply.send(Readable)`

`GET /components/:id/bom/export?format=` runs the unpaginated query once, then serializes through an async generator → `Readable` so large BOMs never buffer (UX-EXP-05). `Content-Disposition` filenames per UX-EXP-04 (`{slug}-bom[.cdx|.spdx].json`, `-{instance}` infix when `instanceId` set); `format=json` emits the full Componode JSON tree. Viewer-readable (D2); side-effect-free (ADR-094).

### D8 — Read surface: 4 endpoints on the standard list contract

`GET /components/:id/bom` (list), `GET /components/:id/bom/summary`, `GET /components/:id/bom/export`, `GET /component-instances/:id/bom` (same list contract with `instanceId` bound). Query schema extends `listParamsBaseSchema` → `page`/`pageSize` (default 25, max 100 — repo convention supersedes the research's 50/200), `order`, `search` (the research's `q` maps to the contract's `search`; the frontend keeps `q` in the URL per UX-BOM-02), `sort` whitelist, CSV filters via `splitCsvParam`, `optionalBooleanParam` for `direct`, `.strict()` (ADR-095). Merged view (no `instanceId`) groups rows by `(purl, version, scope)` with `instanceCount`/`instanceTotal`; `view=tree` returns top-level rows with `hasChildren`/`childCount`; `parentId` paginates children (children calls use `pageSize=50`).

### D9 — Capability plumbing reuses each importer's own mechanism

GitHub already has `capabilities.ts` (`withCapability`, `CapabilityMap`, rollup helpers — spec 072). `bomInventory` is added as a capability family there; Docker/Kubernetes use their existing degradation pattern (markers/capability map where present, run error entries otherwise — never fail the run for an inventory gap). `importer-sbom-file` reports `bomInventory` UNAVAILABLE when the URL can't be fetched or parsed. Frontend `CAPABILITY_LABELS` gains "Dependency inventory" (UX-IMP-03).

### D10 — Agent lockstep is dependency-only

`packages/agent` shares core's contracts/`IMPORTER_PACKAGES` — the extended Zod schema validates `bomEntries` automatically on agent runs (ADR-116 lockstep requires identical importer set). Work needed: `agent/package.json` adds `@componode/importer-sbom-file`, `IMPORTER_PACKAGES` (core) adds the package, `pnpm-lock.yaml` regenerated. No agent logic changes.

## Carried over verbatim from `researches/sbom_research.md` (not re-decided)

- Table DDL, both partial unique indexes (`NULLS NOT DISTINCT`), all secondary indexes.
- CycloneDX ⇄ `DiscoveredBomEntry` and SPDX ⇄ `DiscoveredBomEntry` mapping tables incl. both direction's scope tables.
- BOM read contract item/summary field lists (adjusted only for the ADR-130 envelope names per D8).
- UX requirement sets UX-BOM-01…16, UX-FRESH-01…05, UX-EXP-01…05, UX-IMP-01…05, UX-STATE-01…11, UX-A11Y-01…07, the copy deck, and forbidden words.
- Importer behaviours: GitHub dep-graph + lockfile fallback table, Docker OCI referrers + Syft fallback, Kubernetes pod-image refs, `componentSlug` save/dispatch rule (Q5).
- `direct` authoritative vs `TRANSITIVE` round-trip (Q4); full-BOM export (Q3); 7-day default (Q1).
