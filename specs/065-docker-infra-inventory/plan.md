# Implementation Plan: Docker infrastructure inventory

**Branch**: `065-docker-infra-inventory` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/065-docker-infra-inventory/spec.md` — design ratified in `researches/docker-importer-enrichment-pack.md` (Wave G).

## Summary

Extend `@componode/importer-docker` with bounded infrastructure inventory
inside the existing ADR-121 allowlist philosophy — zero new endpoints, zero
new config keys, zero API/contract changes:

1. **`GET /networks` → `NETWORK`/`DOCKER` components** (`resourceType:
   "network"`), always emitted — scope-qualified identity
   (`{sourceIdentity}::network:{scope}:{name}`), `instances: []`, bounded
   `details` (driver/scope/flags/createdAt/attachments/labels).
2. **`GET /volumes` → `STORAGE`/`DOCKER` components** (`resourceType:
   "volume"`), always emitted — name-qualified identity
   (`{sourceIdentity}::volume:{name}`), `instances: []`, bounded `details`
   (driver/scope/createdAt/usage/labels).

Phase-0 research verified two facts that refine *how* the ratified fields
are sourced (fields and allowlists unchanged):

- `GET /networks` **list omits `Containers` on API ≥ 1.28** (every
  supported engine) → attachments require one `NetworkInspect`
  (`GET /networks/{id}`) per listed network under the existing
  `INSPECT_CONCURRENCY` cap; inspect errors fail the run (fail-closed).
- Volume `UsageData` is **omitted outside `GET /system/df`** → one
  `docker.df({type:"volume"})` call joins usage (`Size`/`RefCount`,
  `Reclaimable` when reported) by volume `Name`.

Both list endpoints exist since Engine API **v1.21** — far below the
existing v1.41 Swarm floor; **no new version gate** (FR-014 resolved).

All changes live in shared importer code + the frontend Details card, so
Hub and Agent executors get identical output (ADR-122). ADR-121 gains
Amendment 4; `docs/importers/docker.md` documents every new field.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: `dockerode` (Engine API client — `listNetworks`, `getNetwork().inspect()`, `listVolumes`, `df()` all present), Zod, Vitest; React 18 + Testing Library (frontend)
- **Storage**: PostgreSQL via Kysely — **no schema changes**; `details` is `z.record(z.string(), z.unknown())` JSONB passthrough; `NETWORK`/`STORAGE` categories already exist in `packages/core/src/constants/component-categories.ts`
- **Testing**: Vitest unit tests in `packages/importer-docker/test/` (dockerode mocked via `vi.hoisted` — `listNetworks`/`listVolumes`/`df`/`getNetwork` mocks must be added), frontend component tests in `packages/frontend/src/test/unit/`; every emitted shape exercises `validateDiscoveredAsset`; Playwright coverage per AGENTS.md
- **Target Platform**: Self-hosted Docker Compose; importer runs in-process on Hub or on Import Agent — identical code path
- **Project Type**: pnpm monorepo (`packages/importer-docker`, `packages/frontend`, `docs/`, `researches/`)
- **Performance Goals**: +2 list calls + 1 `system/df` call + ≤N `NetworkInspect` calls per run (N = network count, low cardinality, concurrency ≤ 8); zero calls when the engine returns empty lists beyond the lists themselves
- **Constraints**: ADR-121 minimization — no IPAM config, endpoint MACs/IPs/endpoint IDs, network/volume `Options`, volume `Mountpoint`/`Status`/`Id`, host paths; excluded fields never declared on local interfaces; fail-closed on any infra-endpoint error; no `openapi.yaml`/manifest/config-schema changes
- **Scale/Scope**: 1 new importer source file (`infra.ts`), `importer.ts` wiring, 1-2 test files, `docker-details.tsx` + `component-detail.tsx` + tests, 1 ADR amendment, 1 docs page, Playwright spec

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I — Single-Organization, Self-Hosted**: No tenant concepts; inventory is per-source.
- **II — Importer-First**: Importer stays pull-only, depends only on `@componode/core` + `dockerode`; all new assets emitted through `DiscoveredAsset` and validated by `validateDiscoveredAsset`. No DB access.
- **III — Two-Level Taxonomy**: `NETWORK`/`STORAGE` are existing categories; `resourceType` stays free-form (`"network"`/`"volume"` join `"image"`/`"swarm-secret"` precedent). No enum or CHECK-constraint changes.
- **IV — Environment-as-Instance**: Infra components carry `instances: []` — point-in-time facts in `details`, the ratified image/swarm-secret precedent; no `environment` fields.
- **V — Factual vs. Meaning Layer**: No edges, no product hierarchy; pure factual-layer attributes.
- **VI — Test-First**: Failing tests first for every mapping change (network fields/exclusions, volume fields/exclusions, df join, fail-closed), frontend rendering tests, Playwright coverage, then implementation.
- **VII — Observability from Day One**: New `reportPhase` labels ("Inventorying infrastructure") ride the existing run-phase channel; no new uninstrumented paths.

**Post-design gate**: PASS — re-checked after Phase 1; no violations introduced by the field contracts.

## Architecture and Data Flow

1. **Infra phase** (`importer.ts`, after the `includeImages` block, before
   `reportPhase("Completed")`): `reportPhase("Inventorying
   infrastructure")`, then `Promise.all([docker.listNetworks(),
   docker.listVolumes(), docker.df({type:"volume"})])` — three parallel
   calls; any rejection fails the run (fail-closed, FR-012).
2. **Networks** (`infra.ts`): normalize the list response (array;
   tolerate `{Networks:[]}` wrapper defensively), then per network
   `docker.getNetwork(id).inspect()` under `mapWithConcurrency(
   INSPECT_CONCURRENCY)` — the inspect supplies `Containers` (absent from
   list on API ≥1.28). `mapNetwork(listRow, inspect, sourceIdentity)` →
   `NETWORK` asset; validate + yield each. Inspect failure → throw (run
   fails).
3. **Volumes** (`infra.ts`): join `listVolumes().Volumes` with
   `df.Volumes` by `Name` → `mapVolume(volume, usage, sourceIdentity)` →
   `STORAGE` asset; validate + yield each.
4. **UI** (`docker-details.tsx` + `component-detail.tsx`): new
   `networkDetailsOf`/`volumeDetailsOf` allowlist shapers +
   `NetworkDetailsSection`/`VolumeDetailsSection`, wired into the Details
   card keyed on `resourceType === "network" | "volume"` — same pattern
   as `EngineDetailsSection`/`ImageDetailsSection`. No instance expander
   work (`instances: []`).

## Project Structure

### Documentation (this feature)

```text
specs/065-docker-infra-inventory/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & verified API facts
├── data-model.md        # Phase 1 — emitted asset shapes
├── contracts/
│   ├── infra-assets.md          # network + volume component contracts
│   └── frontend-surfaces.md     # UI rendering contract
├── quickstart.md        # Phase 1 — validation guide
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # /speckit-tasks output (next stage)
```

### Source Code (repository root)

```text
packages/
├── importer-docker/src/
│   ├── infra.ts         # NEW — Network/Volume/DF types + pure mappers
│   └── importer.ts      # + infra phase wiring (list/inspect/df/emits)
├── importer-docker/test/
│   ├── infra.test.ts    # NEW — mapper unit tests (allowlist/exclusions)
│   └── importer.test.ts # + listNetworks/listVolumes/df/getNetwork mocks, emit + fail-closed cases
└── frontend/src/
    ├── ux/components/catalog/
    │   ├── component-detail.tsx   # + network/volume section wiring
    │   └── docker-details.tsx     # + infra shapers + section components
    └── test/unit/                 # + docker-details infra cases
playwright/tests/                  # + infra inventory coverage (per AGENTS.md)
docs/
└── importers/docker.md            # new collected fields documented
researches/adrs/ADR-121-docker-importer.md   # Amendment 4
docs/roadmap.md                    # shipped entry (Stage 8)
```

**Structure Decision**: feature is importer-package + one frontend detail
module + docs/ADR + Playwright — no core, backend, agent-protocol, or
OpenAPI surface changes. `infra.ts` mirrors `engine.ts`/`swarm.ts` (pure
mappers unit-tested without dockerode).

## Phase breakdown (for /speckit-tasks)

1. **Contract tests first**: failing unit tests for network
   allowlist/exclusions + scope-qualified identity, volume
   allowlist/exclusions + df usage join, fail-closed on endpoint errors.
2. **Importer implementation**: `infra.ts` → `importer.ts` wiring; all
   tests green.
3. **Frontend**: `docker-details.tsx` infra shapers/sections +
   `component-detail.tsx` wiring + unit tests.
4. **Docs & ADR**: `docs/importers/docker.md` field docs, ADR-121
   Amendment 4, generated-docs checks green.
5. **Playwright**: spec exercising the infra components end-to-end per
   AGENTS.md testing rules.
6. **Verification**: `pnpm lint && pnpm typecheck && pnpm test &&
   pnpm build` in `packages/importer-docker` + `packages/frontend`,
   root build.

## Complexity Tracking

No constitution violations — table intentionally empty.
