# Contract: AlibabaCloudConfig additions

**Feature**: `057-bugfix-alibaba-sdk-clients`

The importer's public contract is its manifest `configSchema` (consumed by
the backend for validation, by the frontend schema-driven forms for field
rendering, and by `docs:importers` for the generated docs table). This is
a **backward-compatible additive change** — all new fields optional.

## New fields

```ts
region: z.string().min(1).optional()
  .describe("Pin all Alibaba SDK clients to this region (e.g. cn-hangzhou) — connectivity, not a discovery filter; SDK default resolution when unset"),

stsEndpoint: z.string().url() /* + urlSafetyError superRefine */ .optional()
  .describe("STS endpoint override (VPC gateway / mock) — takes precedence over region for STS"),

bssEndpoint: z.string().url() /* + urlSafetyError superRefine */ .optional()
  .describe("BSS endpoint override (VPC gateway / mock) — takes precedence over region for BSS"),
```

## Existing field clarifications

- `regionIds` — description stays "Restrict discovery to these regions";
  unchanged semantics (Resource Center `SearchResources` filter only).
- `endpoint` — stays Resource Center-only; description may gain a pointer
  to `stsEndpoint`/`bssEndpoint` for STS/BSS overrides.

## Consumer impact

| Consumer | Impact |
|---|---|
| Backend `/api/v1/importer-configs` | accepts the new optional fields automatically (schema-driven validation); no code change |
| Frontend importer form | renders three new optional inputs from `.describe()` text; no code change |
| `docs/importers/alibaba-cloud.md` | `GENERATED:contract` table picks up the new rows via `docs:importers`; prose updated manually |
| Import Agent | none — it runs the same manifest/importer code |

## Constructor contract (internal)

`buildSdkConfig(secrets, opts)` gains an options object
`{ endpoint?: string; regionId?: string }` — exported for unit tests.
`sdkCtor(mod)` unwraps `.default` until a callable constructor surfaces
(Node ESM namespaces nest `default = module.exports`, which itself carries
`.default = Client`). `buildClientOpts(config)` maps the config into the
per-client `{endpoint, regionId}` triple, including the STS/BSS
global-endpoint fallbacks. None of these are part of the importer's
manifest-level public contract.
