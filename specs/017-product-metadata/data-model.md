# Data Model: Practical Catalog Metadata

Additive columns only — migration `012_practical_metadata.ts`. No backfill:
all columns nullable or defaulted; existing rows are valid as-is.

## `digital_products` — new columns

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `links` | `jsonb` | `NOT NULL DEFAULT '[]'` | Array of `{title: string (1..80), url: string}`; write-time URL validation (http/https) |
| `tags` | `text[]` | `NOT NULL DEFAULT '{}'` | Normalized at write: lowercase, trimmed, deduped; each tag `[a-z0-9][a-z0-9._:-]{0,31}`; ≤20 entries |
| `criticality` | `text` | nullable, `CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW'))` | Source of truth: `CRITICALITIES` constant in `packages/core` (ADR-079) |
| `sunsetAt` | `timestamptz` | nullable | Planned-retirement date; display semantics only |

## `components` — new columns

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `links` | `jsonb` | `NOT NULL DEFAULT '[]'` | Same shape/rules as products |
| `tags` | `text[]` | `NOT NULL DEFAULT '{}'` | Same normalization rules as products |
| `sunsetAt` | `timestamptz` | nullable | Same semantics as products |

*No `criticality` on components — importance inherits through dependent
products (ADR-111).*

## Indexes

| Index | On | Type | Purpose |
|---|---|---|---|
| `digital_products_tags_gin` | `digital_products(tags)` | GIN | `?tag=` containment filter |
| `components_tags_gin` | `components(tags)` | GIN | `?tag=` containment filter |

*No index on `criticality`/`sunsetAt` — equality/IS NULL on catalog-scale
tables doesn't need one; revisit if filters prove hot.*

## Contract deltas (`packages/core/src/contracts/`)

```ts
// shared (new)
interface Link { title: string; url: string }

interface DigitalProduct {
  // existing fields…
  links: Link[];
  tags: string[];
  criticality: ProductCriticality | null;   // 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'
  sunsetAt: string | null;                  // ISO timestamptz
}

interface Component {
  // existing fields…
  links: Link[];
  tags: string[];
  sunsetAt: string | null;
}
```

## Schema deltas (`packages/core/src/schemas/`)

- **New `metadata.ts`**: `linkSchema` (`{title: z.string().min(1).max(80),
  url: http/https}`), `linksSchema` (array ≤20), `tagSchema` (charset+length
  + `.transform` lowercase/trim), `tagsSchema` (array ≤20, deduped).
- **`product.ts`**: `createProductSchema`/`updateProductSchema` add all four
  fields (`.strict()` — must be registered); `listProductsQuerySchema` adds
  `tag: z.string()` and `criticality: z.enum(CRITICALITIES)`.
- **`components.ts`**: new `updateComponentSchema` =
  `updateComponentGroupAssignmentSchema` extended with `links`/`tags`/
  `sunsetAt`; `listComponentsQuerySchema` adds `tag: z.string()` (single
  value — the existing filters use `stringOrStringArray`, but the spec
  fixes single-tag matching).
- New constant `criticality.ts`: `export const CRITICALITIES =
  ["CRITICAL","HIGH","MEDIUM","LOW"] as const` → `productCriticalitySchema`.

## Validation rules

| Rule | Enforced at |
|---|---|
| link title 1–80 chars, URL http/https | Zod write-time; `safeUrl()` at render (ADR-085) |
| ≤20 links, ≤20 tags per entity | Zod |
| tag charset `[a-z0-9][a-z0-9._:-]{0,31}`, lowercase/trim/dedupe | Zod transform |
| criticality ∈ 4 values or null | Zod enum + DB CHECK |
| sunsetAt ISO timestamp or null | Zod `datetime()` |
| unknown fields rejected | `.strict()` everywhere (ADR-095) |

## State transitions

None — `sunsetAt` is inert data. Lifecycle (`ACTIVE`/`RETIRED`) unchanged;
badge states are computed at render from `sunsetAt` vs today.

## Write-path confinement (FR-015)

Importer reconciliation (`import-run-service.ts`) updates `components` via
explicit `set({...})` column lists — the new columns are unreachable from
the importer path. Regression integration test asserts curated fields
survive a reconciled upsert.
