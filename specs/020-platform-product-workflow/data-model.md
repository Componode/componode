# Data Model: Platform Product Workflow

**No schema changes.** This feature is a workflow over existing tables and a
read-time projection — no migration, no new columns, no new constraints.

## Existing entities touched

| Table | Role in this feature |
|---|---|
| `digital_products` | INSERT of the new `PLATFORM` row (uuidv7 id, unique slug, `lifecycle: ACTIVE`, optional `lobOwnerId`/`teamOwnerId` + metadata fields) |
| `product_depends_on_component` | Read for detection/dependents; platform's new edge INSERTed; selected consumer rows DELETEd during rewrite |
| `product_consumes_from` | INSERT per rewritten consumer (`consumerId` → new `platformId`), `ON CONFLICT DO NOTHING` |
| `product_depends_on_component_group` | **Read never; written never** — group edges are invisible to counting and untouched by rewrite (spec edge cases) |
| `components` | Existence + `lifecycle` check on promotion; `RETIRED` components excluded from candidates and rejected from promotion |
| `line_of_businesses`, `teams` | Owner FKs written as given (existing nullable-FK convention, ADR-020) |
| `audit_events` | Entity `created` row + one `writeEdgeChange` row per edge added/removed, in the same transaction |

## Derived projections (never stored)

### PlatformCandidate

```ts
{
  component: { id, name, slug, category, provider };
  dependerCount: number;            // distinct non-RETIRED products with a direct edge
  dependents: Array<{ id, name, slug, type }>;
}
```

Emission rule: `dependerCount >= 2`, component `lifecycle != 'RETIRED'`,
dependers `lifecycle != 'RETIRED'`. Ordered by `dependerCount` desc, then
component name. `PLATFORM`-type dependers count (clarified 2026-10-18).

### ComponentDependent

```ts
{ id, name, slug, type }  // one row per non-RETIRED product with a direct
                          // DEPENDS_ON edge on the component
```

Identical selection to a candidate's `dependents` — used by the promote
dialog for components that are not candidates (depender floor: none).

### PromoteToPlatformResult

```ts
{
  product: DigitalProduct;                          // the created PLATFORM
  consumers: Array<{ id, name, slug, type }>;       // consumers rewritten
}
```

## Transaction invariants

`POST /components/:id/promote-to-platform` commits atomically:

1. `digital_products` INSERT — exactly one new row, `type='PLATFORM'`.
2. `product_depends_on_component` INSERT — `(platform.id, componentId)`.
3. For each selected consumer `P`: DELETE
   `product_depends_on_component(P, componentId)` + INSERT
   `product_consumes_from(P, platform.id)`.
4. Audit: one entity-`created` event; per rewrite a `DEPENDS_ON_COMPONENT
   removed` + `CONSUMES_FROM added` pair; one `DEPENDS_ON_COMPONENT added`
   for the platform edge.

Edge accounting (ADR-017 "bounded"): for S selected consumers the transaction
performs S deletes + (S+1) inserts + (2S+2) audit rows. Any failure leaves
the catalog byte-identical.

## Validation rules

- `promoteToPlatformSchema` — `.strict()`; `consumerIds` entries must be uuids
  and each must currently hold a direct edge from a non-`RETIRED` product
  (`400 VALIDATION_FAILED`, `details.offendingIds` on violation).
- Slug: `input.slug` or `toSlug(name)`; derived slugs suffix `-2`, `-3`… on
  collision; explicit slug collision → `409 SLUG_TAKEN`.
- Component `lifecycle = 'RETIRED'` → `409 CONFLICT`.

## Lifecycle interplay

- Candidates/dependents read non-`RETIRED` products only — promotion of a
  consumerless component (0 dependents) is legal and produces a `PLATFORM`
  wired to the component with zero `CONSUMES_FROM` in-edges.
- After a full rewrite, the component's remaining depender is the new
  platform itself — dependerCount = 1 < 2, so it drops off the candidate
  list. If a new direct consumer appears later, the platform counts toward
  the threshold (≥2) and the component legitimately resurfaces.
