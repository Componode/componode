# Feature Specification: Docker infrastructure inventory

**Feature Branch**: `065-docker-infra-inventory`
**Created**: 2026-11-07
**Status**: Shipped
**Input**: Docker networks and volumes are infrastructure the catalog cannot see today — operators cannot answer "which networks do my workloads attach to" or "what persistent storage exists on this engine" even though the engine's network and volume list endpoints already return those facts. Design grilled and ratified in `researches/docker-importer-enrichment-pack.md` (Wave G of the Docker importer program): `NETWORK`/`STORAGE` components with `instances: []`, scope/name-qualified identities, strict field allowlists, a fail-closed error policy, and bounded UI surfacing — zero new endpoints, zero new config keys, no API/contract changes. Governing docs: ADR-121 (data-minimization allowlist), ADR-122 (dual Hub/Agent executor parity).

## Clarifications

### Session 2026-11-07

All decisions resolved in the prior grilling session recorded in `researches/docker-importer-enrichment-pack.md` — no open markers:

- Scope is **infrastructure inventory only**: `GET /networks` → `NETWORK` components, `GET /volumes` → `STORAGE` components. Both emit `instances: []` — point-in-time facts live in `details` (the image/swarm-secret precedent); there are no per-environment instances.
- Both types are **always emitted** — two cheap list calls, low cardinality, no opt-in flags, on every transport and both executors.
- Identities are **scope/name-qualified**: `{sourceIdentity}:network:{scope}:{name}` because a `frontend` bridge network and a `frontend` Swarm network can coexist; `{sourceIdentity}:volume:{name}` because volume names are daemon-unique. Component `name` is the Docker name.
- Field allowlists were ratified after explicit review. Networks keep driver/scope/flags/createdAt/attachment names/count/allowlisted labels; volumes keep driver/scope/createdAt/`UsageData` size+refCount+reclaimable/allowlisted labels.
- **Excluded as a class**: IPAM config (address plan), per-endpoint MAC/IP/endpoint IDs, network `Options`, volume `Mountpoint` (host path), volume `Options` (highest-risk: `local` driver `type=bind` embeds host paths in `device`, `type=nfs` embeds server addresses in `o=`), volume `Status` (free-text), network `Id`.
- Labels use the **same bounded prefix allowlist as container labels** (`com.docker.*`, `componode.*`) — never an unbounded passthrough. Compose-project association arrives free via `com.docker.compose.project`.
- `/networks` or `/volumes` errors **fail the run closed** — consistent with ADR-121's "partial inventory is never emitted" Swarm rule.
- Swarm `/configs` stay service-detail refs only — no `CONFIG` category exists; Wave E's exclusion stands.
- Implementation amends ADR-121 (Amendment 4) and updates `docs/importers/docker.md` in the same change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the networks Docker workloads attach to (Priority: P1)

An operator browsing the catalog can see every network defined on a Docker engine as its own component — its driver, scope (local vs. Swarm), posture flags (internal, attachable, ingress, IPv6), creation time, and which containers are attached — without opening Docker or reading raw API output.

**Why this priority**: Networks are the connective tissue of container inventory; the catalog already shows which networks a container instance attaches to (`networks[]` on instances), but the networks themselves are invisible. This is the primary inventory gap the feature closes.

**Independent Test**: run a Docker import against an engine with bridge, overlay/swarm, and custom networks; verify each emitted network is a `NETWORK`/`DOCKER` component with bounded details, and verify excluded data (IPAM subnets, endpoint IPs/MACs, driver options) never appears.

**Acceptance Scenarios**:

1. **Given** an engine with N networks, **When** an import run completes, **Then** exactly N `NETWORK` components exist for that source — one per network the engine returned, always emitted with no opt-in.
2. **Given** a network with attached containers, **When** an import run completes, **Then** its details carry the attachment count and the attached container names — never their MAC addresses, IP addresses, or endpoint IDs.
3. **Given** a `local`-scope and a `swarm`-scope network sharing the name `frontend`, **When** an import run completes, **Then** two distinct components exist — the scope-qualified identity prevents collision.
4. **Given** any emitted network component, **When** its details are inspected, **Then** no IPAM configuration, driver `Options`, endpoint addressing, or network `Id` appears.

---

### User Story 2 - See the persistent storage Docker workloads use (Priority: P1)

An operator can see every volume on a Docker engine as its own component — driver, scope, creation time, and whatever usage facts the driver reports (size, reference count, reclaimability) — giving the catalog a complete picture of stateful infrastructure alongside workloads.

**Why this priority**: Volumes are the other half of infrastructure inventory; containers already reference volumes by opaque refs in their mounts, and the catalog cannot resolve what those refs point at today. Equal priority with networks — both are the same cheap-list-call inventory pattern.

**Independent Test**: run a Docker import against an engine with local and named volumes (including one whose driver reports no usage data); verify each volume is a `STORAGE`/`DOCKER` component with bounded details, and verify `Mountpoint`, `Options`, and `Status` never appear.

**Acceptance Scenarios**:

1. **Given** an engine with N volumes, **When** an import run completes, **Then** exactly N `STORAGE` components exist for that source — always emitted with no opt-in.
2. **Given** a volume whose driver reports usage data, **When** an import run completes, **Then** its details carry size, reference count, and reclaimable flag when reported.
3. **Given** a volume whose driver reports no usage data, **When** an import run completes, **Then** those fields are simply absent rather than zeroed or errored.
4. **Given** any emitted volume component, **When** its details are inspected, **Then** no mountpoint host path, driver `Options`, free-text `Status`, or volume `Id` appears.

---

### User Story 3 - Trace infrastructure back to its compose project (Priority: P2)

An operator viewing a network or volume component can see its allowlisted labels — including `com.docker.compose.project` — so Compose-managed infrastructure is attributable to the project that created it.

**Why this priority**: Label carry-over is nearly free (the allowlist already exists for containers) and delivers the highest-signal attribution fact — which Compose project owns this network or volume. It is P2 because the inventory itself (P1) stands alone without it.

**Independent Test**: label a network and a volume with `com.docker.compose.project` plus an arbitrary non-allowlisted label; verify only allowlisted labels appear on the emitted components.

**Acceptance Scenarios**:

1. **Given** a network labeled `com.docker.compose.project=myapp` and `internal.example.com/secret=…`, **When** an import run completes, **Then** the component carries the compose-project label and never the non-allowlisted one.
2. **Given** a network or volume with no labels, **When** an import run completes, **Then** the labels field is absent rather than an empty object.
3. **Given** the emitted labels, **When** compared to container label handling, **Then** the same bounded prefix allowlist (`com.docker.*`, `componode.*`) applies — no unbounded passthrough.

---

### User Story 4 - Read infrastructure facts in the catalog UI (Priority: P3)

An operator viewing a network or volume component sees its facts rendered as deliberate, named sections — driver, scope, flags, attachments for networks; driver, scope, size/refCount for volumes — consistent with how the spec-064 engine/image facts render today.

**Why this priority**: Data without surfacing is invisible; but the rendering is bounded by the existing allowlist pattern, so it follows the data work rather than preceding it.

**Independent Test**: render component detail pages for network and volume components produced by an import; verify each fact group appears in its named section and no raw details dump is rendered.

**Acceptance Scenarios**:

1. **Given** a network component, **When** its detail renders, **Then** driver, scope, flags, attachment count/names, and labels appear in named sections.
2. **Given** a volume component, **When** its detail renders, **Then** driver, scope, size, refCount, reclaimable, and labels appear in named sections.
3. **Given** any component, **When** its detail renders, **Then** no generic `details` dump is shown — only explicitly allowlisted fields render.

### Edge Cases

- Engine returns zero networks or zero volumes → empty lists emit zero components; the run is unaffected.
- Built-in networks (`bridge`, `host`, `none`) → emitted like any other network; no exclusion was ratified.
- Anonymous volumes (daemon-generated names) → emitted under their reported name; the name is the identity.
- A network with zero attachments → `attachedCount` is 0 and `attachedContainers` is absent or empty.
- Swarm-scoped (`scope: swarm`/`global`) networks → emitted with their scope in identity and details; whether they are visible on worker (non-manager) nodes is engine-dependent — each executor emits whatever its API returns (ADR-122 parity, no Hub/Agent filtering).
- Engine API older than an endpoint's introduction → the plan verifies minimum API versions for both endpoints and states any hard floor alongside the v1.41 Swarm gate; fields/endpoints absent on old engines are omitted, never errored.
- `/networks` succeeds but `/volumes` fails (or vice versa) → the run fails; no completed run results, consistent with the partial-inventory rule.
- Two sources targeting the same engine → each emits its own network/volume components under its own source identity (the engine-component precedent).
- A network or volume is deleted between runs → standard source-scoped reconciliation retires the absent membership; no new lifecycle work.
- Re-run with unchanged infrastructure → upsert is idempotent; no duplicate components (externalId stability).
- Non-Docker fields smuggled into a response (driver-specific extras) → dropped by the allowlist mapper; only named fields reach `details`.

## Requirements *(mandatory)*

### Functional Requirements

**Networks**

- **FR-001**: Every successful Docker import MUST emit one `NETWORK`/`DOCKER` component per network the engine returns — always emitted (no opt-in flag), on every transport and both executors.
- **FR-002**: A network component's `externalId` MUST be `{sourceIdentity}:network:{scope}:{name}` — scope-qualified because same-named networks in different scopes coexist; the component `name` MUST be the Docker network name.
- **FR-003**: Network `details` MUST carry only the allowlisted facts: `driver`, `scope`, `internal`, `attachable`, `ingress`, `configOnly`, `enableIPv6`, `createdAt`, `attachedCount`, `attachedContainers` (endpoint **names** only), and `labels` (bounded allowlist).
- **FR-004**: Network emission MUST NOT include IPAM configuration (subnets, gateways, auxiliary addresses), per-endpoint MAC addresses, IP addresses, or endpoint IDs, network `Options`, or the network `Id`.

**Volumes**

- **FR-005**: Every successful Docker import MUST emit one `STORAGE`/`DOCKER` component per volume the engine returns — always emitted (no opt-in flag), on every transport and both executors.
- **FR-006**: A volume component's `externalId` MUST be `{sourceIdentity}:volume:{name}` — volume names are daemon-unique; the component `name` MUST be the Docker volume name.
- **FR-007**: Volume `details` MUST carry only the allowlisted facts: `driver`, `scope`, `createdAt`, and — when the driver reports them — `sizeBytes`, `refCount`, `reclaimable` (from usage data), plus `labels` (bounded allowlist).
- **FR-008**: Volume emission MUST NOT include `Mountpoint` (raw host filesystem path), `Options` (driver options that can embed host paths or server addresses), free-text `Status`, or any non-allowlisted field.

**Shared inventory rules**

- **FR-009**: Both resource types MUST emit `instances: []` — these are point-in-time facts in `details`; no per-environment instances exist (image/swarm-secret precedent).
- **FR-010**: `resourceType` MUST be `network` for networks and `volume` for volumes; `provider` MUST be `DOCKER`; categories MUST be the existing `NETWORK` and `STORAGE` enum values — no new categories, providers, or core constants.
- **FR-011**: `labels` on both resource types MUST use the same bounded prefix allowlist as container labels (`com.docker.*`, `componode.*`) — never an unbounded namespace passthrough.
- **FR-012**: A `/networks` or `/volumes` failure MUST fail the run — partial infrastructure inventory is never emitted as a completed run (ADR-121 fail-closed rule, same as the Swarm gate).
- **FR-013**: Emission MUST record whatever the engine API returns for the executing transport — no Hub-only or Agent-only filtering or enrichment (ADR-122 parity).
- **FR-014**: Planning MUST verify the minimum Engine API versions for `/networks` and `/volumes` and state any hard floor alongside the existing v1.41 Swarm gate in the plan/research artifacts.

**UI surfacing**

- **FR-015**: Component detail views MUST render network facts (driver, scope, flags, attachment count/names, labels) and volume facts (driver, scope, size, refCount, reclaimable, labels) in named, allowlisted sections per the spec-064 rendering pattern.
- **FR-016**: No UI surface MAY render a generic `details` dump; only explicitly allowlisted fields render.

**Boundaries**

- **FR-017**: This feature MUST NOT add endpoints, config keys, manifest fields, or API/contract changes; `docs/openapi.yaml` MUST remain unchanged.
- **FR-018**: All emission MUST live in shared importer code so Hub-executed and Agent-executed runs produce identical output (ADR-122 parity); no executor-specific behavior.
- **FR-019**: `docs/importers/docker.md` MUST be updated in the same change to document every newly collected field and its bounds.
- **FR-020**: The change MUST record ADR-121 Amendment 4 covering the new allowlisted fields and identities.
- **FR-021**: Importer tests MUST exercise `validateDiscoveredAsset` for every newly emitted asset shape, and test-first development applies (failing test → implement → refactor).
- **FR-022**: Playwright coverage for the changed surface is required per the AGENTS.md testing rules.

### Key Entities *(include if feature involves data)*

- **Network component** (new): `NETWORK`/`DOCKER` component, `resourceType: "network"`, scope-qualified `externalId` (`{sourceIdentity}:network:{scope}:{name}`), `instances: []`, bounded `details` (driver/scope/flags/createdAt/attachments/labels).
- **Volume component** (new): `STORAGE`/`DOCKER` component, `resourceType: "volume"`, name-qualified `externalId` (`{sourceIdentity}:volume:{name}`), `instances: []`, bounded `details` (driver/scope/createdAt/usage/labels).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any successful Docker import, 100% of engine-returned networks appear as `NETWORK` components and 100% of engine-returned volumes appear as `STORAGE` components for that source.
- **SC-002**: Zero occurrences of excluded data (IPAM config, endpoint MACs/IPs/endpoint IDs, network or volume `Options`, volume `Mountpoint`/`Status`, host paths) in emitted assets — verified by tests.
- **SC-003**: Same-named networks in different scopes (e.g. `local` vs. `swarm`) produce two distinct components — identity collisions are impossible by construction.
- **SC-004**: An engine whose network or volume list call fails produces a failed run — never a completed run with partial infrastructure inventory.
- **SC-005**: Hub-executed and Agent-executed runs against the same engine produce identical network/volume inventory.
- **SC-006**: Every new fact group renders in a named UI section for its resource type, and no generic `details` dump exists anywhere in the catalog UI.
- **SC-007**: Lint, typecheck, tests, and build pass for all changed packages; `docs/importers/docker.md` documents every new field; ADR-121 Amendment 4 is recorded; `docs/openapi.yaml` drift checks pass (openapi unchanged); Playwright coverage ships with the change.

## Assumptions

- Both `/networks` and `/volumes` long predate the existing v1.41 Swarm API floor, so no new version gate is anticipated — but the verified minimum versions and any hard floor are stated in plan/research per FR-014.
- Built-in networks (`bridge`, `host`, `none`) and anonymous volumes are emitted — the ratified design excludes nothing by name.
- Swarm-scoped network visibility on worker (non-manager) nodes is engine-dependent; each executor emits whatever its API returns, and Hub/Agent output may legitimately differ only where the engines themselves differ.
- Run-phase ordering (where infrastructure listing sits relative to container/image phases) is a plan-level detail.
- Whether infra `labels` surface through the existing label UI or the new details sections is a plan-level detail bounded by the allowlist-only rendering rule.
- Deleted networks/volumes retire through existing source-scoped reconciliation — no new lifecycle or retirement work.
- Spec 066 (`component-group detail` bugfix) and 067 (`auto component groups`) are independent and unaffected.
