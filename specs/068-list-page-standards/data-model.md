# Data Model: Standardized list pages

**Feature**: `068-list-page-standards` | **Date**: 2026-11-09

**No database schema changes.** No new tables, columns, constraints, or
migrations. This feature changes API query contracts and UI state only.
The "entities" below are contract-level shapes, not persisted records.

---

## List Query Contract (request side)

Uniform parameters accepted by every in-scope `GET` list endpoint,
validated by a shared Zod base schema in `packages/core` and extended
per endpoint:

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | 1-based page number |
| `pageSize` | int 1–100 | `25` | UI offers exactly 25/50/100 |
| `sort` | per-endpoint enum | endpoint-specific | Whitelisted keys only (see contracts/list-contract.md) |
| `order` | `"asc" \| "desc"` | `"asc"` | |
| `search` | string ≤ 100 | — | Substring match over per-endpoint field list |
| *(entity filters)* | existing params | — | Unchanged names/semantics (CSV multi-value where already supported) |

Validation: `.strict()` schemas — unknown params → `400 VALIDATION_FAILED`
(ADR-095). Sort values outside the endpoint whitelist → `400`.

## Pagination Envelope (response side)

```jsonc
{
  "data": [ /* page rows, endpoint-shaped */ ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 108,
    "pageCount": 5,
    "hasNext": true
  }
  // + endpoint-specific top-level extras (e.g. products.edges)
}
```

- `total`/`pageCount` come from a `COUNT(*)` over the same WHERE set.
- `hasNext` = `page * pageSize < total`.
- Shared TypeScript type `Paginated<T>` in `packages/core`, mirrored by
  frontend response types in `packages/frontend/src/api/types.ts`.

## Table State (client side)

URL search params encoding one list's state — the shareable contract:

| Param | Maps to | Default |
|---|---|---|
| `page` | `page` | `1` |
| `size` | `pageSize` | `25` |
| `sort` | `sort` | endpoint default |
| `order` | `order` | `asc` |
| `q` | `search` | — |
| `<filter keys>` | entity filters (e.g. `provider`, `category`, `status`) | `all`/unset |

Rules: invalid values fall back to defaults (never error); any change to
`q`/filters/`sort`/`order`/`size` resets `page` to 1; state survives
reload and is shareable. Managed by `useListState` + `useSearchParams`.

## Item Summary (hover card)

Per-entity curated field set rendered in the title `HoverCard`. Content
is derived from fields already present in the list payload — **no
additional request** (SC-006).

| Entity | Summary fields |
|---|---|
| Component | provider, category, resource type, owner, group, lifecycle, instance count, worst health, last seen, tags |
| Product | description, type, owner, criticality, health, component count, updated |
| ComponentGroup | description, lifecycle, member count, owner |
| User | role, status, last active, created |
| Team / LOB | description, parent LOB (teams), member/product/component counts |
| Agent | status, version, bound configs, importers, last seen |
| Credential | status, key hint (masked), expires, last used, used-by count |
| ImporterSource | importer, status, bound config, components/instances, last complete run |
| ImporterConfig | importer type, status, schedule, last run status/time |
| ImportRun | status, started/finished, discovered/created/updated counts |
| EdgeSuggestion | product → component, score, status, created |
| Audit entry | actor, action, entity, timestamp |

Exclusions (hard rule): secrets/credential values, raw importer `details`
JSON, session tokens. Key hints render masked only.

## State transitions

None — all entities are read contracts. The only "transition" is UI-side:
page/sort/filter changes produce new query keys → refetch → re-render.
Polling lists (agents 15 s, active runs 3 s) preserve table state across
refetches via `placeholderData`.
