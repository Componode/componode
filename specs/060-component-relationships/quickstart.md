# Quickstart Validation: Read-only Component Relationships

This guide describes validation scenarios for the feature. It is not
executable until the tasks in `tasks.md` are implemented.

## Prerequisites

- Repository-supported Node.js and pnpm.
- Docker available for backend integration tests that use Testcontainers.
- A test catalog with Components, Products, ComponentGroups, instances, and
  optionally stored Component-to-Component edges.

## Backend and frontend tests

```bash
pnpm --filter @componode/backend test:integration
pnpm --filter @componode/frontend test:unit
pnpm --filter @componode/backend docs:api:check
```

Expected:

- Each typed edge appears with its correct direction.
- Direct Product dependencies and `viaGroup` dependencies are distinguishable.
- ComponentInstances appear as nested context and keep the same operational
  status shown in Overview.
- Empty relation tables show empty states; relation inference never occurs.
- The read route has no write/audit effects and uses bounded reads.
- OpenAPI and generated API docs match the route.

## Browser journey

Use the repository Playwright workload in
[`playwright/quickstart.md`](../../playwright/quickstart.md):

1. Open a Component with stored peer relations, direct Product dependents, a
   Product dependency through a ComponentGroup, and several instances.
2. Open Relationships and verify typed directions, group attribution,
   nested instances, and `+N` expansion.
3. Open Overview and verify the existing Instances table and read-only URL
   Check summaries remain available (intentional duplicate presentation).
4. Navigate the view with keyboard only; inspect nodes, clear focus with
   Escape, and follow a Product/Component link.
5. Repeat at 768px and verify no horizontal overflow or motion under reduced
   motion.
6. Use a fixture with no Component-to-Component edges and verify honest
   empty states with no inferred relations.
