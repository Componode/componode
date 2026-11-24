# Data Model: Product Package Roll-up

Phase 1 output. **No new tables, columns, or stored entities** — every shape
below is a derived projection over existing tables, returned per read
(spec-074 precedent).

## Source tables (existing, read-only)

| Table | Role in this feature |
|---|---|
| `bom_entries` | Factual package inventory. Key columns: `componentId`, `componentInstanceId`, `sourceId`, `purl`, `purlIdentity`, `name`, `ecosystem`, `version`, `scope`, `direct`, `lastReportedAt`, `resolvedComponentId`. |
| `components` | Contributing components (filtered `lifecycle = 'ACTIVE'`) and Library components (`category = 'LIBRARY'`, `externalId` = version-free purl). |
| `product_depends_on_component` | Product → component DIRECT edges. |
| `product_depends_on_component_group` + `component_group_members` + `component_groups` | Product → group edges, expanded to members at read time (GROUP source). |
| `product_composes` | COMPOSES DAG; descendants contribute INHERITED sources. |
| `digital_products` | The product scope; reachable via slug. |
| `app_settings` | `bom.staleThresholdDays` (default 7). |

## Derived shapes (contracts)

### `ProductPackagesResponse`

`Paginated<ProductPackageListItem>` plus:

| Field | Type | Meaning |
|---|---|---|
| `coverage` | `{ reporting: number; total: number }` | `total` = reachable ACTIVE components; `reporting` = those with ≥1 BOM entry. Drives the "8 of 11" summary and the two empty states. |
| `staleThresholdDays` | `number` | Workspace stale threshold for client-side `isStale`. |
| `facets` | `{ ecosystems: string[] }` | Filter domain across the product's contributing set (not the workspace inventory). |

### `ProductPackageListItem`

| Field | Type | Meaning |
|---|---|---|
| `purl` | `string` | Group key — normalized, version-free purl (`purlIdentity`). |
| `name` | `string` | Representative name (most recently reported in the group). |
| `ecosystem` | `string` | purl `type` fragment. |
| `versionCount` | `number` | Distinct versions reported by the product's components. `> 1` ⇒ skew. |
| `versions` | `{ version: string; componentCount: number }[]` | Top 5 by contributing-component count. |
| `componentCount` | `number` | Distinct contributing components (of this product). |
| `lastReportedAt` | `string` | Newest report across the group. |
| `catalogComponent` | `{ id, slug, name } \| null` | Established catalog match (resolved → verbatim externalId). |
| `declared` | `DeclaredDependency \| null` | Non-null when `catalogComponent` is in the product's reachable set. |

### `DeclaredDependency`

Attribution for a declared library edge — reuses `DepSource` shape:

| Variant | Payload |
|---|---|
| `{ kind: "DIRECT" }` | The product's own `DEPENDS_ON` edge. |
| `{ kind: "GROUP"; group: { id, name, slug } }` | Declared via a component group. |
| `{ kind: "INHERITED"; product: { id, name, slug } }` | Declared by a composed child product. |

### `ProductPackageConsumerListItem`

| Field | Type | Meaning |
|---|---|---|
| `component` | `{ id, slug, name, category }` | Contributing component — deep-link target for `?tab=bom&q={purl}`. |
| `depSource` | `DepSource` | How the component is reachable from the product (DIRECT / GROUP / INHERITED). |
| `version` | `string \| null` | Version reported (row granularity: per (component, version, scope)). |
| `scope` | `BomDependencyScope` | Dependency scope. |
| `direct` | `boolean` | `bool_or` over the group (declared directly anywhere). |
| `lastReportedAt` | `string` | Newest report across the group. |

## Query schemas (core, `.strict()` — ADR-095)

### `listProductPackagesQuerySchema`

`listParamsBaseSchema` extended:

- `ecosystem`: multi-value CSV/array → `string[]`
- `skew`: `z.enum(["true"]).optional()` → versionCount > 1 at group level
- `declared`: `z.enum(["declared","undeclared"]).optional()`
- `sort`: `enum ["name","components","versions","ecosystem"]`, default `components`
- `order`: default `desc`

### `listProductPackageConsumersQuerySchema`

`listParamsBaseSchema.omit({ search })` extended:

- `purl`: `string().min(1).max(500)` — required, normalized via `normalizePurlIdentity`
- `version`: optional exact filter
- `sort`: `enum ["name","version","scope","lastReportedAt"]`, default `name`

## Reachability semantics (invariants)

1. Scope map = `Map<componentId, DepSource[]>`; a component reachable via
   several paths keeps all sources; "declared" attribution for consumers
   prefers DIRECT/GROUP over INHERITED when both exist (existing
   declared/inherited split semantics).
2. Contributing set = `ACTIVE` members of the scope map (D5 parity);
   `coverage.total` counts the same set.
3. The product's own lifecycle is ignored for readability — RETIRED
   products still return the view (FR-012).
4. Group edges expand to current members at read time (ADR-110 §2) — never
   snapshotted.
