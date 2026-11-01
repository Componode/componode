# Tasks: Docker Swarm inventory (Wave E)

**Input**: Design documents from `specs/048-docker-swarm-inventory/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/swarm-inventory.md

**Organization**: Tasks grouped by user story (US1/US2 = P1 service inventory + status, US3 = nodes, US4 = secrets/config refs, US5 = docs). Test-first per constitution VI.

## Phase 1: Setup

- [x] T001 Extend the `dockerode` mock in `packages/importer-docker/test/importer.test.ts` with `listServices`/`listNodes`/`listSecrets` and confirm the baseline suite is green

## Phase 2: Foundational — discovery gate + swarm module

- [x] T002 Write failing tests for the discovery gate in `packages/importer-docker/test/swarm.test.ts` — `info.Swarm` inactive or `ControlAvailable` false → zero `listServices`/`listNodes`/`listSecrets` calls; below `ApiVersion` 1.41 → run fails
- [x] T003 Create `packages/importer-docker/src/swarm.ts` with local allowlist interfaces (`SwarmService`, `SwarmNode`, `SwarmSecret`) per `contracts/swarm-inventory.md`
- [x] T004 Wire the gate + version floor into `packages/importer-docker/src/importer.ts` after `reportSourceIdentity` — extend the `docker.info()` cast with `Swarm.{LocalNodeState,ControlAvailable}`; fetch `docker.version()` only when Swarm detected

## Phase 3: US1+US2 — Swarm services (FR-002/003/004/007/008)

- [x] T005 [US1] Write failing service-mapping tests in `packages/importer-docker/test/swarm.test.ts` — component shape (`CONTAINER_ORCHESTRATION`/`swarm-service`, name/stack-prefixed externalId, details incl. `secretRefs`/`configRefs`), instance externalId by `ID`, every replica-status row per `contracts/swarm-inventory.md`, `swarmObservation` allowlist incl. `"none"`-equivalent absence
- [x] T006 [US1] Implement `mapSwarmService` + replica status in `packages/importer-docker/src/swarm.ts` — emits `swarmObservation` only, `validateDiscoveredAsset` exercised
- [x] T007 [US1] Emit service assets from `importer.ts` behind the gate (`listServices({status:true})`), abort-aware, alongside existing container inventory
- [x] T008 [US2] Add backend integration coverage in `packages/backend/test/integration/docker-import.test.ts` — service component+instance persist, partial-replica `ERROR` degrades a wired product's ADR-112 rollup, absent-on-next-run → `GONE` (source-scoped)

## Phase 4: US3 — Swarm nodes (FR-005)

- [x] T009 [US3] Write failing node-mapping tests in `packages/importer-docker/test/swarm.test.ts` — every node-status row per contract, `swarmNodeObservation` allowlist
- [x] T010 [US3] Implement `mapSwarmNode` in `packages/importer-docker/src/swarm.ts` (`COMPUTE`/`swarm-node` component + status-bearing instance)
- [x] T011 [US3] Emit node assets from `importer.ts` (`listNodes()`) behind the same gate

## Phase 5: US4 — Secrets + references (FR-006/007)

- [x] T012 [US4] Write failing secret-mapping tests in `packages/importer-docker/test/swarm.test.ts` — metadata-only `SECRET` component, `instances: []`, bounded `details.revision`, rotation → same component
- [x] T013 [US4] Implement `mapSwarmSecret` in `packages/importer-docker/src/swarm.ts` and emit from `importer.ts` (`listSecrets()`)

## Phase 6: Docs + polish (FR-009/010, SC checks)

- [x] T014 [US5] Update `docs/importers/docker.md` — Swarm discovery gate, entity models, status tables, collected-vs-excluded boundary
- [x] T015 Confirm `researches/adrs/ADR-121-docker-importer.md` Amendment 2 + `researches/architecture-decisions.md` index match shipped code; update `researches/docker-importer-implementation-tracking.md` Phase 5 and `docs/roadmap.md` (Shipped + Next)
- [x] T016 Verification per SC-005: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in `packages/importer-docker` + `packages/backend` touched tests; minimization audit — zero task lists/logs/contents in emitted assets

## Dependencies

- T002–T004 (gate) block all story phases; T005–T008 ↔ T009–T011 ↔ T012–T013 are file-parallel inside `swarm.ts`/`swarm.test.ts`
- US3/US4 independent of US1/US2 — can ship in any order after T004

## MVP scope

US1+US2 (T001–T008) — Swarm services with replica-derived status.

## Phase 7: Review

- [x] T017 Require `Availability === "active"` for node RUNNING so missing/unknown availability fails closed to ERROR per contracts/swarm-inventory.md (code-review: standards)
- [x] T018 Derive service `desired` from `ServiceStatus.DesiredTasks` (manager counts) with Spec.Replicas as fallback only per contracts/swarm-inventory.md (code-review: standards)
- [x] T019 Rename the `secrets` destructure to `swarmSecrets` and fail the API floor closed on unparseable `ApiVersion` (code-review: standards)
- [x] T020 Remove the unread `Endpoint.Ports` declaration from `SwarmService` and `publishedPorts` from data-model.md (code-review: spec)
- [x] T021 Expand docker.md's observation summaries to list the complete shipped allowlists per FR-009 (code-review: spec)
