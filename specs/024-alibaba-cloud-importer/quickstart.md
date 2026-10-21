# Quickstart — Validating the Alibaba Cloud Importer

## Automated validation

```bash
pnpm install
pnpm -r build
pnpm --filter @componode/importer-alibaba-cloud test      # unit: mapping, pagination, skips, abort, testSecrets
pnpm --filter @componode/backend test                   # integration: run service + provider CHECK
pnpm lint && pnpm typecheck
```

Unit coverage expectations (all SDK access mocked at `src/client.ts`):

- ACCOUNT asset + one asset per mapped search record, all passing
  `validateDiscoveredAsset`
- unmapped `ACS::*::*` → skipped, warned, listed in `coverage.skippedTypes`
- `regionIds`/`resourceTypes`/`resourceGroupId` → correct SearchResources
  `Filter[]`
- `enrichResources`/`includeCosts` on→extra calls, off→none; denied →
  capability markers, run still completes
- Resource-Center-disabled → throws before yields; abort mid-page → stops
- `testSecrets` ok/false paths; `process.env` never touched

## Manual smoke (real account, optional)

1. RAM user + AccessKey; policy: `AliyunResourceCenterReadOnlyAccess` (or
   `resourcecenter:Search*`/`Get*`) + `bss:DescribeInstanceBill` if testing costs.
2. Enable Resource Center in the account console (one-time).
3. Store the credential in Componode → run the **credential test** → expect ok.
4. Create importer config `alibaba-cloud`, run → verify:
   - account component `Alibaba Cloud account <id>` exists;
   - components appear with `provider: ALIBABA_CLOUD`, correct categories,
     region on instances;
   - `details.coverage` on the account component reflects any skipped types.
5. Re-run → zero duplicates (reconciliation by externalId).
