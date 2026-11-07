# Quickstart: validating source-scoped auto ComponentGroups

Prerequisites: `pnpm install && pnpm build` at repo root; backend test DB via
`pnpm db:migrate` (or the testcontainers harness for automated runs).

## Scenario 1 — Docker run produces a pre-grouped catalog (P1)

1. Configure a Docker importer config (Hub target or Agent profile) with
   `autoGroup` absent (default on) and trigger a run against an engine with
   containers/images (the Playwright mock engine's `baseline`/`swarm`
   scenarios work).
2. `GET /api/v1/component-groups` → exactly one new group per reported
   source: slug `docker-cluster-{12-hex}`, `teamOwnerId: null`, provenance
   description.
3. `GET /api/v1/components?group=<slug>` → members = every component the
   source exclusively reports (engine, nodes/services/secrets, containers,
   exclusive compose/workload/image components). Components reported by a
   second source on the same logical asset are absent.
4. `GET /api/v1/component-groups/{slug}` → `lifecycle: ACTIVE` while members
   are active.

## Scenario 2 — Lifecycle honesty + human-edit guards (P1)

1. `PATCH /api/v1/component-groups/{id}` `{ lifecycle: "RETIRED" }` →
   `409 GROUP_AUTO_MANAGED`.
2. `DELETE /api/v1/component-groups/{id}` → `409 GROUP_AUTO_MANAGED`.
3. `PATCH` `{ name: "Renamed" }` → `200`; the group keeps working (link is
   the FK, not the slug).
4. Retire the source (`POST /api/v1/importer-sources/{id}/retire`) → members
   retire → group `lifecycle` flips to `RETIRED` without another import.
   `reactivate` restores `ACTIVE` once members are active again.

## Scenario 3 — Opt-out (P2)

1. Set `scope.autoGroup: false` on the only config feeding a source; run →
   no group created; a pre-existing auto-group for that source is frozen
   (members/lifecycle unchanged).
2. Two configs bound sequentially to one source (same engine identity), one
   disabled: the enabled config's run maintains the group; the disabled
   config's run leaves it frozen — never torn down.

## Scenario 4 — Failure isolation

Force a pass failure (e.g. drop the `componentGroupId` column in a scratch
DB) → the host run still completes `COMPLETED`, `auto_group_pass_errors_total`
increments, and the next trigger re-evaluates cleanly.

## Automated coverage

- `packages/backend/test/integration/auto-component-groups.test.ts` —
  membership invariant, eviction, lifecycle derivation, guards, opt-out,
  retire/reactivate (testcontainers).
- `packages/backend/test/unit/` — strategy slug determinism, sole-reporter
  reduction, remote-run-service store wiring.
- `playwright/tests/journeys/` (or `importers/`) — seeded docker config +
  mock engine: group appears after run, guard responses surface in UI/API.
