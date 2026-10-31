# Quickstart — validating ImporterSource Core

**Feature**: 044-importer-source-core | **Date**: 2026-10-31

Validation is automated (Vitest + testcontainers Postgres). The scenarios
below map spec acceptance criteria to the suites that prove them.

## Prerequisites

```bash
pnpm install
docker info          # testcontainers needs a Docker daemon
```

## Fast checks

```bash
# per changed package
cd packages/core     && pnpm lint && pnpm typecheck && pnpm test
cd packages/backend  && pnpm lint && pnpm typecheck && pnpm test
cd packages/agent    && pnpm lint && pnpm typecheck && pnpm test
cd packages/frontend && pnpm lint && pnpm typecheck
pnpm build           # workspace integrity
```

## Scenario → suite map

| Spec scenario | Suite (new/extended) | Expected |
|---|---|---|
| US1 — run attributed to a durable Source | `test/integration/importer-sources.test.ts` | run reports identity → `importer_sources` row; rerun matches same row; empty inventory still registers |
| US1 — URL identity canonicalized | unit test on `canonicalizeSourceIdentity` | userinfo/auth params/fragment stripped |
| US2 — shared component safe | `test/integration/source-reconciliation.test.ts` | source A's run omits the shared component → stays `ACTIVE`; last source drops → `RETIRED`/`GONE` |
| US2 — incomplete run retires nothing | same suite | FAILED/CANCELLED run → zero membership deactivations |
| US3 — config delete preserves provenance | `importer-sources.test.ts` | source → `UNMONITORED`; runs keep `sourceId`, `configId` NULL; `/importer-sources/:id/runs` still lists them |
| US3 — reattach / explicit retire | same suite | new config reporting same identity → same Source `ACTIVE`; `retire`/`reactivate` endpoints + `409 SOURCE_STATE_CONFLICT` |
| US4 — agent target preflight | `packages/agent/test/executor.test.ts` (extended) | missing file / corrupt JSON / absent targetId / missing scope key → `job.ack` NACK `TARGET_RESOLUTION_FAILED`, importer never invoked |
| US4 — hub NACK mapping | `test/unit/remote-run-service.test.ts` (extended) | NACK prefix → run FAILED `TARGET_RESOLUTION_FAILED` |
| US5 — legacy zero-drift | existing `import-reconciliation.test.ts` + `import-runs.test.ts` | unchanged suites pass verbatim; unattributed runs keep config-scoped retirement |
| API contract | `test/unit/api-docs-contract.test.ts` | openapi ↔ routes in sync after `pnpm docs:api` |
| Audit coverage | `test/integration/audit-coverage.test.ts` | retire/reactivate/delete write `importer_source` entity changes |

## Manual smoke (optional, dev stack)

1. `docker compose up` → create an importer config, run an import.
2. `GET /api/v1/importer-sources` → source listed `ACTIVE` with bound
   config.
3. `DELETE /api/v1/importer-configs/:id` → source flips `UNMONITORED`;
   `GET /importer-sources/:id/runs` still returns the run with
   `configId: null`.
4. `POST /importer-sources/:id/retire` → `RETIRED`; entities with no
   other source retire. `POST /reactivate` → `UNMONITORED`.

## Expected outcome

All suites green; `pnpm audit --prod --audit-level=high` unchanged;
`pnpm docs:api:check` clean.
