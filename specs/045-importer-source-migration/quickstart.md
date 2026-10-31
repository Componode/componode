# Quickstart: Importer Source Migration validation

Proves spec 045 end-to-end. Prereqs: repo deps installed
(`pnpm install`), Docker available for testcontainers.

## Automated suites (primary gate)

```bash
# Core contract + identity utils
pnpm --filter @componode/core test
# Each migrated importer — identity report, empty inventory, sourceKey,
# qualified externalIds, validateDiscoveredAsset
for p in github aws azure alibaba-cloud kubernetes api-url web-url mcp-server; do
  pnpm --filter @componode/importer-$p test || exit 1
done
# Backend — upsert/adopt/backfill/reconciliation, fake-importer suites
pnpm --filter @componode/backend test
# Agent — source.identity frame passthrough
pnpm --filter @componode/agent test
```

Expected: all green; backend suites that mock `getImporter` pass with
real `reportsSourceIdentity` manifests.

## Scenario matrix (what the suites assert)

| # | Spec ref | Scenario | Expected |
|---|---|---|---|
| 1 | US1 / FR-001 | Run each of 8 importers | `ImporterSource` registered/matched, `run.sourceId` set |
| 2 | US1 | Empty inventory run | Source still registered, run `COMPLETED` |
| 3 | US1 / FR-002 | aws/k8s/mcp run without `sourceKey` or endpoint | run `FAILED` before yield, no Source invented |
| 4 | FR-002 | URL identity with `user:pass@` or `?token=` | canonicalized — no secret material persisted |
| 5 | US2 / FR-003 | Two `aws` configs, different `sourceKey`s, same `region:type` asset | two distinct Components, one membership each |
| 6 | US2 / FR-004 | Pre-seeded legacy component `us-east-1:ec2:instance`; run adopting aws config with `sourceKey` | same row adopted — `externalId` now qualified, membership created, zero duplicates |
| 7 | US3 / FR-005 | Asset with `sourceDetails` | membership `details` populated; `components.details` holds canonical facts only |
| 8 | US4 / FR-006 | DB with derivable (api-url) + underivable (aws-no-key) configs | backfilled memberships for the former only; rest `LEGACY_UNATTRIBUTED` |
| 9 | US4 / FR-007 | Pre-migration product edges, curated fields, externalIds | byte-identical after migration |
| 10 | FR-008 | Component drops from inventory between migration and first adopting run | retires via source-scoped reconcile (membership was backfilled) |
| 11 | SC-002 | Two configs → same canonical url | one `ImporterSource`, rebind-on-report |
| 12 | US5 / FR-009 | `docs/importers/*.md` | identity key + migration notes present per importer |

## Manual smoke (optional)

```bash
pnpm --filter @componode/backend dev   # boots migration 023
```

1. Create an `api-url` config → run → `GET /api/v1/importer-sources`
   shows the canonical-URL Source `ACTIVE` with the run attributed.
2. `GET /api/v1/importer-sources/{id}/runs` — new run attributed;
   historical runs show unattributed provenance.
3. Delete the config → Source flips `UNMONITORED`, run history intact.
