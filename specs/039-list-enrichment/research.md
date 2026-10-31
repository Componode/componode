# Research: List Enrichment

All plan-time verifications resolved by direct code inspection:

1. **worstStatus severity**: `ERROR > GONE > STOPPED > RUNNING` — the order
   `HEALTH_META`/product-health rollups already imply. Implemented with a
   Kysely `eb.case()` scalar subquery (no `sql.raw`, ADR-084).
2. **lastSeenAt**: `MAX(component_instances.lastSeenAt)` — the
   `components.lastSeenAt` table column exists but is a denormalized field;
   the instance rollup is the honest per-row read.
3. **memberCount**: `persons.teamId` — same `countAll` correlated-subquery
   pattern as `component-group-service.ts:57` (`memberCount` on groups).
4. **componentCount on teams**: `components.teamOwnerId` countAll — included
   so `flags.teamMemberCounts` flips the whole v0 column set
   (`Team | Members | Components`) on the LOB detail table.
5. **FR-004**: LOB detail consumes `useTeams()` — the list payload covers it.
6. **Importer lastRun**: already wired via `DashboardSummary.lastRuns` in
   spec 038 — sufficient; G21's importer clause is a no-op here.
7. **Response shape**: fields added to existing list responses — requires
   `docs/openapi.yaml` regeneration (ADR-104) and matching `api/types.ts`
   fields on the frontend.
