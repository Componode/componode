# Quickstart: validating the Alibaba SDK client fixes

**Feature**: `057-bugfix-alibaba-sdk-clients`

## Prerequisites

- Repo at branch `057-bugfix-alibaba-sdk-clients`, `pnpm install` done.
- No Alibaba credentials needed — all validation is offline.

## 1. Unit tests (test-first)

```bash
cd packages/importer-alibaba-cloud && pnpm test
```

Expected:

- `sdkCtor` returns the constructor whether the module object is a CJS
  namespace (`{ default: Client }`) or the class itself.
- `buildSdkConfig` sets `regionId` on the returned Config when `region`
  is configured, and per-service `endpoint` when `stsEndpoint` /
  `bssEndpoint` / `endpoint` are configured.
- Schema tests: `region`, `stsEndpoint`, `bssEndpoint` parse; a private-IP
  `stsEndpoint` (`http://169.254.169.254/...`) is rejected by
  `urlSafetyError`.
- Existing importer tests still pass (`buildClients` is mocked there).

## 2. Construction smoke under the real build

```bash
cd packages/importer-alibaba-cloud && pnpm build && node -e "
  import('./dist/client.js').then(m => {
    const c = m.buildClients({ accessKeyId: 'x', accessKeySecret: 'y' },
      { regionIds: [], resourceTypes: [], environment: 'PRODUCTION',
        enrichResources: false, includeCosts: false,
        region: 'cn-hangzhou', stsEndpoint: 'https://mock-alibaba',
        bssEndpoint: 'https://mock-alibaba' });
    console.log('constructed:', Object.keys(c));
  });
"
```

Expected: `constructed: getCallerIdentity,getServiceStatus,...` — no
`is not a constructor`. This exercises the real `tsc` output where
default-import binding previously broke under bundled CJS shapes.

## 3. Docs regeneration

```bash
cd packages/backend && pnpm docs:importers && pnpm docs:importers:check
```

Expected: `docs/importers/alibaba-cloud.md` `GENERATED:contract` table
shows `region`, `stsEndpoint`, `bssEndpoint`; check passes clean.

## 4. Package gate

```bash
cd packages/importer-alibaba-cloud && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

All four steps green.
