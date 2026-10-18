# Quickstart Validation: Group Dependencies & Product Health

Prerequisites: `pnpm install` done, Postgres running per `README.md`,
backend + frontend dev servers up, logged in as an EDITOR+ user.

## Validation scenarios

### 1. Group dependency edge (US2 / FR-001–005)

- Create a `ComponentGroup` "Payments DBs" with two member components.
- On a product's detail page → Components tab → "Add dependency" → the
  picker shows "Payments DBs (group · 2)" alongside components → select it.
- The Declared table lists both members, each annotated "via Payments DBs";
  a "Group dependencies" block lists the group itself.
- Add a third member to the group → reload → the third member appears in
  the product's dependencies without any rewiring.
- `POST /products/{id}/depends-on` with `{componentGroupId}` → `204`; the
  product's History shows an edge-add entry targeting the group
  (`component_group`).

### 2. Dedup + multi-source attribution (FR-002)

- Give the product a direct edge to a component that is also a group member
  → it appears once, with both sources attributed.
- A component reachable via this product's group edge *and* a composed
  child's edge → still one row, with `GROUP` + `INHERITED` sources. (A
  component can't literally sit in two groups — `componentGroupId` is 1:N —
  so this is the reachable multi-source case.)

### 3. Empty group + removal (FR-005, FR-006)

- Create an empty group, add a group edge to it → edge valid, expands to
  nothing, still listed under `dependsOnGroups`.
- Remove the group edge → `DELETE …/depends-on/{groupId}?kind=group` →
  `204`; direct edges to former members are untouched.
- `DELETE` a group edge without `?kind=group` → `404` (no component edge of
  that id exists).

### 4. Delete guards (FR-008, FR-009)

- `DELETE /component-groups/{id}` on a depended-on group → `409 REFERENCED`
  naming the depending products; retiring the group works and the edge
  still expands.
- `DELETE /products/{id}` on a product holding only a group edge → `409
  REFERENCED` (group edges counted).

### 5. Bulk wiring (US3 / FR-004)

- `POST …/depends-on` `{componentIds: [a,b,c]}` → `204`; three edges, three
  audit rows. Repeat → `204`, no duplicates.
- `{componentIds: [valid, bogus]}` → `404`, zero edges applied.
- `{componentId: a, componentGroupId: g}` or `{}` → `400 VALIDATION_FAILED`.

### 6. Health rollup (US1 / FR-011–016)

- Product depends on component C; put C's PRODUCTION instance in `ERROR`
  → product detail `health.status = ERROR`, list row `status = ERROR`,
  dashboard attention shows the product as `PRODUCT_ERROR` linking to its
  page; fix the instance → all three clear on reload.
- PRODUCTION `RUNNING` + DEV `ERROR` → headline `RUNNING`, per-env badge
  shows `DEV: ERROR`; remove PRODUCTION instances → headline flips `ERROR`.
- Product with no deps (or only `GONE` source instances) → muted "—",
  absent from attention; dep component `RETIRED` with `ERROR` instances →
  health unaffected.
- Health through a group edge: member instance `ERROR` → product `ERROR`.

### 7. Guardrails

- `pnpm test` — core aggregation unit matrix, backend integration suite
  (union validation, expansion, guards, audit, attention), frontend unit
  (picker groups, sources column, badges, PRODUCT_ERROR item) all green.
- `pnpm lint && pnpm typecheck && pnpm build` clean.
- `docs/openapi.yaml` updated; `pnpm docs:api` regenerates `docs/api.md`
  without drift (contract test enforces).
