# Quickstart Validation: Web/API importer profiles and managed URL Checks

This guide describes the validation scenarios required for the feature. It is
not executable until the implementation tasks in `tasks.md` land.

## Prerequisites

- Node.js and pnpm versions supported by the repository.
- Docker available for backend integration tests that use Testcontainers.
- The test environment uses only local/mock HTTP targets; never use production
  credentials or endpoints.

## Importer contract tests

```bash
pnpm --filter @componode/importer-web-url test
pnpm --filter @componode/importer-api-url test
```

Expected:

- Each importer reports the stable collection Source identity before the
  first yield.
- Each profile yields one valid asset with stable-keyed instances.
- Unsafe instance URLs fail validation independently.
- Endpoint-level errors yield an `ERROR` instance while sibling profiles
  continue.
- Tests exercise `validateDiscoveredAsset` for every yielded asset.

## Backend integration tests

```bash
pnpm --filter @componode/backend test:integration
```

Expected scenarios:

1. Create a v2 Web/API config with multiple profiles and instances; run it and
   verify one Component per profile, all instances, stable Source identity,
   and one managed URL Check per instance.
2. Repeat the run and edit a profile name/URL; verify IDs and observations
   remain stable.
3. Share Component, instance, and check keys across a second Source; verify
   identical definitions share one URL Check and conflicting definitions are
   rejected.
4. Fail one endpoint while evaluating every row; verify a completed run with
   an `ERROR` instance and no accidental retirement. Fail the run before the
   full inventory is evaluated; verify no phase-2 reconciliation.
5. Verify URL Check observation mapping: SUCCESS→RUNNING, FAILURE→ERROR,
   MISSED/no-data/disabled preserve the last status, and GONE cannot be
   overwritten.
6. Disable/re-enable a config; verify effective-owner scheduling and
   auto-disable streak reset only on the explicit enable transition.
7. Remove an endpoint; verify check/history deletion only after GONE and no
   effective Source membership. Verify a shared instance/check is retained.
8. Delete and recreate a config; reattach the same Source and preserve its
   run/membership/check history.
9. Migrate existing `{ url }` configs one-to-one; preserve IDs/history and
   disable retained legacy checks.
10. Verify direct URL Check writes and manual Component-create monitoring
    payloads return `410 URL_CHECK_WRITE_DEPRECATED`; read paths remain.

## Frontend unit tests

```bash
pnpm --filter @componode/frontend test:unit
```

Expected:

- Builder adds/removes profiles and instances without key drift and reports
  validation errors on the affected row.
- Web URL hides authentication fields; API URL exposes credential-backed
  modes and never renders secret values.
- Component detail shows managed Check summaries read-only with a link to
  the owning ImporterConfig; legacy checks remain disabled/read-only.
- Importer detail shows profile→instance→check grouping, run-level outcome
  summaries, and config disable/re-enable state.
- URL Check status presentation remains distinct from the raw latest importer
  response details.

## Documentation checks

```bash
pnpm --filter @componode/backend docs:api:check
pnpm --filter @componode/backend docs:importers:check
```

Expected: OpenAPI, generated API tables, and generated Web/API importer
contract tables agree with the new config and deprecated-write contracts.

## End-to-end journey

Use the repository's isolated Playwright workload in
[`playwright/quickstart.md`](../../playwright/quickstart.md). Exercise:

- Create a collection with two profiles and multiple instances.
- Complete a run with one reachable and one failing endpoint.
- Inspect the read-only URL Check status in Component detail and open the
  owning ImporterConfig to edit it.
- Disable/re-enable the config and verify check scheduling/auto-disable
  behavior.
- Verify keyboard-only profile/instance editing and no horizontal overflow
  at 768px.
