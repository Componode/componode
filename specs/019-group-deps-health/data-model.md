# Data Model: Group Dependencies & Product Health

One new junction table — migration `013_product_depends_on_group.ts`.
Health is a derived projection, never persisted (ADR-112).

## `product_depends_on_component_group` — new table

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `productId` | `uuid` | `NOT NULL`, FK → `digital_products.id` `ON DELETE CASCADE`, part of composite PK | Edge source |
| `componentGroupId` | `uuid` | `NOT NULL`, FK → `component_groups.id` `ON DELETE CASCADE`, part of composite PK | Edge target — one product may depend on a group once |
| `createdAt` | `timestamptz` | `NOT NULL DEFAULT now()` | Mirrors `product_depends_on_component` (ADR-048) |

No `down()` surprises — drop the table. No CHECK constraints: no stored
enums. Index: the composite PK already covers `(productId)`; add a plain
index on `componentGroupId` for the group-side guard/reverse lookups.

Cascade-vs-guard pairing (existing convention): the FK is `CASCADE` as a
safety net, but `deleteComponentGroup` gains a service guard that counts
referencing rows and rejects `409 REFERENCED` with the depending products
named (FR-009). Same pattern as `deleteProduct` over `product_depends_on_component`.

## Read-time expansion (no storage)

Dependency reads for a product resolve:

```text
declared sources =
  product_depends_on_component rows for the product              → DIRECT
  product_depends_on_component_group → components by groupId     → GROUP(g)

inherited sources (existing COMPOSES descendants logic, extended):
  descendants' DIRECT + GROUP sources                            → INHERITED(p)
```

Dedup key is `componentId`; each deduped row accumulates its `sources[]`.
Expansion is single-hop — `componentGroupId` lives on `components`, not on
`component_groups`, so groups cannot nest (ADR-110 §4).

## Derived projection: `ProductHealth` (core contract)

```ts
type ProductHealthStatus = "RUNNING" | "STOPPED" | "ERROR"; // subset of INSTANCE_STATUS

interface ProductHealth {
  status: ProductHealthStatus;                 // headline
  perEnv: Partial<Record<Environment, ProductHealthStatus>>;
  sourceCount: number;                         // distinct source components with ≥1 contributing instance
}
```

Computation inputs per product: expanded declared source components (direct
+ group members, deduped) → their `component_instances` rows joined with
component `lifecycle`.

Rules (ADR-112 + clarifications):

1. Drop `GONE` instances; drop instances on `RETIRED` components.
2. `perEnv[env]` = worst-of over that env's instances, ranked
   `ERROR > STOPPED > RUNNING`.
3. Headline `status` = worst-of `PRODUCTION` instances when ≥1 exists, else
   worst-of all remaining instances.
4. Zero contributing instances → `health: null` (absence is not health).
5. `COMPOSES`-inherited sources do not contribute (clarified 2026-10-18);
   `CONSUMES_FROM` never contributes (ADR-112).

## Contract deltas (`packages/core/src/contracts/`)

```ts
// digital-product.ts — new
type ProductHealthStatus = "RUNNING" | "STOPPED" | "ERROR";
interface ProductHealth { status: ProductHealthStatus;
  perEnv: Partial<Record<Environment, ProductHealthStatus>>; sourceCount: number }

type DepSource =
  | { kind: "DIRECT" }
  | { kind: "GROUP";    group:   { id: string; name: string; slug: string } }
  | { kind: "INHERITED"; product: { id: string; name: string; slug: string } };

// detail dependency rows — `via` replaced by `sources` (see contracts/api.md)
interface ComponentDepRef { id; name; slug; category; lifecycle;
  sources: DepSource[] }

// detail response gains
interface ProductDetail {
  // existing…
  health: ProductHealth | null;
  dependsOnGroups: { id: string; name: string; slug: string; memberCount: number }[];
}

// list row gains (ADR-112: headline as `status`)
interface ProductListRow extends DigitalProduct {
  status: ProductHealthStatus | null;
}

// component-group.ts — list item gains
interface ComponentGroupListItem extends ComponentGroup { memberCount: number }

// attention item gains a kind
type AttentionKind = "FAILED_RUN" | "INSTANCE_ERROR" | "INSTANCE_GONE" | "PRODUCT_ERROR";
```

## Schema (`addDependsOnEdgeSchema` → union)

```ts
z.object({
  componentId: z.string().uuid().optional(),
  componentGroupId: z.string().uuid().optional(),
  componentIds: z.array(z.string().uuid()).min(1).max(100).optional(),
}).strict().refine(exactlyOnePresent)
```

Service-side rules: unknown product → `404`; unknown group/component →
`404`; duplicates collapse (`onConflict doNothing`); bulk is one transaction
+ one `writeEdgeChange` per edge (`toEntityType: "component"` for
`componentId`/`componentIds[]`, `"component_group"` for `componentGroupId`).

## Guard rules

- `deleteProduct` counts `product_depends_on_component_group` in
  `countProductEdges` → any edge blocks delete (`409 REFERENCED`, FR-008).
- `deleteComponentGroup` counts referencing junction rows → `409
  REFERENCED` with `details.products` naming the blockers (FR-009);
  retiring the group (`PATCH lifecycle=RETIRED`) stays legal and the edge
  keeps expanding to members.
