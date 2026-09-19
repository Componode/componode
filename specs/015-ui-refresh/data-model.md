# Phase 1 — Data Model: UI Refresh

**Scope**: no DB schema, no API contract, no new entities. This feature's
"data" is filter wire-format and UI state only.

## Filter wire format (URL `searchParams` — existing, extended to multi-value)

| Param | Values | Serialization | Backend |
|---|---|---|---|
| `category` | `COMPONENT_CATEGORIES` | comma-joined, e.g. `category=A,B` | `normalizeValues` → `IN` |
| `provider` | `COMPONENT_PROVIDERS` | comma-joined | same |
| `lifecycle` | `COMPONENT_LIFECYCLE` | comma-joined | same |
| `status` | `INSTANCE_STATUS` | comma-joined | same |
| `group` | component-group slugs | comma-joined | `componentGroup ?? group` → `IN` |
| `search`, `sort`, `order`, `page`, `pageSize` | unchanged | unchanged | unchanged |

- Empty/absent param = no filter on that facet (existing behavior).
- `filtersFromSearchParams` / `filtersToSearchParams` in `components.tsx`
  already round-trip strings — comma-joined values ride the same path.
- Other enum filter surfaces (product `type` select, instance `status`)
  adopt the same convention where they accept multi-select.

## UI state inventory

| Store | Key / Shape | Lifetime | Notes |
|---|---|---|---|
| `sessionStorage` | `sidebar-collapsed` `"true"/"false"`/absent | session | unchanged from 014 |
| React state | drawer `open: boolean` | ephemeral | no persistence; resets per mount |
| URL params | filter facets above | shareable | source of truth for facet pills |
| `useQueries` cache | `importer-configs/*/runs` | TanStack cache | chart series, existing endpoint |

## Explicitly unchanged

- No migration, CHECK constraint, or `docs/data-model.md` change.
- No new entity, relationship, or enum.
- No API payload change — multi-value filters already supported.
