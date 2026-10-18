---
"@componode/backend": minor
"@componode/frontend": minor
---

Group dependencies and derived product health (spec `019-group-deps-health`, ADR-110/ADR-112):

- `DEPENDS_ON` may target a `ComponentGroup` (`POST /products/{id}/depends-on {componentGroupId}`) or a bulk component list (`{componentIds[]}`, applied atomically with one audit row per edge). Group edges expand to current members at read time; dependency rows now carry `sources[]` attribution (`DIRECT` / `GROUP` / `INHERITED`) instead of `via`, and product detail exposes `dependsOnGroups`.
- `DELETE /products/{id}/depends-on/{targetId}` is kind-discriminated (`?kind=component|group`); group-edge audit entries use `toEntityType: "component_group"`.
- Product deletion counts group edges (`409 REFERENCED`); component-group deletion is blocked while depended on (`409 REFERENCED` naming the products) — retire instead.
- Derived read-only product `health` (`{status, perEnv, sourceCount}`) on product detail, `status` on product list rows, and `PRODUCT_ERROR` items in the dashboard attention feed. Worst-of `ERROR > STOPPED > RUNNING`, production-first headline, `GONE`/`RETIRED`-component instances excluded; `null` renders as "—".
- The dependency edge picker offers component groups alongside components with member counts.
