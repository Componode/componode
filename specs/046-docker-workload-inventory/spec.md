# Feature Specification: Docker Workload Inventory — `@componode/importer-docker` for Docker Engine workloads via Import Agents

**Feature Branch**: `046-docker-workload-inventory`

**Created**: 2026-11-01

**Status**: Draft

**Input**: Phase 3 / Wave C of the Docker importer program (`researches/docker-importer-implementation-tracking.md`, `researches/docker-importer-spec-waves.md`): a new `@componode/importer-docker` package registered in lockstep across core, backend, and agent; agent-only execution against allowlisted target profiles resolved from a versioned, read-only `${SECRETS_DIR}/docker-targets.json` registry; a `targetId` in the importer scope declared by a manifest target-reference key and resolved through `context.resolveTarget()`; four secure transports (local socket/named pipe, verified mutual-TLS TCP, pinned-host-key SSH, allowlisted named Docker Context); discovery of running and stopped containers with opt-in local image inventory; one `CONTAINER` Component per logical containerized workload with one Component Instance per concrete container; redacted bind mounts, safe network/volume references, image reference/digest, and allowlisted source observations; and a user guide at `docs/importers/docker.md`.

## Clarifications

### Session 2026-11-01

- Q: When the opt-in local image inventory is enabled, what Componode entity should cached Docker images become? → A: `PACKAGE_REGISTRY` Components (metadata-only; deployed image ref/digest still lands on workload Instances either way).
- Q: How should Wave C map a running container with an unhealthy Docker health check to `ComponentInstance.status`? → A: Engine-state only in Wave C (`running`→`RUNNING` regardless of health result); health-aware mapping ships with `dockerObservation` in Wave D.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import Docker workloads through an assigned Import Agent (Priority: P1)

An operator provisions an Import Agent inside the network where their Docker daemons live, writes a target profile into the Agent's read-only `docker-targets.json` registry, and creates a Docker importer config bound to that Agent with the profile's `targetId`. The Agent validates the target reference before any network access, connects to the daemon through the profile's transport, and imports the inventory: each logical containerized workload becomes a catalog Component of the container kind, and each concrete container becomes a Component Instance carrying its deployed image reference/digest and safe port/network/volume references.

**Why this priority**: This is the entire point of the feature — nothing else delivers value until a Docker daemon's workloads appear in the catalog. It is the thinnest end-to-end slice (one transport is enough to demonstrate it).

**Independent Test**: provision an Agent with one socket or TLS target profile, create an Agent-bound Docker config naming its `targetId`, run an import → Components and Instances appear in the catalog, attributed to a Source.

**Acceptance Scenarios**:

1. **Given** an Agent provisioned with a valid target profile and a Docker importer config bound to that Agent referencing the profile's `targetId`, **When** an import run executes, **Then** each logical workload appears as one catalog Component and each concrete container appears as a Component Instance with image reference/digest and safe references.
2. **Given** a config whose `targetId` is absent from the Agent's registry, **When** the run is dispatched, **Then** the job is rejected before any network access with a non-secret reason, and the Agent stays ready for other importers.
3. **Given** a malformed or disallowed target profile (e.g. plaintext transport, skip-verify flag), **When** preflight runs, **Then** the job fails before network access — no connection is attempted.
4. **Given** a Docker config that is not bound to an Agent, **When** it is saved or run, **Then** it is rejected — direct hub execution is unsupported.

### User Story 2 - Logical workload identity survives rebuilds, renames, and environments (Priority: P1)

The same Compose service (`commerce/web`) deployed in DEV and PRODUCTION through two different Docker targets produces **one** shared catalog Component, with a separate Component Instance per target. Rebuilding a container produces a new Instance under the same logical Component while the old Instance is retired — Product edges a person wired to the Component are untouched. An operator can pin a stable workload ID (`componode.component-id` label or configured mapping) so a project/service rename keeps the same Component; without an override, a rename legitimately produces a new Component.

**Why this priority**: Wrong identity semantics corrupt the catalog — false merges collapse distinct workloads, false splits orphan curated Product edges. Equal priority with US1: shipping import without stable identity is worse than not shipping.

**Independent Test**: run two targets each hosting `commerce/web` → one Component with two Instances; rebuild the DEV container → new DEV Instance, PROD Instance untouched, Product edge intact; rename the service with a stable ID label → same Component; rename without it → new Component.

**Acceptance Scenarios**:

1. **Given** the same logical Compose workload reported by two distinct Docker targets, **When** both imports complete, **Then** one shared Component exists with per-target Instances, and a run on one target never marks the other's Instances GONE.
2. **Given** a container that is rebuilt and receives a new container ID, **When** the next complete import runs, **Then** a new Instance appears under the same logical Component and the previous Instance is retired for that Source only.
3. **Given** a workload carrying a stable workload-ID label/mapping whose project or service name changes, **When** the next import runs, **Then** the same Component identity is preserved.
4. **Given** a workload renamed without a stable ID override, **When** the next import runs, **Then** a distinct Component is created and no Product edge transfers automatically.
5. **Given** a standalone container with no Compose labels and no stable ID, **When** it is imported, **Then** its Component identity falls back to the target/daemon-scoped container name — never the mutable container ID.

### User Story 3 - Four secure transports with Agent-side target profiles (Priority: P1)

An administrator chooses per Docker daemon how the Agent reaches it, and every route is expressed as an immutable Agent-local target profile: local socket/named pipe (explicitly mounted/provisioned on the Agent), verified mutual-TLS TCP (client certificate and key required; private-CA certificate optional when Agent/system trust suffices; never plaintext or skip-verify), pinned-host-key SSH (explicit host/user/port, private key with optional passphrase, SHA-256 host-key pin; never password-only or implicit OpenSSH config), or a named, allowlisted, on-disk Docker Context (never the in-memory `default` Context, never `SkipTLSVerify`). Secret key material resolves on the Agent through agent-managed credential bundles or the Agent-local Context store — it never transits to the hub.

**Why this priority**: Docker Engine access is high trust; the transports are the security boundary of the whole feature. P1 because a deployment that cannot connect securely cannot use the importer at all, and a permissive transport is worse than none.

**Independent Test**: for each transport, provision a profile and run an import → inventory succeeds; for each insecure variant (plaintext TCP, skip-verify, password-only SSH, `default` Context), preflight rejects the job before network access.

**Acceptance Scenarios**:

1. **Given** each supported transport profile (socket/named pipe, mutual-TLS TCP, pinned SSH, named Context), **When** a run executes, **Then** the Agent connects through that transport and imports inventory.
2. **Given** a TCP profile missing client certificate/key or requesting skip-verify, **When** preflight runs, **Then** the job fails before network access with a non-secret reason.
3. **Given** an SSH profile without a host-key pin or relying on password auth/implicit config, **When** preflight runs, **Then** the job fails before network access.
4. **Given** a Context profile naming the in-memory `default` Context or one configured with `SkipTLSVerify`, **When** preflight runs, **Then** the job fails before network access.
5. **Given** a credential check against any configured transport, **When** the test runs, **Then** it performs a minimal read probe and returns an actionable, non-secret error — it never runs a full inventory.

### User Story 4 - Source attribution and lifecycle follow the ImporterSource contract (Priority: P2)

Every Docker run reports the Docker Engine's native identity before yielding a single asset — including an empty inventory — so the run and its memberships are attributed to the durable `ImporterSource` for that daemon. Deleting the importer config stops collection but leaves the Source unmonitored with its memberships and run history intact; pointing a new config (or a rotated target profile) at the same engine reattaches to the same Source rather than forking a new one; and a partial/failed inventory never retires previously imported records.

**Why this priority**: Correct provenance is what makes multi-target inventory safe; it is P2 only because US1–US3 must exist to reach it — but the wave is not done without it.

**Independent Test**: run a target → Source registered; run an empty-inventory target → Source still registered; delete the config → Source survives unmonitored with run history; create a new profile for the same engine → reattaches to the same Source; force an incomplete run → prior records untouched.

**Acceptance Scenarios**:

1. **Given** a Docker run that reaches the daemon, **When** the engine identity is learned, **Then** it is reported before the first asset and the run/memberships attribute to the matching `ImporterSource`.
2. **Given** a reachable daemon hosting zero containers, **When** the run completes, **Then** the Source is still registered and the run attributed.
3. **Given** an importer config that is deleted, **When** state is inspected, **Then** its Source remains with its memberships and run history, marked unmonitored rather than deleted.
4. **Given** a rotated target profile reaching the same verified engine identity, **When** a run completes, **Then** it reattaches to the same `ImporterSource` — transport changes never duplicate Sources or logical Components.
5. **Given** a run whose authoritative enumeration fails partway, **When** the run ends, **Then** it fails rather than posing as a complete empty inventory, and no prior Source data is retired.
6. **Given** a daemon whose identity cannot be determined and no admin-supplied key is configured, **When** the run starts, **Then** it fails as a contract violation rather than emitting unattributed assets.

### User Story 5 - Data minimization boundary (Priority: P2)

The catalog shows operators exactly what a workload needs — image reference/digest, published ports, network and volume names, a redacted bind-mount representation (mount type and container destination plus an opaque importer-local reference) — and nothing more: never container environment variables, raw host paths, full inspect JSON, health-check output or commands, or secret material, in stored data, logs, or error messages. Local cached-image inventory is opt-in and off by default because it is noise, not evidence of deployed workloads.

**Why this priority**: A Docker daemon surfaces secrets-adjacent data by default (env vars, bind paths, health output); the allowlist is the difference between a trustworthy catalog and a credential leak. P2 because it constrains rather than enables the US1 flow.

**Independent Test**: seed a container with env vars, a bind mount from a sensitive host path, and a health check → after import, none of the excluded data appears anywhere in the catalog; the redacted mount representation and image digest are present.

**Acceptance Scenarios**:

1. **Given** a container with environment variables and a host bind mount, **When** it is imported, **Then** no environment values or raw host path persist — only the mount type, destination, and opaque importer-local reference.
2. **Given** any imported workload, **When** its stored data and produced logs are inspected, **Then** no env vars, full inspect JSON, health output/commands, or secret material appear.
3. **Given** the default configuration, **When** an import runs, **Then** no local-image inventory is collected; **Given** the opt-in is enabled, **Then** cached images appear as metadata-only `PACKAGE_REGISTRY` Components.

### User Story 6 - Operator setup guide (Priority: P3)

An administrator can read `docs/importers/docker.md` and learn what the importer discovers, how to provision an Import Agent and its `docker-targets.json` registry (per transport, with credential placement), every config field the importer accepts, and the common failure modes and what they mean — linked from the importer docs index and the site sidebar like every other importer guide.

**Why this priority**: The wave contract explicitly requires the guide — the feature is incomplete without it — but it delivers no runtime behavior, so P3.

**Independent Test**: follow the guide end-to-end on a fresh Agent → a successful import results; every config field and transport is documented; the guide is reachable from the importers index and sidebar.

**Acceptance Scenarios**:

1. **Given** the shipped guide, **When** an operator follows it for each transport, **Then** every documented step matches the implemented behavior.
2. **Given** the docs site, **When** the importers index and sidebar are viewed, **Then** the Docker guide is linked like the other importer guides.

---

### Edge Cases

- `targetId` absent from the Agent registry → job rejected before network access; the registry file missing or corrupt is treated as an empty allowlist (fail closed) and the Agent stays up.
- Agent offline, at capacity, or lost mid-run → existing remote-run failure semantics apply (`AGENT_UNAVAILABLE`/`AGENT_LOST`); nothing Docker-specific is invented.
- Renamed target profile for the same engine → reattaches to the same `ImporterSource`; a `targetId` is an access route, never an identity.
- A Swarm manager target → Wave C imports its container inventory only; Swarm service/node/secret discovery is deferred to Wave E (no partial Swarm model is emitted).
- Health-check-bearing containers → Wave C maps engine state only (`running`→`RUNNING` regardless of health-check result); the persisted health-observation payload (`dockerObservation`) and health-aware status rules are Wave D scope — Wave C does not persist health output.
- Compose project/service values → metadata on the Component (details and per-Source membership details); tag suggestions in the edit flow are Wave D.
- Daemon with thousands of containers → inspect calls are concurrency-bounded; run duration is measured, not assumed.
- A config edit narrowing discovery so previously yielded assets disappear → that is an explicit reconciliation change; absent assets retire per the normal completed-run rules for that Source.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A new importer package MUST implement the standard importer contract — pull-only `AsyncGenerator<DiscoveredAsset>`, strict config validation, mode-aware credential testing, cancellation support, structured run phases, and `validateDiscoveredAsset`-exercising tests — and MUST be registered in lockstep in the core importer registry, the backend, and the agent per ADR-065 Amendment 1.
- **FR-002**: The importer's manifest MUST declare source-identity reporting and a target-reference key naming the config-scope key that carries a plain `targetId`; the Agent MUST validate the reference and resolve the typed target profile before invoking the importer.
- **FR-003**: Docker importer configs MUST be bound to an assigned Import Agent — configs without an Agent assignment MUST be rejected at save and dispatch time; direct hub execution is unsupported. The enforcement mechanism is decided at plan and ratified if it extends the contract surface.
- **FR-004**: Target profiles MUST resolve exclusively from a versioned, read-only registry file on the Agent (`${SECRETS_DIR}/docker-targets.json` per the `{importerName}-targets.json` convention, ADR-116 Amendment 6). The registry file is the complete allowlist: an unknown, malformed, or disallowed `targetId` MUST fail before network access with a non-secret reason, and a missing/corrupt registry MUST be treated as an empty allowlist. `targetId`s are immutable — changing endpoint, transport, or pinning means a new profile ID.
- **FR-005**: Four transports MUST be supported with fail-closed security: (a) local socket/named pipe via an explicit Agent-provisioned path; (b) mutual-TLS TCP that always verifies the daemon certificate and requires client cert+key, with `caCert` needed only for a private CA — no plaintext or skip-verify mode; (c) SSH with explicit host/user/port, private key, optional passphrase, and a SHA-256 host-key pin — no password-only auth, implicit OpenSSH config, or aliases; (d) named, allowlisted, on-disk Docker Contexts — rejecting the in-memory `default` Context and any `SkipTLSVerify` configuration.
- **FR-006**: Secret material for TCP/SSH transports MUST resolve on the Agent through agent-managed credential bundles; Context TLS bytes MUST stay in the Agent-local Context store. Credential testing MUST perform a minimal read probe appropriate to the mode and return actionable, non-secret errors — it MUST NOT run a full inventory.
- **FR-007**: The importer MUST report the provider-native Docker Engine identity before the first asset yield on every run — including empty inventories — per the ImporterSource contract; where the engine offers no trustworthy identity, an admin-supplied stable key is the fallback. Failure to determine identity MUST fail the run as a contract violation, and URL-like identity material MUST be canonicalized to strip userinfo, auth query parameters, and fragments.
- **FR-008**: One logical `CONTAINER` Component MUST be emitted per containerized workload: Compose workloads use a canonical project key + service key as their external identity (deliberately omitting daemon/target identity so environments share the Component); standalone containers use an explicit stable workload label or fall back to target/daemon-scoped container name — never the mutable container ID. A `componode.component-id` label or configured mapping MUST override the default key to preserve identity across renames.
- **FR-009**: One Component Instance MUST be emitted per concrete container, with external identity including source/daemon identity + container ID; a rebuild creates a new Instance under the same Component, and the prior Instance retires only through source-scoped reconciliation.
- **FR-010**: Discovery scope MUST cover running and stopped containers as the complete inventory boundary — no free-form label/status filters. Compose project/service values are metadata (shared Component details and per-Source membership details), never Componode entities or edges.
- **FR-011**: Instance environment MUST come from an explicitly configured label key/value mapping — container labels first, then Compose service labels when available; unmapped values default to `OTHER`; environment MUST never be inferred from daemon reachability.
- **FR-012**: Persisted data MUST be allowlisted: image reference/digest, safe port/network/volume references, a redacted bind-mount representation (mount type, container destination, and an opaque importer-local reference derived from instance identity + destination), and bounded useful labels. The system MUST NOT persist or log container environment variables, raw host paths, full inspect JSON, health-check output or test commands, or any secret material.
- **FR-013**: Container engine state MUST map to the existing `InstanceStatus` values — `running`→`RUNNING`, cleanly `exited`/`created`/`paused`→`STOPPED`, `dead`/`restarting`→`ERROR` — so imported Instances are status-correct. Health-check results MUST NOT influence Wave C status; the persisted `dockerObservation` payload and health-aware status rules are deferred to Wave D and MUST NOT be half-implemented here.
- **FR-014**: Local-image inventory MUST be opt-in and default off; when enabled, cached images MUST be emitted as metadata-only `PACKAGE_REGISTRY` Components (precedent: metadata-only components such as Swarm `SECRET`s); when off, the deployed image reference/digest still lands on the workload Instance.
- **FR-015**: Reconciliation MUST follow the source-scoped rules (ADR-035/ADR-036 amendments): a completed run retires only its own Source's absent memberships; a shared Component stays `ACTIVE` while any Source reports it; any authoritative enumeration failure MUST fail the run and perform no retirement.
- **FR-016**: A user-facing setup guide MUST ship at `docs/importers/docker.md` covering: what it imports; external setup per transport (Agent provisioning, registry file format and placement, daemon TLS/SSH/socket requirements); required/optional credentials and where their references live; every config field; and common failures — linked from `docs/importers/index.md` and the VitePress sidebar.
- **FR-017**: Any contract surface touched beyond what ADR-056/065/116/117/119 and their amendments already ratify (new scope keys and their shapes, the Agent-binding enforcement mechanism, error codes/NACK reasons, registry schema fields) MUST be ratified in the same change per the ADR fidelity rule.

### Key Entities

- **Docker importer config** — an `ImporterConfig` bound to an Agent; scope carries a plain `targetId` plus discovery/environment options.
- **Target profile** — an Agent-local, immutable access-route descriptor (`transport` + typed params) in the versioned `docker-targets.json` registry; an allowlist entry, never a Source or Component identity.
- **ImporterSource** — durable provenance record keyed on the Docker Engine's native identity; survives config deletion (`UNMONITORED`) and supports explicit reversible retirement.
- **Component (`CONTAINER`)** — one logical containerized workload, shared across environments through its canonical project/service or override identity.
- **ComponentInstance** — one concrete container; external identity includes source/daemon identity + container ID; carries image ref/digest, ports, safe references, and redacted mount data.
- **Source memberships** — existing durable Source→Component/Instance records holding per-source details; the unit of source-scoped reconciliation.
- **AGENT_MANAGED credential** — reference-only bundles (`{env:…}`/`{file:…}`) resolved on the Agent for TLS/SSH key material.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator following the shipped guide reaches a successful first Docker import for each supported transport — 100% of the four transports demonstrated end-to-end.
- **SC-002**: 100% of Docker runs — including empty inventories — report engine source identity before the first asset and attribute the run to the matching `ImporterSource`; zero unattributed Docker runs.
- **SC-003**: In the container-rebuild scenario, the new container creates a new Instance under the same Component, the old Instance retires for that Source only, and curated Product edges are preserved — 100% of rebuilds tested.
- **SC-004**: Two targets reporting the same canonical workload produce exactly one Component with per-Source Instances, and a run on either Source marks zero of the other Source's Instances GONE.
- **SC-005**: A project/service rename with a stable workload-ID override preserves Component identity; without an override it deterministically produces a new Component — both outcomes verified.
- **SC-006**: 100% of insecure transport variants (unknown `targetId`, plaintext TCP, skip-verify, password-only SSH, `default`/`SkipTLSVerify` Context) are rejected before any network access.
- **SC-007**: Zero environment variables, raw host paths, full inspect JSON, health-check output/commands, or secret material appear in stored catalog data, logs, or error responses — verified by a data-minimization audit of imported workloads.
- **SC-008**: Lint, typecheck, tests, and build are green across all changed packages; `validateDiscoveredAsset` is exercised by the importer's unit tests; `docs/openapi.yaml` stays in sync wherever contract surfaces change (ADR-104).

## Assumptions

- Wave C is Docker Engine workload inventory only: Swarm services/nodes/secrets/configs are Wave E; a Swarm-capable target still yields container inventory in this wave.
- The `rawConfig.dockerObservation` persisted health payload, detailed health-status mapping, generic Source UI, and `compose:`/`service:` tag suggestions are Wave D scope; Wave C ships only the allowlisted fields in FR-012 and the basic state→status mapping in FR-013 (Instances require a status to exist).
- `dockerode`/`docker-modem` is the approved client baseline per `docker-importer-research.md`; the exact pinned release is decided at plan.
- The Agent binding selector reuses the existing Execution mechanism from spec 027 — the Docker importer adds the *requirement* that a binding is mandatory; the enforcement mechanism is a plan decision.
- The config form is the existing schema-driven importer form with a plain `targetId` field; no custom target picker ships in v1.
- `docker-targets.json` follows the ratified `${SECRETS_DIR}/{importerName}-targets.json` convention and `{version: 1, targets: {...}}` envelope (ADR-116 Amendment 6); its typed per-transport profile schema is a plan/ADR-fidelity artifact.
- No new API endpoints are expected — the feature lands inside the existing importer-config, credential, run, and Source surfaces; any addition updates `docs/openapi.yaml` in the same change.
- Remote-run failure semantics (`AGENT_UNAVAILABLE`, `AGENT_LOST`, `TARGET_RESOLUTION_FAILED`, cancel/queue behavior) are reused as ratified; no protocol change is expected beyond ratifying the Docker profile schema.
