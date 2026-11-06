# Feature Specification: Docker importer enrichment

**Feature Branch**: `064-docker-importer-enrichment`
**Created**: 2026-11-06
**Status**: Draft
**Input**: Operators cannot see deployed image provenance, engine versions, resource limits, or Swarm published ports — facts the Docker Engine API already returns and the importer discards. Design grilled and ratified in `researches/docker-importer-enrichment-pack.md` (Wave F of the Docker importer program): bounded observation enrichment, one engine component per source, opt-in image inspect, and bounded UI surfacing — zero new endpoints, zero new config keys, no API/contract changes. Governing docs: ADR-121 (data-minimization allowlist), ADR-122 (dual Hub/Agent executor parity).

## Clarifications

### Session 2026-11-06

All decisions resolved in the prior grilling session recorded in `researches/docker-importer-enrichment-pack.md` — no open markers:

- Scope is **facts the API already returns**, not metrics collection or security scanning. Everything lands as bounded `rawConfig`/`details` additions inside the existing ADR-121 allowlist philosophy: no `Env`, no host paths, no health output, no test commands, no stats/events/logs.
- **Zero new endpoints, zero new config keys, zero API/contract changes.** Image inspect rides the existing `includeImages` flag; enrichment reuses calls the importer already makes.
- `dockerObservation` stays pure state/health status — the new config facts do not mix into it.
- The engine component is **always emitted** on every transport and both executors (Hub and Agent), carrying facts from `/info` + `/version` calls already made.
- Image inspect is deduplicated by unique image ID across all emitted image assets; `includeImages=false` means zero extra calls and unchanged behavior.
- Job-type Swarm services stay `CONTAINER_ORCHESTRATION` — mode is reported as an observation, no `JOB` components.
- UI surfacing uses explicit named sections per resource type — **no generic rawConfig dump**.
- `/networks`, `/volumes`, `/configs`, all external APIs, and new config keys are explicitly out of scope (spec 065 owns network/volume inventory).
- Implementation amends ADR-121 (Amendment 3) and updates `docs/importers/docker.md` in the same change.

- Q: Where do the engine component's facts live — instance `rawConfig`, component `details`, or split? → A: **Component `details`** — the bounded fact set (`serverVersion`, `apiVersion`, `os`, `arch`, `kernelVersion`, `cgroupDriver`, `runtimes`, `registryMirrors`, Swarm manager state) is component-level data; the single `RUNNING` instance carries state only, consistent with how `details` holds classification facts while `rawConfig` holds per-instance observations.
- Q: What happens when a per-image inspect call fails for one image while others succeed? → A: **Degrade per image** — the failed image's asset still emits without inspect details; the run and all other images are unaffected. Inspect enrichment is additive metadata, not authoritative enumeration, so it does not trigger the fail-closed rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what each container actually runs and how it is configured (Priority: P1)

An operator browsing a container Component Instance can see the deployed image's immutable ID, the resource limits and restart policy the container was created with, its health-check timing definition, and posture flags — without opening Docker or reading raw inspect JSON.

**Why this priority**: This is the core enrichment value — capacity, provenance, and posture facts the engine already reports but the catalog discards today. Every other story extends the same "surface what the API returns" theme.

**Independent Test**: run a Docker import against an engine with containers carrying limits, restart policies, and health checks; verify each emitted container instance carries the bounded observation fields, and verify excluded data (env vars, health test commands, host paths) never appears.

**Acceptance Scenarios**:

1. **Given** a container with a health check and resource limits, **When** an import run completes, **Then** its instance carries the image ID, bounded host-config facts (memory, CPUs, pids, restart policy, posture flags, log driver), and health-check timing in seconds — and never the check's test command.
2. **Given** a container with no health check or no limits, **When** an import run completes, **Then** the corresponding fields are simply absent rather than zeroed or errored.
3. **Given** the enriched observations, **When** an operator views the instance, **Then** the new facts render in named sections while the existing state/health observation rendering is unchanged.
4. **Given** any emitted asset, **When** the run completes, **Then** no env vars, bind-mount host paths, health output, stats, events, or logs appear in any new field.

---

### User Story 2 - Understand Swarm service exposure and placement (Priority: P1)

An operator viewing a Swarm service instance sees which ports the service publishes (published/target/protocol), which overlay networks it attaches to, and whether the service is a replicated or global job — using the same per-environment instance model as today.

**Why this priority**: Swarm services are the orchestrated counterpart of containers; without ports and networks the catalog cannot answer "what does this service expose and where does it live." Job-mode detection prevents misreading one-shot services as long-running ones.

**Independent Test**: run a Docker import against a Swarm manager hosting published-port services and a job service; verify instances carry ports/networks observations and the job service reports its mode while remaining a `CONTAINER_ORCHESTRATION` component.

**Acceptance Scenarios**:

1. **Given** a Swarm service with published ports, **When** an import run completes, **Then** its instance carries published/target/protocol port entries in the same shape container port observations use.
2. **Given** a Swarm service attached to named networks, **When** an import run completes, **Then** its instance lists those network targets (names or IDs as reported by the service spec).
3. **Given** a Swarm job service (replicated-job or global-job), **When** an import run completes, **Then** its observation reports the job mode and the component remains `CONTAINER_ORCHESTRATION` — no job-specific component type is introduced.
4. **Given** a non-Swarm engine, **When** an import run completes, **Then** no Swarm-only fields appear and behavior is identical to today apart from the new shared observations.

---

### User Story 3 - See the Docker engine itself as a cataloged component (Priority: P2)

Every imported Docker source produces one engine component — regardless of transport (socket, mTLS TCP, SSH, named context) or executor (Hub or agent) — carrying the daemon's version, platform, runtime, and Swarm-manager facts in a single always-present component.

**Why this priority**: The engine is the root of every inventory it produces; cataloging it gives operators a single place for version/platform truth and a stable anchor for the source. It is always emitted because `/info` and `/version` are already fetched — the cost is zero.

**Independent Test**: complete an import on each transport and on both executors; verify exactly one engine component per source with a RUNNING instance and the bounded engine facts, and verify excluded `/info` fields (host paths, proxy variables, plugins, warnings) never appear.

**Acceptance Scenarios**:

1. **Given** any successful Docker import, **When** the run completes, **Then** exactly one engine component exists for that source — one `RUNNING` instance for state, with server/API versions, OS, architecture, kernel, cgroup driver, runtimes, registry mirrors, and Swarm manager state (when applicable) carried in the component's details.
2. **Given** the engine component, **When** its identity is inspected, **Then** it reuses the source identity (`docker-engine:{id}` form) without double-prefixing, and it is distinguishable from Swarm node components.
3. **Given** an engine reporting proxy variables, plugins, warnings, or a host root dir, **When** the run completes, **Then** none of those values appear in the emitted facts.
4. **Given** a Swarm manager vs. a worker-only or non-Swarm engine, **When** the run completes, **Then** Swarm manager fields are present only when the engine reports them.

---

### User Story 4 - Trace deployed images back to their upstream provenance (Priority: P2)

When image inventory is enabled, each image asset additionally carries bounded provenance from the image's own inspect data — OCI labels from a fixed allowlist, exposed ports, user, entrypoint, working directory, declared volumes, and architecture/OS — inspect calls are made once per unique image, and container instances' image IDs can be joined to these assets.

**Why this priority**: Image provenance (upstream source, revision, version, vendor, licenses) is the highest-value enrichment for supply-chain questions, but it is opt-in because it costs one inspect call per unique image. It builds directly on the P1 image-ID join.

**Independent Test**: enable `includeImages` and run an import over containers sharing images; verify each unique image is inspected once, details carry only allowlisted OCI labels plus the bounded inspect fields, and container instance image IDs correlate to the right image assets. Repeat with `includeImages` off and verify zero inspect calls and unchanged output.

**Acceptance Scenarios**:

1. **Given** `includeImages` enabled and multiple containers sharing one image, **When** an import run completes, **Then** the image's inspect data is fetched once and merged into the image asset's details.
2. **Given** an image carrying arbitrary OCI labels, **When** details are emitted, **Then** only the bounded allowlist of standard `org.opencontainers.image.*` keys survives — no unbounded namespace passthrough.
3. **Given** `includeImages` disabled, **When** an import run completes, **Then** no image inspect calls are made and image assets are byte-identical to today's behavior.
4. **Given** a container instance and an image asset from the same run, **When** their identifiers are compared, **Then** the instance's image ID joins to the asset's recorded image ID.

---

### User Story 5 - Read the enriched facts in the catalog UI (Priority: P3)

An operator viewing a component or instance sees the new facts rendered as deliberate, named sections — host config, health check, published ports, networks, image provenance, engine details — consistent with how existing Docker observations render today.

**Why this priority**: Data without surfacing is invisible; but the rendering is bounded by the existing allowlist pattern, so it follows the data work rather than preceding it.

**Independent Test**: render component detail pages for container, Swarm service, engine, and image components produced by an enriched run; verify each new fact group appears in its named section and no raw configuration dump is rendered.

**Acceptance Scenarios**:

1. **Given** an enriched container instance, **When** its detail renders, **Then** host-config and health-check facts appear in named sections alongside the existing observation block.
2. **Given** an enriched Swarm service instance, **When** its detail renders, **Then** published ports and network names appear in named sections.
3. **Given** engine and image components, **When** their details render, **Then** engine facts and allowlisted OCI labels appear in named sections.
4. **Given** any component, **When** its detail renders, **Then** no generic rawConfig/details dump is shown — only explicitly allowlisted fields render.

### Edge Cases

- Engine older than the fields' introduction → absent keys are omitted, never zeroed or errored; enrichment is best-effort per field.
- Container with `HostConfig` partially populated (e.g. logs driver only) → only reported fields appear.
- Health-check timings arrive in nanoseconds → converted to seconds; a check with no interval/timeout still emits whatever timings exist.
- Restart policy `no`/`unless-stopped`/`on-failure` with no max retries → `maxRetries` absent.
- Image inspect fails for one image while others succeed → that image's asset still emits without inspect details (ratified degrade-per-image; it does not fail the run).
- `includeImages` on but engine returns zero images → zero inspect calls.
- Two sources on the same engine (e.g. two targets) → each source gets its own engine component keyed by its own source identity.
- Agent-executed and Hub-executed runs against the same engine → identical enrichment (shared importer code; ADR-122 parity).
- Engine `/info` lacks Swarm fields on a non-manager → Swarm manager fields absent, component still emitted.
- Image with no OCI labels → `ociLabels` absent or empty; other inspect fields still merge.
- A `dockerObservation` consumer (instance status mapping, health rollup) → unaffected; config facts live outside `dockerObservation`.
- Component detail renders an instance whose `rawConfig` predates this feature → existing rendering unchanged; new sections simply absent.

## Requirements *(mandatory)*

### Functional Requirements

**Container instance observations**

- **FR-001**: Container instance `rawConfig` MUST include `imageId` — the immutable `sha256:` image ID from container inspect — enabling correlation with image assets.
- **FR-002**: Container instance `rawConfig` MUST include a bounded `hostConfig` object carrying, when reported: `memoryBytes`, `nanoCpus`, `pidsLimit`, `restartPolicy` (`mode`, optional `maxRetries`), `privileged`, `readOnlyRootfs`, and `logDriver`.
- **FR-003**: Container instance `rawConfig` MUST include a bounded `healthcheck` object carrying, when reported: `intervalSeconds`, `timeoutSeconds`, `retries`, `startPeriodSeconds` — converted from engine nanoseconds to seconds. The health check `Test` command MUST NOT be collected.
- **FR-004**: `dockerObservation` MUST remain limited to state and health status; none of the new config facts MAY be added to it.
- **FR-005**: No new field MAY carry environment variables, bind-mount host paths, health-check output or test commands, stats, events, logs, or any other data outside the ADR-121 minimization allowlist.

**Swarm service observations**

- **FR-006**: Swarm service instance `rawConfig` MUST include published ports as `published`/`target`/`protocol` entries, using the same shape as container port observations.
- **FR-007**: Swarm service instance `rawConfig` MUST include `networks` — the network targets (names or IDs as reported) the service spec attaches to.
- **FR-008**: `swarmObservation.mode` MUST report `replicated-job`/`global-job` for job-type services; job services MUST remain `CONTAINER_ORCHESTRATION` components with no new component category.

**Engine component**

- **FR-009**: Every successful Docker import MUST emit exactly one engine component per source — on every transport and both executors — as a `COMPUTE` component distinguishable from Swarm node components.
- **FR-010**: The engine component's `externalId` MUST be the source identity itself (`docker-engine:{id}` form) without double-prefixing.
- **FR-011**: The engine component MUST have one `RUNNING` instance for state, and its component `details` MUST carry the bounded facts `serverVersion`, `apiVersion`, `os`, `arch`, `kernelVersion`, and, when reported, `cgroupDriver`, `runtimes`, `registryMirrors`, `swarmNodeState`, `swarmControlAvailable`, `swarmManagers`.
- **FR-012**: Engine facts MUST NOT include `DockerRootDir`, proxy variables (`HTTP_PROXY`/`HTTPS_PROXY`/`FTP_PROXY`/`NO_PROXY` and lowercase variants), `Plugins`, `SecurityOptions` detail, or `Warnings`.
- **FR-013**: Engine facts MUST be sourced exclusively from `/info` and `/version` engine metadata — no additional inventory or per-resource calls beyond what the run already performs for Swarm gating and image listing.

**Image inspect**

- **FR-014**: When `includeImages` is enabled, the importer MUST inspect each unique image ID at most once across all emitted image assets and merge bounded details into each image asset: `ociLabels`, `exposedPorts`, and — when reported — `user`, `entrypoint`, `workingDir`, `volumes`, `architecture`, `os`. A failed inspect for one image MUST omit inspect details for that image only — it MUST NOT fail the run or affect other images.
- **FR-015**: `ociLabels` MUST be limited to a bounded allowlist of standard `org.opencontainers.image.*` keys (source, revision, version, vendor, licenses, description, title, url, documentation, source-label) — no unbounded namespace passthrough.
- **FR-016**: When `includeImages` is disabled, the importer MUST make zero image inspect calls and produce output identical to pre-feature behavior.
- **FR-017**: Image assets MUST record their image ID such that a container instance's `imageId` (FR-001) can be joined to the correct asset.

**UI surfacing**

- **FR-018**: Component/instance detail views MUST render the new container observations (`hostConfig`, `healthcheck`) and Swarm observations (published ports, networks, job mode) in named sections consistent with the existing Docker observation rendering.
- **FR-019**: Component detail views MUST render engine facts and image `ociLabels`/inspect details in named, allowlisted sections per resource type.
- **FR-020**: No UI surface MAY render a generic `rawConfig`/`details` dump; only explicitly allowlisted fields render.

**Boundaries**

- **FR-021**: This feature MUST NOT add endpoints, config keys, manifest fields, or API/contract changes; `docs/openapi.yaml` MUST remain unchanged.
- **FR-022**: All enrichment MUST live in shared importer code so Hub-executed and Agent-executed runs produce identical output (ADR-122 parity); no executor-specific behavior.
- **FR-023**: `docs/importers/docker.md` MUST be updated in the same change to document every newly collected field and its bounds.
- **FR-024**: The change MUST record ADR-121 Amendment 3 covering the new allowlisted fields.
- **FR-025**: Importer tests MUST exercise `validateDiscoveredAsset` for every newly emitted asset shape, and test-first development applies (failing test → implement → refactor).

### Key Entities *(include if feature involves data)*

- **Docker Engine Component** (new): one `COMPUTE` component per ImporterSource, `externalId` = source identity, one `RUNNING` instance for state, bounded `/info`+`/version` facts in component `details`.
- **Container ComponentInstance observations** (extended): `rawConfig` gains `imageId`, `hostConfig`, `healthcheck` — additive, bounded, outside `dockerObservation`.
- **Swarm service ComponentInstance observations** (extended): `rawConfig` gains published ports and network names; `swarmObservation.mode` gains job modes.
- **Image asset details** (extended, opt-in): `PACKAGE_REGISTRY` image components gain `imageId` correlation plus inspect-derived `ociLabels`, ports, user, entrypoint, volumes, arch/os when `includeImages` is on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any successful Docker import, 100% of emitted container instances carry every `hostConfig`/`healthcheck`/`imageId` fact the engine reported — fields absent only when the engine does not report them.
- **SC-002**: 100% of Docker imports — every transport, both executors, Swarm and non-Swarm — emit exactly one engine component per source.
- **SC-003**: With `includeImages` enabled, image inspect calls equal the count of unique image IDs (zero duplicates); with it disabled, inspect calls equal zero.
- **SC-004**: Zero occurrences of excluded data (env vars, host paths, proxy variables, health test commands/output, plugins, warnings, unbounded OCI labels) in emitted assets — verified by tests.
- **SC-005**: Every new fact group renders in a named UI section for its resource type, and no generic rawConfig/details dump exists anywhere in the catalog UI.
- **SC-006**: Lint, typecheck, tests, and build pass for all changed packages; `docs/importers/docker.md` documents every new field; ADR-121 Amendment 3 and `docs/openapi.yaml` drift checks pass (openapi unchanged).
- **SC-007**: Hub-executed and Agent-executed runs against the same engine produce identical enriched output.

## Assumptions

- The exact bounded `ociLabels` allowlist keys, `hostConfig` unit conversions (e.g. `NanoCpus` → `nanoCpus`), engine-component display naming, and per-field optionality are plan-level details bounded by the requirements above.
- Engine API versions predating a field simply omit it; no minimum-version gate is added for enrichment (the existing v1.41 Swarm floor is unchanged).
- `includeImages` remains the sole opt-in for image inspect; no new flag is introduced.
- Every run makes exactly one `/version` call for engine facts — non-Swarm engines gain this single call (previously `/version` was Swarm-gate-only); the Swarm API-floor gate reuses it. A `/version` failure fails the run like any other engine-metadata failure — no degrade path is added.
- Spec 065 (`NETWORK`/`STORAGE` inventory from `/networks` + `/volumes`) is explicitly out of scope and sequenced after this feature.
- Existing consumers of `dockerObservation`, instance status mapping, and the ADR-112 health rollup are unaffected because enrichment never touches `dockerObservation`.
- The engine component's visual distinction from Swarm node components (naming/labeling convention) is a plan-level detail.
