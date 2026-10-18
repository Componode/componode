# Research: Platform Product Workflow

Phase 0 output for `020-platform-product-workflow`. The architecture is
already ratified (ADR-017); this document records the *mechanics* decisions
made during planning against the current codebase.

## Ratified inputs (not re-decided)

- **ADR-017**: full guided workflow — detection → promotion → edge rewrite →
  owner prompt. Bounded transaction ("N edges out, N+1 edges in").
- **Spec clarifications (2026-10-18)**: consumer rewrite defaults to
  all-selected with per-consumer opt-out; detection counts direct `DEPENDS_ON`
  edges from active products only (group reach excluded, `PLATFORM` dependents
  counted); promotion available on any component's detail page, no depender
  floor.
- **ADR-018/109**: `CONSUMES_FROM` target must be `PLATFORM` — satisfied by
  construction (promotion always creates `type: PLATFORM`).
- **ADR-045/046**: UUID v7 as SQL parameter; unique `slug` on the new product.

## Mechanics decisions

### D1. Endpoint surface — component-addressed

- `GET /api/v1/components/platform-candidates` — detection read.
- `GET /api/v1/components/:id/dependents` — active direct depender products
  for one component (feeds the dialog checklist at both entry points).
- `POST /api/v1/components/:id/promote-to-platform` — the atomic promotion.

**Rationale**: all three operate on or from a component; colocating them on
the existing `components` router keeps `products` routes untouched. The
improvement plan called for "endpoint + dashboard card" — a dedicated
endpoint keeps `GET /dashboard/summary` cheap and lets the card query lazily.

**Alternatives considered**: extending `dashboard/summary` with candidates
(rejected — couples an unbounded list to the hot dashboard query and can't be
reused by a future candidates page); `POST /products` with a flag (rejected —
promotion is a distinct transactional workflow, not a product create);
mounting candidates under `/products` (rejected — the listed entity is a
component).

**Route-ordering note**: `/components/platform-candidates` is static and
`/components/:id` is parameterized — `find-my-way` resolves static first, so
no conflict; an integration test pins this.

### D2. Detection query — one grouped join

```text
SELECT component …, array of depender products
FROM product_depends_on_component
JOIN components    ON componentId = components.id AND components.lifecycle != 'RETIRED'
JOIN digital_products ON productId = digital_products.id
                     AND digital_products.lifecycle != 'RETIRED'
GROUP BY component
HAVING COUNT(DISTINCT productId) >= 2
ORDER BY dependerCount DESC, component.name
```

`PLATFORM` dependents count (clarified); group reach excluded (only direct
rows are queried, so group edges can't inflate the count); `RETIRED` on both
sides excluded (default-query convention + spec edge case). Response carries
`dependerCount` + `dependents[]` refs so the UI never needs a second fetch to
render "depended on by N products".

### D3. Promotion transaction — order and contents

Inside one `db.transaction()`:

1. Load component → `404 NOT_FOUND` if missing; `409 CONFLICT` if
   `lifecycle = 'RETIRED'` (promotion of a retired component is a state
   conflict, not a validation error).
2. Load active direct consumers (`product_depends_on_component` ⋈ non-`RETIRED`
   products). `consumerIds` absent → all of them; present → every id must be
   in that set or `400 VALIDATION_FAILED` with `details.offendingIds`
   (all-or-nothing validation before any write).
3. Resolve name (`input.name ?? component.name`) and slug
   (`input.slug ?? toSlug(name)`); derived-slug collisions get `-2`, `-3`…
   suffixes; an *explicit* slug collision → `409 SLUG_TAKEN` (same semantics
   as `createProduct` — don't silently mutate a user-chosen slug).
4. Insert `digital_products` row (uuidv7, `type: PLATFORM`, `lifecycle:
   ACTIVE`, owners/metadata from input) + `writeEntityChange` `created`.
5. Insert `product_depends_on_component(platform.id, componentId)` +
   `writeEdgeChange` added.
6. Per selected consumer: delete the `product_depends_on_component` row,
   insert `product_consumes_from(consumer, platform)` (`onConflict
   doNothing` for safety), write both edge-change audit rows.

Any throw rolls the whole transaction back — satisfies SC-003.

**Rationale**: mirrors `createProduct` + `addDependsOnEdge` patterns; audit
shape reuses `writeEdgeChange` so history shows `DEPENDS_ON_COMPONENT
removed` + `CONSUMES_FROM added` per consumer — individually attributable,
matching ADR-052 conventions.

**Alternatives considered**: reusing `createProduct` + edge functions
sequentially (rejected — not atomic, and each does its own transaction);
updating edges in place (rejected — different tables; delete+insert is the
truthful operation and matches the "N edges out, N+1 edges in" bound).

### D4. Request schema

`promoteToPlatformSchema` in `packages/core/src/schemas/product.ts` (strict):

```ts
{
  name?: string (1..200)          // default: component name
  slug?: slugPattern              // default: derived + suffix
  description?, links?, tags?,    // same shape as createProductSchema
  criticality?, sunsetAt?,
  lobOwnerId?, teamOwnerId?: uuid | null,
  consumerIds?: uuid[] (≤500)     // absent = all active direct consumers
}
```

`type` is not accepted — always `PLATFORM`. The optional product fields
mirror `createProductSchema` so the dialog can offer the same metadata the
standard create form does (spec assumption).

### D5. Permission tag

`requireRole("product:create")` on the POST — the contract test (ADR-104)
introspects exactly one `x-permission` per route, and all three composed
capabilities (`product:create`, `product:edge:add`, `product:edge:remove`)
map to EDITOR, so the strongest single tag is correct and honest. Both GETs
are `verifySession`-only (any authenticated role; spec FR-012).

### D6. UI composition

- `PromoteToPlatformDialog` (new, `components/products/`): name/slug/
  description/metadata fields (same subset as `ProductForm`), `OwnerPickers`
  reuse, and a checkbox list of dependents from `useComponentDependents(id)`
  — all checked by default per the resolved clarification.
- Dashboard `Platform candidates` section after the attention block: rows
  "«name» — depended on by N products", each with a *Promote* button
  (EDITOR+ only); section hidden when the list is empty.
- Component detail: *Promote to platform* button beside *Edit metadata* —
  `canEdit` + `lifecycle === 'ACTIVE'` gated.
- On success → `navigate('/products/{new.slug}')`; invalidate
  `["platform-candidates"]`, `["component-dependents"]`, `["components"]`,
  `["products"]`, `["dashboard"]`.

**Alternatives considered**: a dedicated `/candidates` page (deferred — the
spec's reach is dashboard card + component action; a page is a cheap later
addition if the list outgrows the card).

### D7. Error codes — reuse, no additions

`NOT_FOUND` (component), `CONFLICT` (retired component), `VALIDATION_FAILED`
(bad body / stale `consumerIds` with `details.offendingIds`), `SLUG_TAKEN`
(explicit slug collision), `AUTH_FORBIDDEN` (VIEWER POST). No `ERROR_CODES`
additions — keeps the openapi `Problem.code` enum untouched.

## Resolved unknowns

None left — Technical Context had no NEEDS CLARIFICATION; every open point in
the spec was settled by the 2026-10-18 clarification session or is a
mechanics decision recorded above.
