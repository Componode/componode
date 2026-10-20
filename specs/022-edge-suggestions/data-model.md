# Data Model: Edge Suggestions

**Feature**: `022-edge-suggestions` | **Date**: 2026-10-19

## New table — `edge_suggestions` (migration `014`)

Persisted staged candidates — one row per `(productId, componentId)` pair
(ADR-113 §1). Rows are created by generation (signal hits → `PENDING`,
coverage → `SUPERSEDED` tombstones), decided via the queue (`ACCEPTED` /
`DISMISSED`), or tombstoned by any `DEPENDS_ON` write path.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK; generated in code (UUID v7, ADR-045) |
| `productId` | `uuid` | NOT NULL → `digital_products.id` ON DELETE CASCADE |
| `componentId` | `uuid` | NOT NULL → `components.id` ON DELETE CASCADE |
| `reason` | `text` | NULL; CHECK IN (`NAME_MATCH`, `TOPIC_TAG_MATCH`, `NAMESPACE_MATCH`) — NULL on coverage tombstones |
| `score` | `integer` | NULL — basis points (e.g. `105` = 1.05); NULL on tombstones |
| `status` | `text` | NOT NULL DEFAULT `'PENDING'`; CHECK IN (`PENDING`, `ACCEPTED`, `DISMISSED`, `SUPERSEDED`) |
| `createdAt` | `timestamptz` | NOT NULL DEFAULT `now()` |
| `decidedAt` | `timestamptz` | NULL — set on every terminal transition |
| `decidedBy` | `uuid` | NULL → `persons.id` ON DELETE SET NULL — NULL for system-marked `SUPERSEDED` |

**Constraints / indexes**

- `UNIQUE (productId, componentId)` — the pair is the identity (ADR-113:
  "unique on the pair"). This is also the merge upsert key.
- `edge_suggestions_queue_idx (status, score DESC)` — the pending queue
  ordering.
- `edge_suggestions_component_idx (componentId)` — pair lookup on
  component-side triggers; covered partially by the unique index for
  product-side lookups.

**Note on `score`**: stored as integer basis points so comparisons/indexes
stay exact (no float drift); the API exposes it as a number (e.g. `1.05`).

## State machine

```text
              ┌───────────── generation (signal hit ≥ floor) ─────────────┐
              ▼                                                           │
          PENDING ──accept (edge created via addDependsOnEdge)──▶ ACCEPTED
              │                                                           │
              ├──dismiss────────────────────────────────────────▶ DISMISSED
              │                                                           │
              └──pair becomes real edge / group-covered─────────▶ SUPERSEDED
                          (by any write path, incl. accept races)
```

- `PENDING` is the only live, actionable state.
- `ACCEPTED`, `DISMISSED`, `SUPERSEDED` are terminal — no transition out,
  ever. Generation merge never mutates terminal rows.
- A still-`PENDING` row may have `score`/`reason` refreshed by later passes
  (`ON CONFLICT ... DO UPDATE ... WHERE status='PENDING'`); `createdAt` is
  immutable.
- `decidedAt`/`decidedBy` are set on `ACCEPTED` and `DISMISSED` (the human
  decision) and on tombstones (`decidedBy` = the wiring actor; NULL when the
  tombstone comes from a coverage re-evaluation).

## Reads

**Queue (default)** — `status='PENDING'`, join `digital_products` +
`components`, exclude rows where either endpoint `lifecycle='RETIRED'`
(spec FR-007 — retire suppresses, reactivation resurfaces), order
`score DESC, createdAt ASC, id`, offset-paginated.

**Dismissed filter** — `status='DISMISSED'`, order `decidedAt DESC`; no
lifecycle filtering (history is inspectable regardless of endpoint state).

## Core constants (mirror DB CHECKs, ADR-078)

```ts
EDGE_SUGGESTION_REASON = ["NAME_MATCH", "TOPIC_TAG_MATCH", "NAMESPACE_MATCH"]
EDGE_SUGGESTION_STATUS = ["PENDING", "ACCEPTED", "DISMISSED", "SUPERSEDED"]
```
plus `*_META` records for UI labels, exported through
`packages/core/src/constants/index.ts` and used by
`check-constraint-helper.ts` (`suggestionReasonCheck`,
`suggestionStatusCheck`).

## Contracts (`packages/core/src/contracts/edge-suggestion.ts`)

```ts
interface EdgeSuggestion {
  id: string;
  productId: string;
  componentId: string;
  reason: EdgeSuggestionReason | null;   // null on tombstones
  score: number | null;                  // decimal form (e.g. 1.05)
  status: EdgeSuggestionStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;              // persons.id
}

interface SuggestionQueueItem extends EdgeSuggestion {
  product: { id: string; name: string; slug: string };
  component: { id: string; name: string; slug: string; category: string };
  decidedByName: string | null;          // persons.displayName/username coalesce, for the dismissed view
}

interface SuggestionListResult {
  items: SuggestionQueueItem[];
  total: number;
}

interface SuggestionRescanReport {
  productsScanned: number;
  componentsScanned: number;
  staged: number;      // pairs newly PENDING or rescored
  superseded: number;  // pairs tombstoned this pass
}
```

## Zod schema (`packages/core/src/schemas/suggestions.ts`)

`listSuggestionsQuerySchema`: `{ status?: "PENDING" | "DISMISSED"
(default "PENDING"), limit?: number (default 50, max 200), offset?: number
(default 0) }` — strict, unknown keys rejected (ADR-095).

## Relationships to existing tables

- `digital_products` — parent side of the pair; `RETIRED` excluded from
  pool and queue.
- `components` — candidate side; `RETIRED` excluded; `details.topics`
  (GitHub) and `details.namespace` (k8s) feed signals; `componentGroupId`
  drives coverage checks.
- `product_depends_on_component` / `product_depends_on_component_group` —
  coverage sources for `SUPERSEDED` tombstones.
- `persons` — `decidedBy` attribution.

## Validation rules (from requirements)

- Accept/dismiss operate only on `status='PENDING'` rows (`404` missing,
  `409 CONFLICT` otherwise).
- Accept delegates all edge validation to `addDependsOnEdge` — existence
  checks, union input parsing, audit — unchanged.
- Generation never stages pairs with `RETIRED` endpoints, pairs already
  covered (direct or via group), or signal scores below the `0.5` floor.
- Deleting a product or component cascades its suggestion rows — no
  orphans.
