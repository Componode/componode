# Tasks: Docker infrastructure inventory

**Input**: Design documents from `/specs/065-docker-infra-inventory/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — constitution VI (test-first is non-negotiable) and AGENTS.md (`validateDiscoveredAsset` must be exercised). Every story writes failing tests first, confirms they fail, then implements. Playwright coverage is required per AGENTS.md § Testing.

**Organization**: Tasks grouped by user story (US1–US4 from spec.md). US1 and US2 share `infra.ts`/`importer.ts` and run in order; US3 is a verification story over the shared label allowlist; US4 consumes the finalized `details` shapes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 mapping to spec.md user stories

## Phase 1: Setup

- [X] T001 Run baseline `pnpm test` in `packages/importer-docker` and `packages/frontend` to confirm a green starting point on branch `065-docker-infra-inventory`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared helpers and test infrastructure every infra story needs

- [X] T002 [P] Export the label prefix-allowlist helper for infra reuse: `allowedLabels` in `packages/importer-docker/src/mapping.ts` is module-private — export it (or extract `ALLOWED_LABEL_PREFIXES` + a labels-only variant) so `infra.ts` applies the identical `com.docker.compose.*`/`componode.*` boundary (research.md R5); keep `mapping.ts` behavior unchanged
- [X] T003 [P] Add `listNetworks`, `listVolumes`, `df`, and `getNetwork` (returning `{ inspect: vi.fn() }` per id) to the hoisted dockerode mock in `packages/importer-docker/test/importer.test.ts` — prerequisite for all infra run-level tests; harmless to existing tests (mirrors spec-064 T002)

**Checkpoint**: Foundation ready — user story work can begin

---

## Phase 3: User Story 1 — Network inventory (Priority: P1) 🎯 MVP

**Goal**: Every engine network becomes a `NETWORK`/`DOCKER` component with scope-qualified identity and bounded details — attachments via per-network inspect, fail-closed on errors.

**Independent Test**: `infra.test.ts` + `importer.test.ts` — network fixtures produce the contracted `details` shape and pass `validateDiscoveredAsset`; same-named networks in different scopes stay distinct.

### Tests for User Story 1

> Write these FIRST, ensure they FAIL before implementation.

- [X] T004 [P] [US1] Create failing `packages/importer-docker/test/infra.test.ts`: `mapNetwork` emits `category:"NETWORK"`, `provider:"DOCKER"`, `resourceType:"network"`, `name` = `Network.Name`, `externalId` = `qualifyExternalId(sourceIdentity, "network:{scope}:{name}")`, `instances: []`; `details` field map per `contracts/infra-assets.md` (`driver`,`scope`,`createdAt` verbatim; `internal`/`attachable`/`ingress`/`configOnly`/`enableIPv6` only when true; `attachedCount`/`attachedContainers` from inspect `Containers` names only; `labels` allowlisted); absent-when-unreported; negative assertions — `Id`, `IPAM`, `Options`, endpoint `MacAddress`/`IPv4Address`/`EndpointID` never appear
- [X] T005 [P] [US1] Failing `importer.test.ts` cases: infra phase emits one network asset per listed network (validateDiscoveredAsset true); per-network `getNetwork().inspect()` called once each under concurrency; inspect rejection fails the run; `listNetworks` rejection fails the run before any infra yield; `{Networks:[…]}`-wrapped and bare-array list shapes both normalize

### Implementation for User Story 1

- [X] T006 [US1] Create `packages/importer-docker/src/infra.ts` — narrow local interfaces (`NetworkSummary`, `NetworkInspect` with `Containers`, `VolumeSummary`, `DfVolume`) declaring ONLY allowlisted fields (excluded fields never declared, per research.md R5) + pure `mapNetwork(listRow, inspect, sourceIdentity)` per `contracts/infra-assets.md`; normalize the list response defensively (research.md R7)
- [X] T007 [US1] Wire `packages/importer-docker/src/importer.ts`: after the `includeImages` block add `reportPhase("Inventorying infrastructure")` + `docker.listNetworks()`; inspect each network via `docker.getNetwork(id).inspect()` under `mapWithConcurrency(INSPECT_CONCURRENCY)`; `mapNetwork` → `validateDiscoveredAsset` → yield (research.md R6); any list/inspect error throws (fail-closed)
- [X] T008 [US1] Run `pnpm test` in `packages/importer-docker` until T004/T005 pass

**Checkpoint**: US1 independently functional — networks cataloged with attachments, contract shape verified

---

## Phase 4: User Story 2 — Volume inventory (Priority: P1)

**Goal**: Every engine volume becomes a `STORAGE`/`DOCKER` component with usage facts joined from `/system/df` — fail-closed on errors.

**Independent Test**: `infra.test.ts` + `importer.test.ts` — volume fixtures with/without `UsageData` produce the contracted `details` shape; df join by `Name`; `-1` sentinels omit fields.

### Tests for User Story 2

> Write these FIRST, ensure they FAIL before implementation.

- [X] T009 [P] [US2] Extend failing `packages/importer-docker/test/infra.test.ts`: `mapVolume` emits `category:"STORAGE"`, `provider:"DOCKER"`, `resourceType:"volume"`, `name` = `Volume.Name`, `externalId` = `qualifyExternalId(sourceIdentity, "volume:{name}")`, `instances: []`; `details` field map per `contracts/infra-assets.md` (`driver`,`scope`,`createdAt` verbatim; `sizeBytes`/`refCount`/`reclaimable` from df `UsageData` — omitted when `-1`/absent; `labels` allowlisted); negative assertions — `Mountpoint`, `Options`, `Status` never appear
- [X] T010 [P] [US2] Extend failing `importer.test.ts` cases: one `docker.df({type:"volume"})` call per run joined by volume `Name`; volumes absent from df emit without usage fields; `listVolumes`/`df` rejection fails the run; `Warnings` in the list response tolerated

### Implementation for User Story 2

- [X] T011 [US2] Add `mapVolume(volume, usage, sourceIdentity)` to `packages/importer-docker/src/infra.ts` per `contracts/infra-assets.md` — `sizeBytes`←`UsageData.Size` (omit `-1`), `refCount`←`UsageData.RefCount` (omit `-1`), `reclaimable`←`UsageData.Reclaimable` when present
- [X] T012 [US2] Extend the infra phase in `packages/importer-docker/src/importer.ts`: `Promise.all` `listVolumes()` + `docker.df({type:"volume"})` alongside the network list (verify dockerode modem serializes `type` correctly — fallback unfiltered `df()` + client-side filter per research.md R7); join df `Volumes` by `Name`, `mapVolume` → validate → yield after networks
- [X] T013 [US2] Run `pnpm test` in `packages/importer-docker` until T009/T010 pass

**Checkpoint**: US1 + US2 both independently functional — full infra inventory emitted

---

## Phase 5: User Story 3 — Compose-project attribution via labels (Priority: P2)

**Goal**: Infra components carry allowlisted labels — `com.docker.compose.project` attribution arrives free; non-allowlisted labels never leak.

**Independent Test**: `infra.test.ts` — network/volume fixtures labeled with compose-project + arbitrary keys emit only allowlisted labels; unlabeled → `labels` absent.

### Tests for User Story 3

> Write these FIRST, ensure they FAIL before implementation.

- [X] T014 [P] [US3] Add failing label-boundary cases to `packages/importer-docker/test/infra.test.ts`: `com.docker.compose.project`/`com.docker.compose.*`/`componode.*` keys preserved on both asset types; arbitrary keys (`com.example.*`, `internal.*`) dropped; `Labels: {}`/absent → `labels` key omitted entirely (not `{}`); verify against the shared helper exported in T002

### Implementation for User Story 3

- [X] T015 [US3] Ensure `mapNetwork`/`mapVolume` in `packages/importer-docker/src/infra.ts` route `Labels` through the shared prefix-allowlist helper (any gap the T014 tests expose — e.g. empty-object emission — fixed here); run `pnpm test` in `packages/importer-docker` until T014 passes

**Checkpoint**: US3 independently functional — attribution verified on both types

---

## Phase 6: User Story 4 — Bounded UI surfacing (Priority: P3)

**Goal**: Network/volume facts render in named allowlisted Details-card sections; no generic `details` dump.

**Independent Test**: frontend unit tests render fixture components with the contracted `details` shapes and assert section content + absence of dump.

### Tests for User Story 4

> Write these FIRST, ensure they FAIL before implementation.

- [X] T016 [P] [US4] Create failing `packages/frontend/src/test/unit/docker-infra.test.tsx` (or extend `docker-details.test.tsx`): `resourceType:"network"` renders driver/scope/flags/createdAt/attachedCount/attachedContainers/labels in a named section; `resourceType:"volume"` renders driver/scope/createdAt/sizeBytes (formatted)/refCount/reclaimable/labels; absent-when-unreported; unknown `details` keys never render; non-docker `details` shapes render nothing

### Implementation for User Story 4

- [X] T017 [US4] Extend `packages/frontend/src/ux/components/catalog/docker-details.tsx`: `networkDetailsOf`/`volumeDetailsOf` allowlist shapers + `NetworkDetailsSection`/`VolumeDetailsSection` per `contracts/frontend-surfaces.md` (reuse `DescriptionList`/`Badge`/`RelativeTime`/`formatBytes`)
- [X] T018 [US4] Wire `packages/frontend/src/ux/components/catalog/component-detail.tsx`: add `resourceType === "network"`/`"volume"` sections to the Details card beside the existing `docker-engine`/`image` sections; `view-types.ts` unchanged
- [X] T019 [US4] Run `pnpm test` in `packages/frontend` until T016 passes; `pnpm lint && pnpm typecheck` clean

**Checkpoint**: All user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T020 [P] Document every new collected field in `docs/importers/docker.md` ("What it imports" — networks/volumes bullet with field bounds and exclusions; prose only, GENERATED contract blocks untouched)
- [X] T021 [P] Record **ADR-121 Amendment 4** in `researches/adrs/ADR-121-docker-importer.md` per research.md R10 outline (infra inventory allowlists, scope/name identities, inspect+df sourcing, fail-closed policy, restated exclusions)
- [X] T022 Extend the mock Docker Engine (`playwright/mocks/docker-engine/server.ts`) to serve the infra surface: `GET /networks` + `GET /networks/{id}` (with `Containers` endpoint names + IPAM/Options/MAC/IP sentinels), `GET /volumes` (with Mountpoint/Options/Status sentinels), `GET /system/df?type=volume` (UsageData Size/RefCount + -1 cases), and labeled fixtures for compose attribution — per AGENTS.md § Testing (Playwright coverage rule)
- [X] T023 Add `playwright/tests/importers/docker-infra.spec.ts`: run asserts NETWORK+STORAGE components with bounded details and exclusion non-leakage, UI journey asserts named detail sections render — per AGENTS.md § Testing (Playwright coverage rule)
- [ ] T024 Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in `packages/importer-docker` and `packages/frontend`, `pnpm e2e` in `playwright/`, then root `pnpm build`; confirm `docs/openapi.yaml` untouched and generated-docs checks pass
- [X] T025 [P] Update `docs/roadmap.md` — mark `065-docker-infra-inventory` under Shipped and revise the Next entry (done at ship stage per AGENTS.md roadmap-sync rule)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: immediate
- **Foundational (Phase 2)**: after T001 — blocks all story work (mock + shared helper)
- **US1 (Phase 3)** → **US2 (Phase 4)**: share `infra.ts`/`importer.ts` — sequential (US2 extends US1's phase wiring)
- **US3 (Phase 5)**: after US1+US2 mappers exist — verification story
- **US4 (Phase 6)**: consumes finalized `details` shapes — after US1–US3 contracts stable
- **Polish (Phase 7)**: after all stories

### User Story Dependencies

- **US1 (P1)**: no dependencies — MVP slice
- **US2 (P1)**: depends on US1's `infra.ts` + infra-phase skeleton landing first (same files)
- **US3 (P2)**: depends on US1+US2 mapper contracts (labels are part of each `details`)
- **US4 (P3)**: renders US1–US3 shapes; independently testable via fixtures once contracts freeze

### Parallel Opportunities

- T002 ∥ T003 (different files — src vs test)
- T004 ∥ T005 (infra.test.ts ∥ importer.test.ts)
- T009 ∥ T010 (same split as T004/T005)
- T014 standalone (infra.test.ts)
- T016 standalone (frontend test file)
- T020 ∥ T021 ∥ T025 (docs/ADR/roadmap — different files)
- T022 → T023 sequential (mock before spec)

---

## Parallel Example: User Story 1

```bash
# Launch both US1 test tasks together:
Task: "Failing infra.test.ts network mapper cases"
Task: "Failing importer.test.ts network run-level cases"
```

## Implementation Strategy

### MVP First (US1)

1. T001 baseline → T002/T003 foundation → US1 (T004–T008)
2. **VALIDATE**: network inventory green — shippable increment

### Incremental Delivery

3. US2 volumes + df join (T009–T013) → validate
4. US3 label boundary (T014–T015) → validate
5. US4 UI (T016–T019) → validate
6. Polish: docs + ADR-121 A4 + Playwright + full verification → PR

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- Every emitted asset shape MUST pass `validateDiscoveredAsset` (existing yield-site pattern + new infra yields)
- Negative assertions (no `Id`, no `IPAM`, no `Options`, no `Mountpoint`, no `Status`, no endpoint MACs/IPs) are as important as positive ones — SC-002
- Fail-closed is deliberate: list/inspect/df errors throw — do NOT copy the image-inspect degrade-per-image pattern (research.md R2/R3)
- `docker.df({type:"volume"})` query serialization must be verified against dockerode's modem (T012) — fallback is unfiltered `df()` + client-side `Volumes` filter
- `attachedContainers` carries endpoint **names** only — never endpoint IDs, MACs, or IPs (FR-004)
