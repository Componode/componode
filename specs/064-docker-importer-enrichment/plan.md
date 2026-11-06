# Implementation Plan: Docker importer enrichment

**Branch**: `064-docker-importer-enrichment` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/064-docker-importer-enrichment/spec.md` — design ratified in `researches/docker-importer-enrichment-pack.md` (Wave F).

## Summary

Enrich `@componode/importer-docker` output with bounded facts the Engine
API already returns, inside the existing ADR-121 allowlist philosophy —
zero new endpoints, zero new config keys, zero API/contract changes:

1. **Container instances** gain `rawConfig.imageId` (inspect `Image`),
   `rawConfig.hostConfig` (memory/CPU/pids limits, restart policy,
   posture flags, log driver), and `rawConfig.healthcheck` (timing
   definition in seconds; test command never read).
2. **Swarm service instances** gain `rawConfig.ports`
   (`protocol`/`target`/`published`/`publishMode?`) and `rawConfig.networks`
   from the already-fetched `Spec`; `swarmObservation.mode` learns
   `replicated-job`/`global-job`.
3. **One `COMPUTE` engine component per source**, always emitted on every
   transport and both executors — `externalId` = the source identity
   itself, `resourceType: "docker-engine"`, one `RUNNING` instance, and
   the bounded `/info`+`/version` fact set in component `details`
   (clarified: details, not instance rawConfig).
4. **Opt-in image inspect**: when `includeImages` is on, dedupe
   `GET /images/{id}/json` by unique image `Id` across all emitted image
   assets, merge bounded OCI-label/inspect details into each asset's
   `details`, degrade per-image on failure.
5. **Bounded UI**: `component-detail.tsx` renders the new fields through
   named allowlisted sections — no generic rawConfig/details dump.

All changes live in shared importer code + the frontend detail view, so
Hub and Agent executors get identical output (ADR-122). ADR-121 gains
Amendment 3; `docs/importers/docker.md` documents every new field.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: `dockerode` (Engine API client), Zod, Vitest; React 18 + Testing Library (frontend)
- **Storage**: PostgreSQL via Kysely — **no schema changes**; `rawConfig`/`details` are `z.record(z.string(), z.unknown())` JSONB passthrough (verified in `packages/core/src/validation/discovered-asset.ts`)
- **Testing**: Vitest unit tests in `packages/importer-docker/test/` (dockerode mocked via `vi.hoisted` — `getImage` mock must be added), frontend component tests in `packages/frontend/src/test/unit/`; every emitted shape exercises `validateDiscoveredAsset`
- **Target Platform**: Self-hosted Docker Compose; importer runs in-process on Hub or on Import Agent — identical code path
- **Project Type**: pnpm monorepo (`packages/importer-docker`, `packages/frontend`, `docs/`, `researches/`)
- **Performance Goals**: Enrichment adds zero calls on the container/Swarm path (reuses `inspect`, `listServices`, `info`); image inspect adds ≤1 deduped call per unique image ID, concurrency-limited to the existing `INSPECT_CONCURRENCY = 8`; one extra `/version` call per run on non-Swarm engines
- **Constraints**: ADR-121 minimization — no `Env`, host paths, health output/test commands, stats/events/logs, proxy vars, `DockerRootDir`, plugins, warnings, IPAM/options/address detail; `includeImages=false` → zero inspect calls; image-inspect failure degrades per-image (ratified); no `openapi.yaml`/manifest/config-schema changes
- **Scale/Scope**: 3 importer source files (`mapping.ts`, `swarm.ts`, `importer.ts` + likely a small `engine.ts`), 4 test files, 1 frontend detail module + tests, 1 ADR amendment, 1 docs page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I — Single-Organization, Self-Hosted**: No tenant concepts; enrichment is per-source inventory data.
- **II — Importer-First**: Importer stays pull-only, depends only on `@componode/core` + `dockerode`; all new fields are emitted through `DiscoveredAsset` and validated by `validateDiscoveredAsset`. No DB access.
- **III — Two-Level Taxonomy**: `COMPUTE` is an existing category; `resourceType` stays free-form (`"docker-engine"` joins `"swarm-node"`/`"image"`/`"swarm-service"`). No enum or CHECK-constraint changes.
- **IV — Environment-as-Instance**: Engine component carries one `OTHER`-environment instance; no `environment` field on components; `dockerObservation`/status semantics untouched.
- **V — Factual vs. Meaning Layer**: No edges, no product hierarchy; pure factual-layer attributes.
- **VI — Test-First**: Failing tests first for every mapping change (container fields, swarm fields, engine component, image inspect dedupe/degrade), frontend rendering tests, then implementation.
- **VII — Observability from Day One**: New `reportPhase` labels ("Inspecting images", engine emit) ride the existing run-phase channel; no new uninstrumented paths.

**Post-design gate**: PASS — re-checked after Phase 1; no violations introduced by the field contracts.

## Architecture and Data Flow

1. **Container path** (`mapping.ts`): `ContainerInspect` gains optional
   `Image`, `HostConfig`, and `Config.Healthcheck` declarations (Test
   command deliberately undeclared). `mapContainer` emits the three new
   `rawConfig` keys with absent-when-unreported semantics; ns→s
   conversion for healthcheck timings.
2. **Swarm path** (`swarm.ts`): `SwarmService.Spec` gains
   `EndpointSpec.Ports` + `Networks`; `Mode` gains `ReplicatedJob`/
   `GlobalJob` detection feeding `swarmObservation.mode` and
   `details.mode`. Instance `rawConfig` gains `ports`/`networks`.
3. **Engine component** (`importer.ts`, new `engine.ts` mapper): after
   `reportSourceIdentity`, emit one asset — `category: "COMPUTE"`,
   `provider: "DOCKER"`, `resourceType: "docker-engine"`,
   `externalId: sourceIdentity` (unqualified — the identity is already
   `docker-engine:{id}`), `name: info.Name ?? engineId`, one `OTHER`/
   `RUNNING` instance (`instanceExternalId(sourceIdentity, "engine")`),
   `details` = bounded `/info`+`/version` facts. `docker.version()` is
   called once per run (hoisted before the Swarm gate; the gate reuses
   it). Excluded `/info` fields are never declared on the local
   interface.
4. **Image inspect** (`importer.ts` `includeImages` block): collect
   emitted ref→asset descriptors first, dedupe `image.Id`, inspect each
   unique ID via `docker.getImage(id).inspect()` under
   `mapWithConcurrency(8)`, `try/catch` per image → merge bounded
   details into every asset carrying that `Id`, then yield. Assets for
   failed inspects emit with today's `details` shape only.
5. **UI** (`component-detail.tsx` + new `docker-details.tsx`): the
   instance-row expander generalizes from "dockerObservation only" to
   "any known allowlisted block" (`dockerObservation`, `hostConfig`,
   `healthcheck`, `ports`, `networks`, `swarmObservation.mode` job
   values render through the same section pattern). The Details card
   gains resourceType-keyed sections: `docker-engine` → engine facts;
   `image` → OCI labels + inspect facts. Every renderer is an explicit
   allowlist shaper — unknown keys never render.

## Project Structure

### Documentation (this feature)

```text
specs/064-docker-importer-enrichment/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & verified facts
├── data-model.md        # Phase 1 — emitted field shapes
├── contracts/
│   ├── enriched-instance-fields.md   # container + swarm rawConfig additions
│   ├── engine-and-image-assets.md    # engine component + image details
│   └── frontend-surfaces.md          # UI rendering contract
├── quickstart.md        # Phase 1 — validation guide
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # /speckit-tasks output (next stage)
```

### Source Code (repository root)

```text
packages/
├── importer-docker/src/
│   ├── mapping.ts        # + imageId/hostConfig/healthcheck on ContainerInspect + rawConfig
│   ├── swarm.ts          # + EndpointSpec.Ports/Networks, job-mode detection
│   ├── engine.ts         # NEW — engine component mapper (pure)
│   └── importer.ts       # + engine emit, hoisted /version, image-inspect merge
├── importer-docker/test/
│   ├── mapping.test.ts   # + container enrichment cases
│   ├── swarm.test.ts     # + ports/networks/job-mode cases
│   ├── engine.test.ts    # NEW — engine component cases
│   └── importer.test.ts  # + getImage mock, engine asset, dedupe/degrade cases
└── frontend/src/
    ├── ux/components/catalog/
    │   ├── component-detail.tsx   # generalized expander + details sections
    │   └── docker-details.tsx     # NEW — allowlisted field renderers
    └── test/unit/                 # + docker-details / observation tests
docs/
└── importers/docker.md            # new collected fields documented
researches/adrs/ADR-121-docker-importer.md   # Amendment 3
docs/roadmap.md                    # shipped entry (Stage 8)
```

**Structure Decision**: feature is importer-package + one frontend detail
view + docs/ADR — no core, backend, agent-protocol, or OpenAPI surface
changes. `engine.ts` mirrors `swarm.ts`/`mapping.ts` (pure mappers
unit-tested without dockerode).

## Phase breakdown (for /speckit-tasks)

1. **Contract tests first**: failing unit tests for container
   `imageId`/`hostConfig`/`healthcheck`, swarm ports/networks/job-mode,
   engine component shape, image-inspect dedupe + degrade.
2. **Importer implementation**: `mapping.ts` → `swarm.ts` → `engine.ts`
   → `importer.ts` wiring; all tests green.
3. **Frontend**: `docker-details.tsx` renderers + `component-detail.tsx`
   integration + unit tests.
4. **Docs & ADR**: `docs/importers/docker.md` field docs, ADR-121
   Amendment 3, generated-docs checks green.
5. **Verification**: `pnpm lint && pnpm typecheck && pnpm test &&
   pnpm build` in `packages/importer-docker` + `packages/frontend`,
   root build.

## Complexity Tracking

No constitution violations — table intentionally empty.
