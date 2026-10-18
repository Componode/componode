### ADR-112 — Derived product health from component instance status

> **Status:** Ratified

**Context**: The attention dashboard surfaces unhealthy *instances*, but the
question users ask is "is my *product* affected?" Instance statuses
(`RUNNING`/`STOPPED`/`ERROR`/`GONE`, ADR-034) already exist — the missing
piece is a derived, documented rollup onto products.

**Decision**:

1. **`health` is a derived read-only field** computed backend-side and
   returned inside the product detail response and as `status` on product
   list rows — never stored, never writable. Shape:
   `{status, perEnv: {<env>: status}, sourceCount}`.

2. **Sources**: the product's **direct** `DEPENDS_ON_COMPONENT` targets —
   including components reached through group edges
   ([ADR-110](./ADR-110-product-dependency-on-component-group.md)) — and
   **not** transitively through `CONSUMES_FROM`. A platform's health is read
   on the platform product itself; transitive rollup would double-report the
   same fault on every consumer.

3. **Aggregation**: worst-of over the source components' non-`GONE`
   instances, ranked `ERROR > STOPPED > RUNNING`. Headline status = worst-of
   `PRODUCTION` instances when any exist, else worst-of all non-`GONE`
   instances; `perEnv` carries the breakdown for the detail page. Instances
   on `RETIRED` components are excluded — a retired logical thing doesn't
   flag the product.

4. **Empty semantics**: a product with no component dependencies, or whose
   sources have no non-`GONE` instances, returns `health: null` and renders
   a muted "—" — absence of data is not health.

5. **Surfacing**: badge on product detail (with per-env breakdown) and
   product list rows; products with `ERROR` health appear in the dashboard
   attention section (which already lists `ERROR`/`GONE` instances).
   GONE-only products do not appear — gone ≠ failing.

**Consequences**: a pure aggregation function (unit-testable) plus service
wiring on the existing product read paths; new frontend badges; no schema
change (statuses and edges already exist). Depends on ADR-110's expansion
for group sources — the rollup spec lands after the edge spec.

**Alternatives considered**: transitive rollup through `CONSUMES_FROM` —
rejected (double-reporting, blurred ownership). Stored `health` column
refreshed by a job — rejected (staleness and a write path for data that is
purely derivable). Simple all-env worst-of headline only — rejected for
PRD-headline + fallback (a DEV `ERROR` shouldn't flag a healthy prod
product, but with no prod instances the all-env signal is the only one).
