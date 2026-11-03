# Quickstart Validation: Product Map topology in Dependencies

This guide describes validation scenarios for the feature. It is not
executable until the tasks in `tasks.md` are implemented.

## Prerequisites

- Repository-supported Node.js and pnpm.
- Docker available for backend integration tests using Testcontainers.
- Local or fixture catalog data with Products, ComponentGroups, and relation
  edges.

## Backend and frontend tests

```bash
pnpm --filter @componode/backend test:integration
pnpm --filter @componode/frontend test:unit
pnpm --filter @componode/backend docs:api:check
```

Expected:

- Related Product references include health and Component counts from one
  bounded read.
- Tests cover `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and
  `dependsOnGroups` direction independently.
- Null related-product health remains no data.
- The OpenAPI response and generated `docs/api.md` remain in sync.

## Browser journey

Use the repository Playwright workload in
[`playwright/quickstart.md`](../../playwright/quickstart.md):

1. Open a Product with composition, consumption, consumers, and group
   dependencies.
2. Verify the topology appears first in Dependencies and existing authoring
   controls remain below it.
3. Follow a directed relation, select a node, inspect its health/count, and
   open the related Product.
4. Expand a `+N` lane and verify state resets on navigating to another Product.
5. Repeat using keyboard only; verify accessible names, focus announcement,
   Escape clearing, 768px layout, no horizontal overflow, and reduced-motion
   behavior.
6. Verify that no graph interaction mutates relationship data.
