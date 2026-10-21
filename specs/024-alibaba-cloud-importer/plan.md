# Implementation Plan: Alibaba Cloud Importer

**Branch**: `feature/024-alibaba-cloud-importer` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-alibaba-cloud-importer/spec.md`

## Summary

Add an eighth in-tree importer, `@componode/importer-alibaba-cloud`
(`name: "alibaba-cloud"`, class `AlibabaCloudImporter`), that discovers an
Alibaba Cloud account's resources via Resource Center `SearchResources` and
yields them as `DiscoveredAsset` records — one ACCOUNT component plus one
component+instance per resource. Opt-in capabilities: per-resource
enrichment (`GetResourceConfiguration`), cost data (BSS `DescribeInstanceBill`),
and always-on coverage reporting (`GetResourceCounts`). Requires the
three-way taxonomy update for the new `ALIBABA_CLOUD` provider (constitution
III): taxonomy research (already lists the value), `packages/core` constant
+ meta, and migration 015 rebuilding `components_provider_check`.
Full decision record: `researches/adrs/ADR-115-alibaba-cloud-importer.md`;
API analysis: `researches/alibaba-cloud-importer_research.md`.

## Technical Context

**Language/Version**: TypeScript 6 (ESM, `"type": "module"`)

**Primary Dependencies**: `@componode/core` (only `@componode/*` dep);
`@alicloud/resourcecenter20221201` (~v1.6, SearchResources /
GetResourceCounts / GetResourceConfiguration /
GetResourceCenterServiceStatus); `@alicloud/sts20150401` (GetCallerIdentity —
testSecrets probe + account identity); `@alicloud/bssopenapi20171214`
(DescribeInstanceBill — includeCosts path only); `zod` (config schema)

**Storage**: PostgreSQL — migration `015_alibaba_cloud_provider.ts`
rebuilds `components_provider_check` from `COMPONENT_PROVIDERS` (same
drop/re-add pattern as `010_account_category.ts`); no table changes

**Testing**: vitest. Unit tests mock the importer's own client module seam
(`vi.mock("../src/client.js")`) — never live network, per
`docs/importer-development.md`. Backend integration test mocks
`getImporter` (import-runs.test.ts pattern) to drive a run producing
`ALIBABA_CLOUD` assets through the run service + new CHECK constraint.

**Target Platform**: Node.js service (Docker Compose deploy); importer runs
inside the backend process via the run service

**Project Type**: pnpm workspace package (`packages/importer-alibaba-cloud`)

**Performance Goals**: ≤20 QPS provider limit — `MaxResults=100`
pagination, retry-with-backoff on `Throttling` errors; base run cost = 2
calls + ceil(N/100); enrichment multiplies cost 1:1 with resources (documented)

**Constraints**: pull-only `AsyncGenerator<DiscoveredAsset>`; no
`process.env` access; secrets from resolved `secrets` record only
(ADR-107); `AbortSignal` honored at every page/enrichment boundary; no
`relationships` in v1; URL config fields validated via `urlSafetyError`
(ADR-106); errors never echo credential material

**Scale/Scope**: accounts of any size (discover-all default); unmapped
`ACS::*::*` types skip with warning + coverage summary

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-organization | PASS | One credential set = one account; no tenant layer |
| II. Importer-first | PASS | Pull-only generator; deps limited to `@componode/core` + vendor SDKs; no DB, no `process.env`, no backend imports |
| III. Two-level taxonomy | PASS w/ required work | `ALIBABA_CLOUD` triggers the mandated three-way update: taxonomy research (value already proposed in `component_taxonomy_research.md` §12.3) → core constant + `COMPONENT_PROVIDER_META` → migration rebuilding `components_provider_check`. Categories unchanged; `resourceType` carries raw `ACS::*::*` |
| IV. Environment-as-instance | PASS | One instance per resource; `region` on instance; env from config (default `PRODUCTION`) |
| V. Factual vs meaning layer | PASS | No `relationships`; components/instances only |
| VI. Test-first | PASS | Contract tests exercise `validateDiscoveredAsset`; SDK mocked; integration test through run service |
| VII. Observability | PASS | `context.logger` + `reportPhase` only; no pino/OTel imports |

Post-design re-check: identical verdicts — no new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/024-alibaba-cloud-importer/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 output — consolidated decisions
├── data-model.md        # Phase 1 output — config schema + asset mapping
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/
│   └── importer-contract.md  # Phase 1 output — manifest/config/secrets contract
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
packages/importer-alibaba-cloud/     # NEW — mirrors importer-github layout
├── package.json                     # @componode/core + 3 @alicloud SDKs + zod
├── tsconfig.json                    # copy of importer-aws tsconfig
├── src/
│   ├── index.ts                     # re-exports manifest + AlibabaCloudImporter
│   ├── config.ts                    # alibabaCloudConfigSchema (zod, urlSafetyError on endpoint)
│   ├── manifest.ts                  # name "alibaba-cloud", secrets declarations
│   ├── client.ts                    # builds SDK clients from secrets+config (mock seam)
│   ├── importer.ts                  # run() + testSecrets()
│   ├── mapping.ts                   # ACS::<S>::<T> → category map, slug, externalId, status map
│   ├── capabilities.ts              # withCapability/marker helpers (GitHub pattern)
│   ├── account.ts                   # GetCallerIdentity → ACCOUNT asset + coverage summary
│   ├── resources.ts                 # SearchResources pagination loop → assets
│   │                                #   (incl. opt-in GetResourceConfiguration enrichment)
│   └── costs.ts                     # BSS DescribeInstanceBill → details.billing (opt-in)
└── test/
    ├── client-mock.ts               # vi.mock factory for ../src/client.js
    ├── importer.test.ts             # contract + behaviors
    └── credential-test.test.ts      # testSecrets cases

packages/core/src/constants/component-providers.ts   # + ALIBABA_CLOUD
packages/backend/src/db/migrations/015_alibaba_cloud_provider.ts  # NEW
packages/backend/src/services/importer-registry.ts   # + package entry
packages/backend/package.json                        # + workspace:* dep
packages/backend/test/integration/                   # + alibaba run test
researches/component_taxonomy_research.md            # + addendum noting ratification
docs/importer-development.md                         # no change needed (doc is generic)
```

**Structure Decision**: New leaf importer package cloned from the
`importer-github` layout (the real-implementation reference), plus the
minimal cross-package touches required by the registry, provider taxonomy,
and dependency wiring. `client.ts` is a deliberate seam: the Darabonba SDK
surface is wide, so all SDK construction lives behind one module that unit
tests `vi.mock` wholesale — matching the guide's "mock the SDK" rule
without fighting generated-client internals.

## Phase 0 — Research

All NEEDS CLARIFICATION items were resolved in the pre-spec grilling and
the standalone research document. `research.md` consolidates:
decision/rationale/alternatives per the plan workflow.

## Phase 1 — Design & Contracts

- `data-model.md` — config schema, secrets, asset mapping, coverage/capability shapes.
- `contracts/importer-contract.md` — the manifest contract (name, secrets,
  configSchema surface) and run behavior contract; no HTTP API changes
  (importer manifests flow through existing generic endpoints → no
  `openapi.yaml` diff).
- `quickstart.md` — end-to-end validation: unit + integration tests, a
  real-account checklist for manual verification.

## Complexity Tracking

No constitution violations — table not required.
