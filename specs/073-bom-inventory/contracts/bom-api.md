# Contract: BOM read & export API

**Feature**: `073-bom-inventory` | **Date**: 2026-11-20

All endpoints are authenticated (`verifySession`), side-effect-free `GET`s (ADR-094/097), under `/api/v1`, validated by strict Zod query schemas (ADR-095), and added to `docs/openapi.yaml` in the same change (ADR-104). List endpoints follow the spec-068/ADR-130 standardized contract: `listParamsBaseSchema` params + `{data, pagination}` envelope.

## `GET /api/v1/components/:id/bom`

Query — `listBomQuerySchema` (`.strict()`):

| Param | Type | Behaviour |
|---|---|---|
| `page`, `pageSize` | int | `page≥1` default 1; `pageSize` 1–100 default 25 (ADR-130) |
| `sort` | enum | `name`(default) \| `version` \| `scope` \| `ecosystem` \| `lastReportedAt` |
| `order` | `asc`\|`desc` | default `asc` |
| `search` | string ≤100 | case-insensitive on `name`, `purl`, `licenses` text |
| `scope` | CSV of `BomDependencyScope` | multi-value OR (`splitCsvParam`) |
| `ecosystem` | CSV string | multi-value OR |
| `found` | CSV of `BomEvidenceSource` | multi-value OR — the UX "Found in" filter |
| `direct` | bool | `optionalBooleanParam` |
| `catalog` | `linked`\|`suggested`\|`none` | accepted, **ignored in Phase 1** (no suggestions/library rows exist) |
| `instanceId` | uuid | absent → merged view |
| `view` | `flat`\|`tree` | default `flat` |
| `parentId` | uuid | returns that entry's direct children (paginated; children calls use `pageSize=50`) |

Response item `BomEntryListItem`:

```ts
{ id, purl, name, version, ecosystem, scope, direct,
  evidenceSource, evidenceDetail, licenses: string[], supplier, cdxType,
  source: { id, name } | null, lastReportedAt: ISO,
  parentId: uuid | null, hasChildren: boolean, childCount: number,
  instanceCount: number, instanceTotal: number,          // merged view
  resolvedComponent: { id, slug, name } | null,           // always null in P1
  pendingSuggestionId: string | null }                    // always null in P1
```

- **Merged view** (no `instanceId`): one row per `(purl, version, scope)`; `instanceCount` = instances containing it, `instanceTotal` = BOM-bearing instances of the component.
- **`view=tree`**: top-level rows only (`parentBomEntryId IS NULL`) with `hasChildren`/`childCount`.
- **`instanceId` set**: exactly that instance's entries.

## `GET /api/v1/components/:id/bom/summary?instanceId=`

```ts
{ total, direct, ecosystems: string[], licenseCount, hasNesting,
  lastReportedAt: ISO | null,
  staleThresholdDays: number,                            // app_settings bom.staleThresholdDays
  sources: [{ id, name, importerKind, lastReportedAt }],
  instances: [{ id, name, environment, entryCount }] }
```

Single call backing the summary strip, instance picker, tree toggle and stale state (UX-FRESH-01/02, UX-BOM-10/11).

## `GET /api/v1/components/:id/bom/export?format=json|cyclonedx|spdx&instanceId=`

Streamed (`reply.send(Readable)`), always the **full** BOM for the selected component/instance — list filters never apply (Q3). `Content-Disposition` filenames (UX-EXP-04):

| Format | Filename | Content-Type |
|---|---|---|
| `json` | `{slug}-bom.json` (or `{slug}-{instance}-bom.json`) | `application/json` — Componode tree (`children[]`) |
| `cyclonedx` | `{slug}-bom.cdx.json` | CycloneDX 1.5 JSON — nesting via `components[]` |
| `spdx` | `{slug}-bom.spdx.json` | SPDX 2.3 JSON — nesting via `CONTAINS` relationships |

Scope export mapping is the research's lossy table (BUILD/DEV/TEST collapse — disclosed in the UI menu, UX-EXP-02). Viewer role may export (D2).

## `GET /api/v1/component-instances/:id/bom`

Same contract as the component list with `instanceId` bound to the path instance; 404 on unknown instance (UX-STATE-10).

## Errors

`{code, message, details?}` envelope (ADR-071/096): `NOT_FOUND` unknown component/instance; `VALIDATION_FAILED` on rejected query params (`.strict()`); no stack/SQL leakage.
