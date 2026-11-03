# Quickstart: Validate Component dependencies in Product topology

**Feature**: `061-topology-component-deps` | **Date**: 2026-11-03

## Automated validation

```bash
cd packages/frontend
pnpm test -- product-map          # lane render, direction, +N, selection, empty state
pnpm test -- ux-mappers           # dependsOnComponents mapping, DIRECT-only filter
pnpm typecheck && pnpm lint
```

## Manual validation

1. `pnpm dev` (backend + frontend), log in.
2. Create/have a Product **Banking** and a Component **Landing Page**.
3. On Banking → Dependencies → Relations, add a `DEPENDS ON COMPONENTS` edge to
   Landing Page.
4. **Expected**: the Product topology card renders "Depends on components"
   with a Landing Page node — no "No relationships yet" empty state.
5. Click Landing Page → inspection panel shows Component context, status or
   no-data, and "Open component" navigates to `/components/landing-page`.
6. Add a second product relation (e.g., a `COMPOSES` child) → both lanes
   render; the component stays in its own lane.
7. Create a ComponentGroup containing another component; depend on the group →
   the group node appears in "Depends on groups" and its member does **not**
   appear in the components lane.
8. With >4 direct component deps → only 4 show, `+N` expands in place.
9. Keyboard: Tab reaches component nodes, Enter selects (announced), Escape
   clears.
10. Retire the component → its node shows the Retired label (not dropped).
11. A product with zero relations of every kind → honest empty state remains.
