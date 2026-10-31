# Feature Specification: ImporterSource Core — durable source identity and source-scoped reconciliation

**Feature Branch**: `044-importer-source-core`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Phase 1 / Wave A of the Docker importer program (`researches/docker-importer-implementation-tracking.md`, `researches/docker-importer-spec-waves.md`), implementing the contracts ratified in spec 043 (ADR-119 plus amendments to ADR-035/036/037/047/056/065/077/116): the generic `ImporterSource` core — durable `ImporterSource` entity, source-identification callback before asset yield, one-config-per-Source binding, `ImportRun.sourceId` + nullable `configId`, durable Source→Component/ComponentInstance memberships, source-scoped reconciliation and retirement, generic Agent target resolver/preflight contract, and best-effort legacy handling for not-yet-migrated importers.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every run is attributed to a durable source (Priority: P1)

An operator configures and runs an import. Before the importer yields its first asset, it reports the provider-native canonical identity of the external system it scanned (e.g., an engine daemon ID, organization ID, account/subscription ID, cluster UID, canonicalized endpoint URL, or an admin-supplied stable key where the provider offers none). The system registers a durable `ImporterSource` for that identity — or matches the existing one — and attributes the run to it. A reachable-but-empty inventory still registers and attributes the Source, so "empty" is never confused with "unreachable."

**Why this priority**: The durable source boundary is the foundation every other capability in this feature builds on — run attribution, memberships, source-scoped reconciliation, and lifecycle all hang off it. Without it, provenance dies with the config (the problem ADR-119 exists to solve).

**Independent Test**: run an importer that reports a source identity → an `ImporterSource` record exists keyed by that provider identity and the run row points at it; run again → same Source matched, no duplicate; run with an empty inventory → Source still registered, run still attributed.

**Acceptance Scenarios**:

1. **Given** an importer run begins, **When** the importer reports its source identity before yielding assets, **Then** the system registers or matches the `ImporterSource` for that provider-native identity and stamps the run with it.
2. **Given** an import that discovers zero assets, **When** the run completes, **Then** the Source is still registered and the run is attributed to it.
3. **Given** a provider that offers no trustworthy identity, **When** an admin supplies a stable key, **Then** that key is used as the source identity — sources are never matched by display name.
4. **Given** a URL-based source identity containing credentials or auth parameters, **When** the identity is persisted, **Then** userinfo, auth query parameters, and fragments are stripped so no secret material lands in the identity.

### User Story 2 - Source-scoped reconciliation protects shared components (Priority: P1)

Two different external systems (or two targets of the same system) each report the same logical Component. When one source completes a full inventory that no longer includes that Component, only that source's record of reporting it is deactivated — the Component and its instances stay active because the other source still reports them. Retirement happens only when no active source still reports the entity. A failed or incomplete run never retires anything.

**Why this priority**: This is the correctness core of the feature — the reason the membership model exists. It makes multi-source reporting safe, which the Docker program (two daemons reporting the same workload) depends on.

**Independent Test**: stand up two sources reporting one shared component; complete a run on source A that omits it → component stays active (source B still reports); then complete a run on B that omits it too → component retires. Repeat with a deliberately failed/incomplete run → nothing retires.

**Acceptance Scenarios**:

1. **Given** a Component reported by two active Sources, **When** Source A's completed run no longer includes it, **Then** only Source A's membership deactivates and the Component stays active.
2. **Given** a Component whose last active Source membership deactivates, **When** the run completes, **Then** the Component retires and its instances are marked gone per existing lifecycle rules.
3. **Given** a failed or incomplete run, **When** reconciliation is evaluated, **Then** no membership deactivation and no retirement occurs — a failed enumeration is not a snapshot.
4. **Given** an instance reported by two Sources, **When** one Source stops reporting it, **Then** the instance stays non-gone while any other Source's membership remains active.

### User Story 3 - Config lifecycle decoupled from provenance (Priority: P2)

An operator deletes an importer config (credential rotation, scope redo, environment decommission). The Source it fed becomes unmonitored — not deleted, not retired — and the full run history stays attributable to that Source. Later, a new or recreated config reaching the same external system reattaches to the same Source, which becomes active again, preserving continuity. Separately, an operator can explicitly retire a Source — and can reverse that decision.

**Why this priority**: This is the operator-facing payoff of decoupling identity from execution config; it prevents provenance loss during routine config churn. P2 because it depends on US1's entity and US2's memberships.

**Independent Test**: create config → run → delete config → Source shows unmonitored, run history still attributed to it; recreate a config reaching the same system → same Source reactivates. Explicitly retire the Source → state changes; reverse it → state restored.

**Acceptance Scenarios**:

1. **Given** a config bound to a Source, **When** the config is deleted, **Then** the Source becomes unmonitored, the run rows keep their Source attribution with a null config reference, and memberships persist unchanged.
2. **Given** an unmonitored Source, **When** a config attaches to the same provider identity, **Then** the Source returns to active.
3. **Given** an operator action to retire a Source, **When** it executes, **Then** the Source becomes retired; the action is reversible through a matching operator action.
4. **Given** a Source's lifecycle, **When** the operator inspects it, **Then** its identity, bound config (if any), and state are observable through the API.

### User Story 4 - Generic agent target resolution contract (Priority: P2)

An importer that runs remotely on an Import Agent needs to reach a provider endpoint inside the restricted network without the hub ever holding the access route. The importer's manifest declares which config-scope key carries a `targetId`; the Agent validates that reference against its own read-only, versioned target registry before invoking the importer — rejecting unknown, malformed, or disallowed profiles before any network access — and exposes the resolved, typed, non-secret profile to the importer through the run context.

**Why this priority**: The contract is part of Wave A's scope and must land before the Docker importer (Wave C) can adopt it. It is provider-agnostic machinery — valuable, but independently testable as a contract seam.

**Independent Test**: dispatch a remote job whose scope carries a `targetId` declared by `targetRefKey` → Agent resolves the profile from its registry and the importer can read it via the context; repeat with an unknown/malformed `targetId` → the job rejects before network access with a non-secret reason and the Agent stays ready.

**Acceptance Scenarios**:

1. **Given** a manifest declaring a target-reference key and a config scope carrying a `targetId`, **When** a remote run dispatches, **Then** the Agent validates the reference against its registry and resolves the typed profile before importer execution.
2. **Given** a `targetId` absent from the Agent-local registry, **When** preflight runs, **Then** the job is rejected before network access with a non-secret reason and the Agent remains ready for other jobs.
3. **Given** an importer whose manifest declares no target-reference key, **When** it attempts target resolution, **Then** the call is rejected as invalid.
4. **Given** a target profile that references agent-managed credential bundles, **When** resolution occurs, **Then** the existing credential mechanism composes unchanged — no secret material crosses the wire.

### User Story 5 - Legacy data and non-migrated importers are untouched (Priority: P3)

Existing Components, Component Instances, and import runs — created before this feature — keep working under unattributed provenance. Importers that have not yet adopted source reporting continue on the existing reconciliation behavior until their named migration wave lands. Nothing is auto-split, merged, rekeyed, or auto-retired.

**Why this priority**: Preservation is a safety guarantee rather than new capability, but it bounds the blast radius of the whole feature — the new model must not corrupt or strand existing catalog data.

**Independent Test**: with pre-existing catalog data, run a non-migrated importer → behavior matches today's reconciliation exactly; legacy rows keep their provenance marker; no record is rekeyed or retired by the new machinery.

**Acceptance Scenarios**:

1. **Given** catalog data created before this feature, **When** a non-adopting importer runs, **Then** reconciliation behaves exactly as it does today for that importer.
2. **Given** legacy runs and memberships lacking source attribution, **When** the new system reads them, **Then** they are presented as unattributed legacy provenance — never auto-assigned to a Source on guesswork.

---

### Edge Cases

- Importer yields assets without ever reporting a source identity — the executor must treat a missing report as a contract violation for adopting importers (fail the run) while non-migrated importers keep legacy behavior until their wave.
- Two configs racing to bind the same provider identity — only one active config binds a Source at a time; rebinding replaces cleanly.
- Source identity reported identically by two different importer types — provider identity is scoped so different providers cannot collide on a shared key space.
- A Source's memberships outliving run retention — memberships are durable and independent of run history cleanup; deleting runs must not orphan the membership view.
- Operator retires a Source that later gets reported again by a run — a returning provider identity reactivates the Source rather than stranding it retired.
- Registry file missing/corrupt on the Agent — preflight fails closed (no targets resolvable) without taking the Agent down.
- `targetId` present in scope but the manifest declares no target-reference key — the value is inert scope data, not a target reference; it is never resolved.
- Run attribution when identity reporting itself fails (unreachable provider before identity is known) — the run records the failure without inventing a Source.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST persist `ImporterSource` as a first-class durable record: UUID v7 primary key, provider-native canonical non-secret external identity, display metadata (label), and a lifecycle of `ACTIVE` / `UNMONITORED` / `RETIRED`. A Source is internal provenance — never a catalog `Component`, never matched by display name.
- **FR-002**: The importer run context MUST gain a source-identity reporting callback that adopting importers invoke before the first asset yield on every run — including empty inventories — so the core registers-or-matches the `ImporterSource` and attributes the run to it. A run from an adopting importer that never reports identity MUST fail as a contract violation.
- **FR-003**: URL-based source identities MUST be canonicalized before persistence — userinfo, authentication query parameters, and fragments stripped — so identities carry no secret material.
- **FR-004**: One active `ImporterConfig` MUST bind one Source; replacing or recreating a config reaching the same provider identity MUST reattach to the same Source, preserving continuity across credential rotation and scope edits.
- **FR-005**: `import_runs` MUST carry a durable `sourceId`; `configId` MUST become nullable with `ON DELETE SET NULL` so deleting a config preserves the run row and its Source attribution.
- **FR-006**: Durable Source→Component and Source→ComponentInstance membership records MUST persist which Source reported what, independent of `lastSeenInRunId` and of run-history retention. Source-specific metadata MUST live on the membership; shared canonical facts stay on the shared record — preventing last-writer-wins when two Sources report the same logical entity.
- **FR-007**: Reconciliation MUST be source-scoped: a completed run deactivates only the reporting Source's absent memberships; a shared Component/Instance MUST remain active while any Source reports it; `RETIRED`/`GONE` apply only when no active membership remains; a failed or incomplete run MUST perform no retirement.
- **FR-008**: Deleting an `ImporterConfig` MUST transition its Source to `UNMONITORED` (not deleted, not retired) and leave memberships untouched. Explicit Source retirement MUST be a separate, reversible, operator-driven action — never a side effect of config deletion — and a Source MUST return to `ACTIVE` when the same provider identity is reported again.
- **FR-009**: The importer manifest MUST gain an optional target-reference key declaring which config-scope key carries a `targetId`; the run context MUST gain a typed target resolver valid only when that key is declared.
- **FR-010**: The Agent MUST load a versioned, read-only target registry from its secrets directory (`<name>-targets.json` convention); the registry IS the allowlist — a `targetId` absent from it is rejected. Preflight MUST validate and resolve the profile before invoking the importer and MUST fail before network access with a non-secret reason on unknown, malformed, or disallowed profiles, leaving the Agent ready for other jobs.
- **FR-011**: `targetId`s MUST be treated as immutable access-route identifiers distinct from both Source identity and Component identity; changing an endpoint/transport/pinning parameter means a new profile ID. Profiles MAY reference agent-managed credential bundles per the existing credential mechanism, which MUST NOT be redefined.
- **FR-012**: Source lifecycle MUST be observable and operable through the API — list, detail (identity, bound config, last complete run, state), explicit retire, and reverse — with `docs/openapi.yaml` updated in the same change per ADR-104 and RBAC consistent with existing importer-administration permissions.
- **FR-013**: Components, Instances, and runs predating this feature MUST retain unattributed (`LEGACY_UNATTRIBUTED`) provenance; non-adopting importers MUST continue on the existing config-scoped reconciliation until their named Wave B migration specs. The system MUST NOT auto-split, auto-merge, rekey, or auto-retire uncertain records.
- **FR-014**: Every contract surface this implementation touches beyond what ADR-119 and its amendments already ratify (new endpoints, error codes, message/frame types, permissions) MUST be ratified per the ADR fidelity rule in the same change.

### Key Entities

- **ImporterSource** — durable provenance record: internal UUID v7, provider-native external identity, display label, `ACTIVE`/`UNMONITORED`/`RETIRED` lifecycle, bound-config link.
- **Source membership** — durable record that a given Source reported a given Component or ComponentInstance; carries source-specific metadata; the reconciliation unit.
- **ImportRun** — gains durable `sourceId` (attributed at start from the reported identity); `configId` becomes nullable (`ON DELETE SET NULL`).
- **ImporterConfig** — editable execution/schedule/credential record; at most one active config binds a Source.
- **Target profile / target registry** — Agent-local, versioned, read-only set of non-secret access-route descriptors keyed by immutable `targetId`; the registry contents are the allowlist.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A completed run from a reachable-but-empty source registers the Source and attributes the run — verified by an automated scenario; "empty" and "unreachable" are distinguishable in run history 100% of the time.
- **SC-002**: In the two-source shared-Component scenario, one source's completed run deactivates zero memberships belonging to the other source; the shared Component retires only after its last active membership deactivates — verified end-to-end.
- **SC-003**: Deleting a config preserves 100% of its run history and Source attribution; reattaching a config to the same provider identity reactivates the same Source with continuity intact.
- **SC-004**: A remote job with an unknown or malformed `targetId` is rejected before any network access, with a non-secret reason, and the Agent accepts subsequent valid jobs.
- **SC-005**: Non-adopting importers produce byte-for-byte equivalent reconciliation outcomes to the pre-feature behavior — zero legacy records rekeyed, split, merged, or retired.
- **SC-006**: Lint, typecheck, tests, and build are green across all changed packages; API contract tests and `docs/openapi.yaml` stay in sync (ADR-104).

## Assumptions

- The operator-facing lifecycle surface ships as API endpoints in this wave; the dedicated Source list/detail/lifecycle UI is explicitly deferred to Wave D (`docker-importer-spec-waves.md`), so no frontend work is in scope here beyond what the API requires.
- No production importer adopts source reporting in this wave — the contract lands generically, exercised through the importer test harness and integration scenarios; Docker is the first adopter (Wave C) and the other importers migrate in Wave B specs.
- Endpoint paths, error-code names, and frame/message shapes are decided at plan within existing conventions (ADR-070/071, ADR-116) and ratified if they extend enumerated ADR surfaces.
- The `LEGACY_UNATTRIBUTED` representation may be a sentinel, a null foreign key with read-side labeling, or an equivalent mechanism — decided at plan — as long as unattributed provenance is explicit and never guessed.
- Agent jobs carry the scope needed for preflight already (spec 027 dispatch contract); this wave adds registry loading, validation, and the typed resolver, not a new dispatch protocol beyond what ADR-116 Amendment 5 requires.
