# Data Model: Catalog Coverage & Hygiene

> No tables added, altered, or dropped — every value in this feature is a
> read-time projection over existing schema. This document pins the
> derivations and the query-param semantics so metric, filter, and chip
> stay identical by construction (FR-006).

## Existing inputs (unchanged)

| Source | Role |
|---|---|
| `components.lifecycle`, `components.componentGroupId`, `components.sunsetAt` | coverage denominator, group expansion, sunset items |
| `digital_products.lifecycle`, `lobOwnerId`, `teamOwnerId`, `description`, `sunsetAt`, `type` | product population, chip facets, sunset items, platform gating |
| `product_depends_on_component` | direct `DEPENDS_ON` edges |
| `product_depends_on_component_group` | group `DEPENDS_ON` edges (expand via `components.componentGroupId`) |
| `product_consumes_from` | `CONSUMES_FROM` edges — dep surface (as consumer) and consumer count (as platform) |
| `product_composes` | `COMPOSES` DAG — recursive descendant expansion |

## Derived projections

### `CatalogCoverage` (dashboard summary → `coverage`)

```ts
{
  components: {
    active: number;        // default-visible population: ACTIVE and not
                           // instances-all-GONE (zero-instance counts)
    wired: number;         // subset reachable by a live product's DEPENDS_ON
    wiredPct: number|null; // null when active = 0 → renders "—"
  },
  products: {
    total: number;               // products where lifecycle != 'RETIRED'
    missingOwner: number;        // lobOwnerId IS NULL AND teamOwnerId IS NULL
    missingDependencies: number; // not in the dependency-surface set
    missingDescription: number;  // description IS NULL OR btrim = ''
  }
}
```

**Coverage population** — the default-visible component set, identical to
the components list's default visibility (clarification 2026-10-20):

```text
components.lifecycle = 'ACTIVE'
AND (no instances OR EXISTS instance with status != 'GONE')
```

Components with zero instances count; components whose every instance is
`GONE` do not. The `wired`/`unwired` filter values apply this population
predicate regardless of `includeRetired`/`includeGone` toggles — wiring
classification only applies to the live catalog.

**Wired component** — population member whose id appears in:

```text
SELECT pdc."componentId"
FROM product_depends_on_component pdc
JOIN digital_products dp ON dp.id = pdc."productId"
WHERE dp.lifecycle != 'RETIRED'
UNION
SELECT c.id
FROM components c
JOIN product_depends_on_component_group g
  ON g."componentGroupId" = c."componentGroupId"
JOIN digital_products dp ON dp.id = g."productId"
WHERE dp.lifecycle != 'RETIRED'
```

The UNION arms add no component-lifecycle filter of their own — the
population predicate above is applied at both call sites (metric count
and list filter), so `RETIRED`/gone-only components can appear in neither
`wired` nor `unwired` results.

Single-hop group expansion — groups cannot nest, so no recursion is
needed and the set is cycle-free by construction.

### Dependency surface (per product → boolean)

Product's surface is **non-empty** when any holds:

| Path | Rule |
|---|---|
| Own `DEPENDS_ON` | id ∈ `product_depends_on_component.productId` ∪ `product_depends_on_component_group.productId` — group edges count even to empty groups (declared intent) |
| Own `CONSUMES_FROM` | id ∈ `product_consumes_from.consumerId` — the product's own declaration; platform lifecycle irrelevant |
| Descendant `DEPENDS_ON` | a **non-retired** descendant via `COMPOSES` (recursive, parent→child) satisfies the first row |

Computed once per request over the non-retired product universe using a
`WITH RECURSIVE` CTE (same parent→child direction as
`product-service.ts`'s `descendants` CTE). Consumers of the set:
`missingDependencies` metric, `missing=dependencies` filter predicate,
chip `dependencies` facet.

### `ProductCompleteness` (product list rows + detail → `completeness`)

```ts
{
  owner: boolean;        // lobOwnerId != null || teamOwnerId != null
  description: boolean;  // description non-null && btrim != ''
  dependencies: boolean; // id ∈ dependency-surface set
}
```

Three independent booleans — rendered as three facets, **never** combined
into a score.

### `AttentionItem` (extended)

```ts
kind: "FAILED_RUN" | "PRODUCT_ERROR" | "INSTANCE_ERROR" | "INSTANCE_GONE"
    | "SUNSET_OVERDUE_PRODUCT" | "SUNSET_OVERDUE_COMPONENT";  // NEW
at: string;  // sunsetAt for the new kinds
```

Sunset items: `ACTIVE` products/components with `sunsetAt < now()`.
Appended last within the existing `ATTENTION_LIMIT` cap — operational
kinds always outrank them.

### `consumedByCount` (product list rows)

`COUNT(product_consumes_from) GROUP BY platformId` restricted to the
listed ids. Detail pages use `consumedBy.length` — same set, no second
derivation. Rendered only for `type = 'PLATFORM'` rows
(`CONSUMES_FROM` can only target platforms, ADR-018); zero renders as a
muted "not consumed".

## Query-parameter semantics

| Param | On | Values | Within-facet | Predicate |
|---|---|---|---|---|
| `wired` | `GET /components` | `wired`, `unwired` (CSV) | OR | `components.id` in / not in the wired set, **and** the coverage-population predicate is applied — `wired`/`unwired` classify only default-visible components, so `includeRetired`/`includeGone` toggles never add out-of-population rows to either result |
| `missing` | `GET /products` | `owner`, `dependencies`, `description` (CSV) | OR | product fails ≥1 selected facet check |

Both follow the existing `stringOrStringArray` + `normalizeValues`
convention; unknown values are ignored after schema validation
(consistent with other facets — strict enum rejection is a task-time
option, not a semantic requirement).

## State transitions

None — all values derived; no entity lifecycle or status is touched.
