# Feature Specification: Docker Swarm inventory (Docker importer Wave E)

**Feature Branch**: `048-docker-swarm-inventory`  
**Created**: 2026-11-01  
**Status**: Draft  
**Input**: Docker importer program Wave E — auto-discover Swarm endpoints and inventory services, nodes, and secret references through the same agent-bound importer (`researches/docker-importer-spec-waves.md`, `researches/docker-importer-implementation-tracking.md` Phase 5).

## Clarifications

### Session 2026-11-01

Resolved from the wave plan and prior waves' decisions (no open markers):

- Swarm **services** are modeled as `CONTAINER_ORCHESTRATION` Components — distinct from Compose-derived `CONTAINER` Components because the categories differ; no automatic Product-edge transfer between them.
- Swarm **secrets** are metadata-only `SECRET` Components with no Instances — contents are never read or imported.
- Swarm **configs** remain references on service details; no `CONFIG` Component and no content import.
- No per-task health inference — Task objects lack health-check status and worker-container inspect is node-local; manager-reported service counts and task states are the only health signal.
- Engine-level container inventory (Waves C/D) continues unchanged on Swarm endpoints — services/nodes/secrets are additive surfaces, not a replacement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Swarm service inventory appears in the catalog (Priority: P1)

An operator points an agent-bound Docker importer config at a Swarm manager and, on the next run, sees each logical Swarm service as a catalog Component (`CONTAINER_ORCHESTRATION`) with one aggregate Component Instance carrying the manager-reported replica state. Services from different stacks (namespaces) stay distinct; a service whose name moves stacks reconciles correctly rather than silently transferring product edges.

**Why this priority**: This is the headline value of the wave — Swarm workloads are invisible in the catalog today; only their worker containers (Wave C/D) appear, which shows engines but not the services an operator actually manages.

**Independent Test**: run the importer against a single-manager Swarm → the catalog gains one `CONTAINER_ORCHESTRATION` Component per service with an aggregate Instance showing desired-vs-running replica state; a stack-scoped rename produces a new Component rather than hijacking the old one.

**Acceptance Scenarios**:

1. **Given** an agent-bound Docker importer config targeting a Swarm manager, **When** a run completes, **Then** each Swarm service appears as a `CONTAINER_ORCHESTRATION` Component with exactly one aggregate Instance.
2. **Given** a Swarm service, **When** its Component is opened, **Then** the Instance shows the manager-reported replica state (desired count, running count) and the service's stable identity.
3. **Given** two services with the same name in different stacks, **When** imported, **Then** they appear as distinct Components — stack namespace is part of service identity.
4. **Given** a service present in a prior run but absent from the next complete run, **When** reconciliation runs, **Then** its Instance becomes `GONE` for that Source only (source-scoped reconciliation preserved).
5. **Given** an endpoint that reports Swarm inactive or is not a manager, **When** the importer runs, **Then** Swarm surfaces are skipped entirely — the run completes with only Engine-level results.
6. **Given** a Swarm endpoint whose Engine API predates the required service-listing capability, **When** an inventory is attempted, **Then** the run fails visibly rather than emitting a silently incomplete Swarm inventory.

### User Story 2 - Aggregate service status reflects manager-reported replica state (Priority: P1)

An operator sees service health derived from what the Swarm manager reports — not inferred per-task. A fully-replicated service reads running; a partially-replicated or zero-of-N service reads failed; a scaled-to-zero service reads stopped; and the aggregate Instance records the counts that produced the status, so "why is this failing?" is answerable from the catalog alone.

**Why this priority**: Parity with Wave D — status without provenance is unanswerable. Swarm adds no per-task health data, so the manager's aggregate counts are the only honest signal.

**Independent Test**: scale a service to 3 replicas → status is `RUNNING` with `3/3` recorded; kill one task → next run shows `ERROR` with `2/3` recorded; scale to 0 → `STOPPED`.

**Acceptance Scenarios**:

1. **Given** a service whose running replicas equal its desired count, **When** imported, **Then** its aggregate Instance status is `RUNNING` and the observation records `running/desired` counts.
2. **Given** a service with fewer running than desired replicas, **When** imported, **Then** its status is `ERROR` — partial replication is a degraded service, never silently `RUNNING`.
3. **Given** a service with zero running replicas and a desired count of zero, **When** imported, **Then** its status is `STOPPED` — intentional scale-down is not a failure.
4. **Given** a service with zero running replicas but desired > 0, **When** imported, **Then** its status is `ERROR`.
5. **Given** the recorded observation, **When** an operator inspects it, **Then** only allowlisted manager-reported facts appear (service mode, desired/running counts, update state, timestamp) — never task lists, task inspect JSON, logs, or event streams.
6. **Given** a human-declared `DEPENDS_ON` edge from a Product to a service Component, **When** the service degrades, **Then** the existing derived rollup reflects it (ADR-112 — no rollup changes).

### User Story 3 - Swarm nodes appear as COMPUTE components (Priority: P2)

An operator sees the Swarm's worker/manager nodes as `COMPUTE` Components, source-scoped to the reporting manager, with node availability (active/pause/drain) and reachability state recorded — so the infrastructure a service runs on is visible alongside the service.

**Why this priority**: Service inventory without its substrate is half the picture; nodes are cheap to include from the same manager call and follow the same observation pattern.

**Independent Test**: import a Swarm → one `COMPUTE` Component per node with its availability/reachability recorded; drain a node → next run shows it.

**Acceptance Scenarios**:

1. **Given** a Swarm manager endpoint, **When** a run completes, **Then** each node appears as a `COMPUTE` Component scoped to the Docker source.
2. **Given** a node Component, **When** inspected, **Then** its recorded facts include availability (`active`/`pause`/`drain`), manager role, and manager-reported reachability — bounded to the allowlist.
3. **Given** a node removed from the Swarm, **When** the next complete run runs, **Then** its Component/Instance is reconciled `GONE` for that Source only.

### User Story 4 - Swarm secrets and configs as references, never contents (Priority: P2)

An operator sees which Swarm secrets exist (metadata-only `SECRET` Components — name and rotation/revision, never contents) and which configs a service references on the service's details — without any secret or config content ever being imported.

**Why this priority**: Completes the Swarm picture while honoring the catalog's minimization posture — secret *existence* is inventory; secret *contents* are never catalog data.

**Independent Test**: create a Swarm secret and a service referencing it plus a config → the secret appears as a `SECRET` Component with no Instances; the service's details list the config reference; neither contains content bytes.

**Acceptance Scenarios**:

1. **Given** a Swarm secret, **When** imported, **Then** a metadata-only `SECRET` Component exists carrying name/identity and bounded metadata — with no Instances and no content.
2. **Given** a service that references secrets or configs, **When** its details are viewed, **Then** the references are visible as bounded identifiers — never embedded content.
3. **Given** any secret/config value bytes in the external system, **When** audited across stored rows, API payloads, and logs, **Then** zero content appears.

### User Story 5 - Operator documentation stays accurate (Priority: P3)

`docs/importers/docker.md` documents the Swarm surfaces: what triggers Swarm discovery, what each entity type imports, the replica-count status rules, and what is collected vs. excluded.

**Why this priority**: AGENTS.md makes an importer change without a guide update incomplete — but it delivers no runtime behavior, so P3.

**Independent Test**: read the guide → every documented field and rule matches implementation.

**Acceptance Scenarios**:

1. **Given** the shipped guide, **When** an operator reads the Swarm sections, **Then** discovery triggers, entity models, status rules, and the collected-vs-excluded boundary match the implementation.

### Edge Cases

- Endpoint is a **worker-only** node (`ControlAvailable` false) → Swarm surfaces skipped; no partial inventory emitted.
- Engine API below the service-listing capability floor → fail the run visibly (fail-before-network pattern) rather than emit an authoritative-but-incomplete inventory.
- Service in `update`/`rollback` transition → recorded in the observation; status still derives from replica counts.
- Global-mode services (one task per node, no replica count) → status derives from manager-reported desired-vs-actual coverage, same ERROR/RUNNING rule.
- Service name without a stack prefix → namespace defaults correctly; identity stays stable across runs.
- Node with `drain` availability → recorded as an observation fact; node status mapping is explicitly ratified (not invented at implementation time).
- A Swarm service and a Compose service sharing a name → distinct Components (different categories); no edge transfer.
- Secret rotation (new version) → same Component, updated revision metadata — never a new Component per rotation.
- Swarm surfaces on a non-Swarm endpoint → zero additional API calls beyond discovery.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Docker importer MUST auto-discover Swarm on agent-bound endpoints: when `/info` reports Swarm active AND the endpoint is a manager, it MUST negotiate the required Engine API capability and emit a complete Swarm inventory; otherwise it MUST emit no Swarm assets at all.
- **FR-002**: Each Swarm service MUST map to one `CONTAINER_ORCHESTRATION` Component with one aggregate Component Instance per environment (using the existing `envLabel`/`envMap` assignment mechanism, defaulting to `OTHER`); service identity MUST include stack namespace + service identity so same-named services in different stacks stay distinct.
- **FR-003**: Aggregate Instance status MUST derive from manager-reported desired-vs-running replica counts: full replication → `RUNNING`, partial replication or zero-running-desired-positive → `ERROR`, desired-zero → `STOPPED`, absent on a completed run → `GONE`. Per-task health MUST NOT be inferred.
- **FR-004**: Each aggregate Instance MUST persist an allowlisted observation of manager-reported service facts (mode, desired/running counts, update state, observed-at) — never task lists, task inspect output, service logs, or event streams.
- **FR-005**: Each Swarm node MUST map to a source-scoped `COMPUTE` Component with one status-bearing Component Instance (the AWS `COMPUTE` precedent); the availability/reachability→`InstanceStatus` table MUST be ratified with the service table at plan — not invented at implementation time — and recorded facts are bounded to an allowlist (availability, role, reachability).
- **FR-006**: Each Swarm secret MUST map to a metadata-only `SECRET` Component (identity + bounded metadata such as name/rotation) with no Instances; secret contents MUST never be read, persisted, or logged.
- **FR-007**: Service-referenced secrets and configs MUST appear only as bounded references on service details; no config content is imported and no `CONFIG` Components are created.
- **FR-008**: Compose-to-Swarm transitions MUST produce distinct Components (different categories); no automatic Product edge transfer is performed.
- **FR-009**: `docs/importers/docker.md` MUST document Swarm discovery triggers, entity models, status rules, and the collected-vs-excluded boundary.
- **FR-010**: Any contract surface beyond what ADR-035/036/037/047/056/065/112/116/117/119/120/121 and amendments already ratify — the Swarm entity mappings, status table, observation allowlist, and API version floor — MUST be ratified in the same change per the ADR fidelity rule; `docs/openapi.yaml` stays in sync wherever contract surfaces change.

### Key Entities

- **Swarm Service** — logical orchestrated workload; becomes a `CONTAINER_ORCHESTRATION` Component + one aggregate Component Instance carrying replica-derived status and an allowlisted observation.
- **Swarm Node** — manager-reported cluster member; becomes a source-scoped `COMPUTE` Component with bounded availability/role facts.
- **Swarm Secret** — exists-only inventory; becomes a metadata-only `SECRET` Component, no Instances, no content.
- **Swarm Config reference** — bounded identifier on a service's details; never a Component, never content.
- **Component Instance `rawConfig`** — carries the allowlisted observation for service/node surfaces (same seam as `dockerObservation`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of enumerated replica states (full, partial, zero-of-N, scaled-to-zero, absent-on-next-run) produce the specified `InstanceStatus` — verified by tests exercising every row of the status table.
- **SC-002**: A run against a Swarm manager emits one Component per service + per node + per secret; a run against a non-Swarm endpoint emits zero Swarm-derived assets — verified end-to-end.
- **SC-003**: Zero task inspect JSON, task lists, logs, event streams, secret contents, or config contents appear in stored rows, API payloads, or logs — verified by a data-minimization audit.
- **SC-004**: A service's replica degradation degrades a human-wired Product's derived health through the existing rollup — verified end-to-end.
- **SC-005**: Lint, typecheck, tests, and build green across all changed packages; importer unit tests exercise `validateDiscoveredAsset`.

## Assumptions

- Swarm discovery and API negotiation happen agent-side per the existing `resolveTarget`/agent-bound pattern (ADR-121) — no new credential or transport surfaces.
- The required Engine API version floor and the exact status-table ratification land in the plan/ADR per prior waves' precedent.
- Component category constants `CONTAINER_ORCHESTRATION`, `COMPUTE`, and `SECRET` already exist in core — no new category values.
- Swarm surfaces reuse `rawConfig` for observations (same seam as `dockerObservation`) and the existing source-scoped reconciliation — no schema changes beyond allowlist contents.
- The operator-facing surface is the existing catalog (component list/detail + instances table + observation render from Wave D) — no new UI is required beyond what Wave D built.
- Worker-container instances (Waves C/D) continue importing alongside the new Swarm surfaces on Swarm endpoints.
