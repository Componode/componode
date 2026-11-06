# Tasks: Docker importer enrichment

**Input**: Design documents from `/specs/064-docker-importer-enrichment/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — constitution VI (test-first is non-negotiable) and AGENTS.md (`validateDiscoveredAsset` must be exercised). Every story writes failing tests first, confirms they fail, then implements.

**Organization**: Tasks grouped by user story (US1–US5 from spec.md). US1/US2 touch disjoint files (`mapping.ts` / `swarm.ts`) and can run in parallel; US3/US4 share `importer.ts` and run in order; US5 consumes the finalized field shapes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5 mapping to spec.md user stories

## Phase 1: Setup

- [x] T001 Run baseline `pnpm test` in `packages/importer-docker` and `packages/frontend` to confirm a green starting point on branch `064-docker-importer-enrichment`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared test infrastructure both importer stories need

- [x] T002 [P] Add `getImage` to the hoisted dockerode mock (`mocks.getImage` + `getImage = mocks.getImage` on the `DockerMock` class) in `packages/importer-docker/test/importer.test.ts`, returning `{ inspect: vi.fn() }` per image id — prerequisite for US4 image-inspect tests; harmless to existing tests

**Checkpoint**: Foundation ready — user story work can begin

---

## Phase 3: User Story 1 — Container instance enrichment (Priority: P1) 🎯 MVP

**Goal**: Container instances carry `imageId`, bounded `hostConfig`, and `healthcheck` timing — no env vars, no test commands, no host paths.

**Independent Test**: `packages/importer-docker` unit tests — fixture inspects with/without HostConfig+Healthcheck produce the contracted `rawConfig` keys and pass `validateDiscoveredAsset`.

### Tests for User Story 1

> Write these FIRST, ensure they FAIL before implementation.

- [x] T003 [P] [US1] Failing mapping tests in `packages/importer-docker/test/mapping.test.ts`: `imageId` from `inspect.Image`; `hostConfig` keys (`memoryBytes`←`HostConfig.Memory`, `nanoCpus`←`NanoCpus`, `pidsLimit`←`PidsLimit`, `restartPolicy{mode←Name,maxRetries←MaximumRetryCount only when >0}`, `privileged`/`readOnlyRootfs` only when true, `logDriver`←`LogConfig.Type`); `healthcheck` keys (`intervalSeconds`/`timeoutSeconds`/`startPeriodSeconds` ns→s, `retries`); absent-when-unreported; assert `Config.Env`, `HostConfig.Binds`, and `Config.Healthcheck.Test` never appear in `rawConfig`
- [x] T004 [P] [US1] Failing run-level tests in `packages/importer-docker/test/importer.test.ts`: emitted container instance `rawConfig` carries the new keys end-to-end and `validateDiscoveredAsset(asset)` stays true

### Implementation for User Story 1

- [x] T005 [US1] Extend `ContainerInspect` in `packages/importer-docker/src/mapping.ts` with optional `Image?: string`, `HostConfig?` (Memory/NanoCpus/PidsLimit/RestartPolicy{Name,MaximumRetryCount}/Privileged/ReadonlyRootfs/LogConfig{Type} — `Test`/`Env`/`Binds` deliberately undeclared), and `Config.Healthcheck?` (Interval/Timeout/Retries/StartPeriod — `Test` undeclared); emit `imageId`/`hostConfig`/`healthcheck` in `mapContainer`'s `rawConfig` per `contracts/enriched-instance-fields.md`, leaving `dockerObservation` untouched
- [x] T006 [US1] Run `pnpm test` in `packages/importer-docker` until T003/T004 pass; confirm no `Env`/health-`Test`/bind-path leakage via the negative assertions

**Checkpoint**: US1 independently functional — container instances enriched, contract shape verified

---

## Phase 4: User Story 2 — Swarm service enrichment (Priority: P1)

**Goal**: Swarm service instances carry published ports, network names, and job-mode detection; job services stay `CONTAINER_ORCHESTRATION`.

**Independent Test**: `swarm.test.ts` — service fixtures with `EndpointSpec.Ports`, `Networks`, and each `Mode` variant produce the contracted `rawConfig`/`details`.

### Tests for User Story 2

> Write these FIRST, ensure they FAIL before implementation.

- [x] T007 [P] [US2] Failing tests in `packages/importer-docker/test/swarm.test.ts`: `ports[]` entries `{protocol,target,published,publishMode?}` from `Spec.EndpointSpec.Ports`; `networks[]` from `Spec.Networks[].Target`; `mode` = `replicated-job`/`global-job` for job `Mode` members (checked before replicated/global), `details.mode` in lockstep; empty ports/networks → keys absent; category stays `CONTAINER_ORCHESTRATION`

### Implementation for User Story 2

- [x] T008 [US2] Extend `SwarmService.Spec` in `packages/importer-docker/src/swarm.ts` with `EndpointSpec?: { Ports?: {Protocol?,TargetPort?,PublishedPort?,PublishMode?}[] }`, `Networks?: {Target?}[]`, and `Mode` with `ReplicatedJob?`/`GlobalJob?`; update `mapSwarmService` mode detection (job types first) and emit `ports`/`networks` on instance `rawConfig` per `contracts/enriched-instance-fields.md`
- [x] T009 [US2] Run `pnpm test` in `packages/importer-docker` until T007 passes

**Checkpoint**: US1 + US2 both independently functional

---

## Phase 5: User Story 3 — Engine component (Priority: P2)

**Goal**: Exactly one `COMPUTE`/`docker-engine` component per source on every transport/executor, facts in `details`, exclusions honored.

**Independent Test**: `engine.test.ts` + `importer.test.ts` — non-Swarm and Swarm runs each emit exactly one engine asset with the contracted shape; `validateDiscoveredAsset` passes.

### Tests for User Story 3

> Write these FIRST, ensure they FAIL before implementation.

- [x] T010 [P] [US3] Create failing `packages/importer-docker/test/engine.test.ts`: engine mapper emits `category:"COMPUTE"`, `provider:"DOCKER"`, `resourceType:"docker-engine"`, `externalId` = sourceIdentity verbatim (no `::` qualifier), `name` fallback chain, one `OTHER`/`RUNNING` instance with empty `rawConfig`, `details` field map per `contracts/engine-and-image-assets.md`, optional keys omitted when unreported
- [x] T011 [P] [US3] Failing `importer.test.ts` cases: engine asset emitted on non-Swarm runs AND Swarm runs (exactly once); excluded fields (`DockerRootDir`, proxy vars, `Plugins`, `SecurityOptions`, `Warnings`) never appear even when present in mocked `info()`/`version()`; `version()` called once per run

### Implementation for User Story 3

- [x] T012 [US3] Create `packages/importer-docker/src/engine.ts` — pure `mapEngineAsset(info, version, sourceIdentity)` per R2/R3 field map and exclusions in `research.md`/`contracts/engine-and-image-assets.md`
- [x] T013 [US3] Wire `packages/importer-docker/src/importer.ts`: hoist `docker.version()` to once per run before the Swarm gate (gate reuses it); emit the engine asset right after `reportSourceIdentity`, validated via `validateDiscoveredAsset`
- [x] T014 [US3] Run `pnpm test` in `packages/importer-docker` until T010/T011 pass

**Checkpoint**: US3 independently functional — engine component cataloged on every run

---

## Phase 6: User Story 4 — Image inspect enrichment (Priority: P2)

**Goal**: `includeImages` on → deduped per-image inspect merges bounded OCI/inspect details; off → zero calls; failures degrade per-image.

**Independent Test**: `importer.test.ts` with `getImage` mock — two refs sharing one `Id` produce one inspect call and merged details on both assets; a rejecting inspect still yields the asset without details.

### Tests for User Story 4

> Write these FIRST, ensure they FAIL before implementation.

- [x] T015 [P] [US4] Failing `importer.test.ts` cases: dedupe by `image.Id` across RepoDigests/RepoTags (one `getImage().inspect()` per unique Id, details merged into every ref's asset); `ociLabels` filtered to the exact 10-key `org.opencontainers.image.*` allowlist; `exposedPorts`/`user`/`entrypoint`/`workingDir`/`volumes`/`architecture`/`os` mapping; inspect rejection → asset still emitted with pre-feature details, other images unaffected; `includeImages:false`/unset → `getImage` never called and image output unchanged

### Implementation for User Story 4

- [x] T016 [US4] Rework the `includeImages` block in `packages/importer-docker/src/importer.ts`: build ref→asset descriptors first, dedupe `image.Id`, `mapWithConcurrency(INSPECT_CONCURRENCY)` inspect via `docker.getImage(id).inspect()` with per-image try/catch, merge bounded details per `contracts/engine-and-image-assets.md`, then yield — preserving existing `<none>` ref filtering and `seen` dedupe
- [x] T017 [US4] Run `pnpm test` in `packages/importer-docker` until T015 passes

**Checkpoint**: US4 independently functional — opt-in provenance with degrade semantics

---

## Phase 7: User Story 5 — Bounded UI surfacing (Priority: P3)

**Goal**: New facts render in named allowlisted sections; no generic rawConfig/details dump.

**Independent Test**: frontend unit tests render fixture components/instances carrying the new shapes and assert section content + absence of dump.

### Tests for User Story 5

> Write these FIRST, ensure they FAIL before implementation.

- [x] T018 [P] [US5] Failing tests in `packages/frontend/src/test/unit/` (new `docker-details.test.tsx` + extend `component-observation.test.tsx` as needed): hostConfig/healthcheck/ports/networks sections render from `rawConfig`; `docker-engine` details section renders engine keys; `image` details section renders `ociLabels` + inspect keys; unknown keys never render; expander appears for swarm-only observations (`swarmObservation` without `dockerObservation`)

### Implementation for User Story 5

- [x] T019 [US5] Create `packages/frontend/src/ux/components/catalog/docker-details.tsx` — typed shapers (`hostConfigOf`, `healthcheckOf`, `portsOf`, `networksOf`, `engineDetailsOf`, `imageDetailsOf`, …) + section components per `contracts/frontend-surfaces.md`, mirroring the `dockerObservationOf`/`ObservationDetails` pattern
- [x] T020 [US5] Update `packages/frontend/src/ux/components/catalog/component-detail.tsx`: generalize the instance expander to "any known allowlisted block" and add resourceType-keyed sections (`docker-engine`, `image`) to the Details card; `view-types.ts` unchanged
- [x] T021 [US5] Run `pnpm test` in `packages/frontend` until T018 passes; `pnpm lint && pnpm typecheck` clean

**Checkpoint**: All user stories independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T022 [P] Document every new collected field in `docs/importers/docker.md` ("What it imports" + "Swarm inventory" sections — prose only, GENERATED contract block untouched since no config fields change)
- [x] T023 Record **ADR-121 Amendment 3** in `researches/adrs/ADR-121-docker-importer.md` per R9 outline (new allowlisted fields, engine component, image inspect + degrade policy, restated exclusions)
- [x] T024 Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in `packages/importer-docker` and `packages/frontend`, then root `pnpm build`; confirm `docs/openapi.yaml` untouched and generated-docs checks pass
- [x] T025 [P] Update `docs/roadmap.md` — mark `064-docker-importer-enrichment` under Shipped and revise the Next entry (done at ship stage per AGENTS.md roadmap-sync rule)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: immediate
- **Foundational (Phase 2)**: after T001 — blocks US4 only in practice (mock), but completed first per convention
- **US1 (Phase 3)** and **US2 (Phase 4)**: independent files — parallel-safe
- **US3 (Phase 5)** then **US4 (Phase 6)**: share `importer.ts` — sequential
- **US5 (Phase 7)**: consumes finalized field shapes — after US1–US4 contracts are stable (tests may be drafted earlier against `contracts/`)
- **Polish (Phase 8)**: after all stories

### User Story Dependencies

- **US1 (P1)**: no dependencies — MVP slice
- **US2 (P1)**: no dependencies — parallel with US1
- **US3 (P2)**: no hard dependency on US1/US2 (engine asset is independent) but shares `importer.ts` with US4 — runs first
- **US4 (P2)**: depends on US3's `importer.ts` edits landing first (same file); consumes `details.imageId` already emitted today
- **US5 (P3)**: renders US1–US4 shapes; independently testable via fixtures at any point after contracts freeze

### Parallel Opportunities

- T003 ∥ T004 (different test files, same story)
- T007 standalone (swarm.test.ts)
- T010 ∥ T011 (engine.test.ts ∥ importer.test.ts)
- T015 standalone
- T018 standalone (frontend test file)
- T022 ∥ T023 ∥ T025 (docs/ADR/roadmap — different files)
- US1 phase ∥ US2 phase (mapping.ts vs swarm.ts)

---

## Parallel Example: User Story 1

```bash
# Launch both US1 test tasks together:
Task: "Failing mapping tests in packages/importer-docker/test/mapping.test.ts"
Task: "Failing run-level tests in packages/importer-docker/test/importer.test.ts"
```

## Implementation Strategy

### MVP First (US1 + US2)

1. T001 baseline → T002 mock → US1 (T003–T006) + US2 (T007–T009) in parallel
2. **VALIDATE**: container + swarm enrichment green — shippable increment

### Incremental Delivery

3. US3 engine component (T010–T014) → validate
4. US4 image inspect (T015–T017) → validate
5. US5 UI (T018–T021) → validate
6. Polish: docs + ADR-121 A3 + full verification → PR

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- Every emitted asset shape MUST pass `validateDiscoveredAsset` (existing yield-site checks + new engine yield)
- Negative assertions (no `Env`, no `Test`, no `DockerRootDir`, no proxy vars) are as important as positive ones — SC-004
- `docker.version()` hoist (T013) must keep the Swarm API-floor check working — it consumes the same call

---

## Phase 9: Convergence

- [x] T026 Fix `hasInstanceDetails` in `packages/frontend/src/ux/components/catalog/docker-details.tsx` so a non-empty `ports`/`networks` block alone triggers the instance expander (replace the `??`-over-`.length` chain with `||`/`Boolean` semantics), and add a regression test in `packages/frontend/src/test/unit/docker-details.test.tsx` for an instance carrying only `networks` per FR-018 (partial)
- [x] T027 Make `mapEngineAsset` in `packages/importer-docker/src/engine.ts` tolerate `null`/`undefined` info (optional-chain all reads) matching the defensive `info?.` style in `importer.ts`, and cover it in `packages/importer-docker/test/engine.test.ts` per FR-009 (partial)

---

## Phase 10: Review

- [x] T028 Fix `swarmManagers` dead code per code-review: spec — `info.Swarm.RemoteManagers` is `[]Peer` and the manager count is `Swarm.Managers` (int, omitempty) per moby `swarm.Info`; correct `EngineInfo.Swarm` in `packages/importer-docker/src/engine.ts`, emit `swarmManagers` from `Swarm.Managers`, and fix the fabricated fixture in `packages/importer-docker/test/engine.test.ts` (HIGH)
- [x] T029 Treat Docker unset sentinels as absent in `mapHostConfig` per code-review: spec — `Memory:0`, `NanoCpus:0`, `PidsLimit:-1/0` mean "no limit"; emit `memoryBytes`/`nanoCpus`/`pidsLimit` only when `> 0` so US1 AC2's "absent rather than zeroed" holds; add negative assertions in `packages/importer-docker/test/mapping.test.ts` (HIGH)
- [x] T030 Clarify `networks[]` doc wording per code-review: spec — `Spec.Networks[].Target` may be a network ID, not always a name; adjust `docs/importers/docker.md` wording to "network targets (names or IDs as reported)" (LOW)
- [x] T031 Unexport module-private shapers/sections in `packages/frontend/src/ux/components/catalog/docker-details.tsx` per code-review: standards — only `hasInstanceDetails`, `InstanceDetails`, `EngineDetailsSection`, `ImageDetailsSection` are consumed by `component-detail.tsx`; Speculative Generality (LOW)
- [x] T032 Extract the duplicated `x && typeof x === "object"` record guard and the `Object.values(out).some(v => v !== undefined)` non-empty check into shared helpers in `docker-details.tsx` per code-review: standards — Duplicated Code (LOW)
- [x] T033 Carry the image `ref`/`name` through the `emitted` descriptors in `packages/importer-docker/src/importer.ts` instead of re-deriving via `externalId.slice("docker-image:".length)` — Duplicated Code / Data Clump (LOW)
- [x] T034 Rename the instance expander aria-label from "Show/Hide observation" to "Show/Hide details" in `component-detail.tsx` and update queries in `component-observation.test.tsx` + `docker-details.test.tsx` per code-review: standards — Mysterious Name (LOW)
- [x] T035 Replace the nested `NonNullable<NonNullable<ContainerInspect["Config"]>["Healthcheck"]>` param type in `mapHealthcheck` with a named `HealthcheckConfig` alias per code-review: standards (LOW)
- [x] T036 Exercise `validateDiscoveredAsset` in the new `packages/importer-docker/test/mapping.test.ts` enrichment cases (build the asset via `buildAsset` and validate) per code-review: standards / AGENTS.md importer-test rule (LOW)

---

## Phase 11: Review

- [x] T037 Apply `asObj` inside `engineDetailsOf`/`imageDetailsOf`, make `strArr` return `undefined` on empty arrays (so `hasDefined` can't render an empty section header on free-form JSONB), and rename `swarmNetworksOf` → `networksOf` (it serves container instances too) in `packages/frontend/src/ux/components/catalog/docker-details.tsx` per code-review: standards — Duplicated Code / edge-case robustness / Mysterious Name (LOW)
- [x] T038 Align spec wording with the ratified contract per code-review: spec — `spec.md` FR-007/US2 AC2 say "names" but `Spec.Networks[].Target` may be an ID (say "names or IDs as reported"); note the single `/version` call per run (non-Swarm engines gain it; FR-013 clarification); fix the stale "Not yet specced" header in `researches/docker-importer-enrichment-pack.md` (LOW)
- [x] T039 Render container image identity in a named "Image" instance section (`imageRef`, `imageDigest`, `imageId` when present) in `docker-details.tsx` + `contracts/frontend-surfaces.md`, satisfying US1's "operator can see the deployed image's immutable ID" narrative and US1 AC3's "new facts render" per code-review: spec (LOW)
