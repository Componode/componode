# Contract — `alibaba-cloud` Importer

Importer contracts are code-level (manifest + generator), not HTTP — the
backend serves manifests and runs through existing generic endpoints, so
`docs/openapi.yaml` is unchanged by this feature.

## Manifest

```ts
export const manifest = {
  name: "alibaba-cloud",
  label: "Alibaba Cloud",
  description: "Import Alibaba Cloud account resources via Resource Center.",
  version: "1.0.0",
  implPath: "@componode/importer-alibaba-cloud/importer",
  configSchema: alibabaCloudConfigSchema,
  secrets: [
    { key: "accessKeyId", label: "AccessKey ID", required: true },
    { key: "accessKeySecret", label: "AccessKey Secret", required: true },
    { key: "securityToken", label: "STS security token", required: false },
  ],
};
```

Class: `AlibabaCloudImporter` (registry derives it from `alibaba-cloud` →
`AlibabaCloudImporter`; `instance.name === "alibaba-cloud"`).

## `run(config, secrets, context)` sequence

1. `awsConfigSchema`-equivalent parse → `alibabaCloudConfigSchema.parse` —
   invalid config throws before any network call.
2. Build clients from `secrets` (+`endpoint` override applied to the
   Resource Center client only).
3. `GetCallerIdentity` → account identity (auth failure → throw).
4. `GetResourceCenterServiceStatus` → disabled → throw actionable error.
5. `GetResourceCounts` (guarded → `capabilities.resourceCounts`).
6. `includeCosts` → `DescribeInstanceBill` (guarded → `capabilities.costs`).
7. `SearchResources` paginate (filters from config):
   - mapped type → build asset (+ optional `GetResourceConfiguration`
     enrichment, guarded per-resource) → `validateDiscoveredAsset` → yield;
   - unmapped → record skip, `logger.warn` once per type.
8. Yield ACCOUNT asset **last**, carrying `capabilities` + the final
   `coverage` summary (see ordering note below).
9. `reportPhase` transitions: `Authenticating` → `Checking service` →
    `Counting resources` → `Fetching costs` → `Searching resources` →
    `Completed`.

### Ordering note (coverage on account asset)

`coverage.skippedTypes` is only complete after the search loop, but the
account asset should be yielded early. Resolution: **compute skips during
the loop and yield the account asset last** — after the resource loop —
with the final coverage summary attached. Consumers reconcile on
`externalId`, so order within a run is irrelevant.

Alternatively (simpler): yield account first with `GetResourceCounts`
totals + `capabilities`, and put `skippedTypes` only in the run log.
**Chosen**: account-last, full coverage — one authoritative place for the
summary (spec FR-007).

## `testSecrets(secrets, config?)`

`GetCallerIdentity` only. `{ ok: true }` on success;
`{ ok: false, error }` on failure — status/code-class text only, never
secret material (e.g. `"Authentication failed (InvalidAccessKeyId)"`).

## Error semantics

| Condition | Behavior |
|---|---|
| Invalid config | `ZodError` before network |
| Auth failure on identity call | throw (run fails) |
| Resource Center disabled | throw, message names the service |
| Search API failure mid-pagination | throw (run fails) |
| Unmapped resource type | warn + coverage skip (non-fatal) |
| `GetResourceCounts`/costs/enrichment failure | capability marker on owning component |
| `signal.aborted` | stop yielding immediately |

## Minimum RAM permissions

`resourcecenter:SearchResources` (required);
`resourcecenter:GetResourceConfiguration` (only `enrichResources`);
`bss:DescribeInstanceBill` (only `includeCosts`). `GetCallerIdentity` and
`GetResourceCounts` need no authorization.
