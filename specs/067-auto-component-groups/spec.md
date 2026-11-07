# Feature Specification: Source-scoped auto ComponentGroups

**Feature Branch**: `067-auto-component-groups`
**Created**: 2026-11-07
**Status**: Shipped
**Input**: Imported components — including the `docker-engine` COMPUTE component and every workload a Docker source reports — land in the catalog with no grouping, so a product that depends on "the cluster" must wire N individual components by hand. Design grilled and ratified in a two-round session (16 decisions, all approved) recorded in `researches/adrs/ADR-129-source-scoped-auto-component-groups.md` and `research.md`: a generic, source-scoped, system-provisioned ComponentGroup mechanism with Docker as the first strategy. Governing docs: ADR-129 (mechanism + Docker strategy), ADR-082 (amended — system-provisioned groups), ADR-019 (amended — `componentGroupId` system-derived carve-out), ADR-110 (group edges), ADR-113 (suppression interaction), ADR-119/120 (source identity/memberships).

## Clarifications

### Session 2026-11-07

All decisions resolved in the grilling session — no open markers:

- **Generic mechanism, Docker first**: the pass is provider-agnostic, keyed on `ImporterSource.id`; per-importer *strategies* declare slug templates and eligibility. Docker is the only enabled adopter in v1; other importers opt in via their own specs.
- **Group = sole effective-active reporter**: a component belongs to source S's auto-group iff S is its sole effective-active reporter (membership `active=true` AND source `ACTIVE`/`UNMONITORED`). Recomputed fully each pass — assign on gaining exclusivity, evict-to-`NULL` on losing it (second reporter appears, source stops reporting, source retires). Components in foreign human-managed groups are never touched.
- **No resourceType filter**: the pure sole-reporter rule applies to every component any category/provider — exclusive `compose-service`/`workload:`/`image` components join their single reporting source's group; shared components belong to no auto-group; manually created components never join (no source membership).
- **Link = `importer_sources.componentGroupId`**: new nullable FK → `component_groups`. Rename-proof provenance and the auto-managed marker for the lifecycle guard. Slug stays free-form display identity.
- **Trigger coverage**: failure-isolated pass beside `runSuggestionPass` on completed Hub and Agent runs, ordered **before** suggestion generation; `retireSource`/`reactivateSource` invoke the same evaluation so derived state never goes stale outside runs.
- **Enablement**: importer manifest declares capability; config scope gains `autoGroup?: boolean` default `true` (opt-out). Per-config flag, per-source group — a disabled config never tears down a group another enabling config maintains.
- **Derived lifecycle**: `ACTIVE` iff ≥1 member component `ACTIVE`, else `RETIRED`, recomputed each pass. Human `PATCH` `lifecycle` writes on auto-managed groups are rejected with a controlled conflict; name/description/teamOwnerId remain editable.
- **Identity**: `name` = source label → engine component name fallback; slug = `docker-cluster-{hash12(sourceIdentity)}` for Docker; `description` records source provenance; `teamOwnerId` = `NULL`.
- **Accepted limitation**: per-source grouping — two configs on managers of the same swarm produce two sources → two overlapping groups; `Swarm.Cluster.ClusterID` merging is a documented future refinement.
- **Packaging**: backend-only v1 — no UI badge or dedicated surface; auto-groups are ordinary `component_groups` rows visible everywhere groups already render.
- **Q: What happens when a human DELETEs an auto-managed ComponentGroup? → A: `DELETE /component-groups/{id}` on an auto-managed group is rejected with a controlled conflict, same as `lifecycle` writes — auto-managed groups are retired via their source, never destroyed by hand.**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Docker cluster components arrive pre-grouped (Priority: P1)

After a successful Docker import, the catalog contains one auto-managed ComponentGroup per Docker source whose members are exactly the components that source exclusively reports — the engine, Swarm nodes/services/secrets, standalone containers, and any compose/workload/image component reported by no other source.

**Why this priority**: This is the feature's core value — the factual layer already knows cluster membership; surfacing it as a group makes "depends on the cluster" a single future edge instead of N manual wirings.

**Independent Test**: complete a Docker import (Hub and Agent paths) against a swarm and a standalone engine; verify exactly one auto-group per source, membership equals the sole-reporter set, and the group is discoverable through the normal component-groups API/UI.

**Acceptance Scenarios**:

1. **Given** a completed Docker run reporting engine, nodes, services, secrets, and containers, **When** the post-run pass executes, **Then** one `ComponentGroup` exists linked from the ImporterSource and every exclusively-reported component has `componentGroupId` set to it.
2. **Given** the same logical compose workload reported by two Docker sources, **When** the pass executes for either source, **Then** that component belongs to no auto-group.
3. **Given** a manually created component with no source memberships, **When** any pass executes, **Then** its group assignment is never touched.
4. **Given** a component exclusively reported by source S, **When** source T begins reporting it, **Then** the next pass evicts it from S's group (`componentGroupId` → `NULL`).
5. **Given** a component in a human-managed group, **When** its sole reporter's pass executes, **Then** its assignment is never overwritten.

---

### User Story 2 - Group lifecycle and human edits stay honest (Priority: P1)

The auto-group's lifecycle reflects reality — `ACTIVE` while it has active members, `RETIRED` when emptied — and humans can rename/re-describe/re-own it but cannot fight the derived lifecycle or membership.

**Why this priority**: A derived structure that humans can silently contradict produces confusing state; the guards are what make automation trustworthy.

**Independent Test**: retire the last member's source or empty the group and verify lifecycle flips; PATCH lifecycle on the auto-group and verify a controlled conflict while name edits succeed.

**Acceptance Scenarios**:

1. **Given** an auto-group with ≥1 `ACTIVE` member, **When** a pass runs, **Then** its lifecycle is `ACTIVE`; **given** zero active members, **Then** `RETIRED`.
2. **Given** an auto-managed group, **When** a human PATCHes `lifecycle`, **Then** the API rejects with a controlled conflict; PATCHes to name/description/teamOwnerId succeed. **When** a human DELETEs the group, **Then** the API likewise rejects with a controlled conflict.
3. **Given** source retirement (components retired outside any run), **When** `retireSource` completes, **Then** the group's derived lifecycle/membership reflects it without waiting for another import.
4. **Given** a human who manually places an ineligible (shared or manual) component inside the auto-group, **When** the next pass runs, **Then** it is evicted — the group is automation-owned.

---

### User Story 3 - Operators control and understand the automation (Priority: P2)

A Docker importer config can opt out (`autoGroup: false`), and the group's name/description make its provenance obvious — which source it represents and that membership is derived.

**Why this priority**: Automation without an off switch or provenance erodes trust; both are cheap because the link row already exists.

**Independent Test**: create a config with `autoGroup: false`, run it, verify no group is created/maintained for its source; create one with default, verify the group appears with source-derived naming.

**Acceptance Scenarios**:

1. **Given** `autoGroup` absent or `true`, **When** a run completes, **Then** the source's group is created/maintained.
2. **Given** `autoGroup: false` on the only config feeding a source, **When** a run completes, **Then** no group is created and any existing auto-group for that source is left as-is (frozen, not torn down).
3. **Given** two configs on one source where one disables grouping, **When** the enabled config's run completes, **Then** the group continues to be maintained.
4. **Given** the created group, **When** its fields are inspected, **Then** name derives from the source label, slug matches the deterministic template, description names the source identity, and teamOwnerId is null.

---

### Edge Cases

- **Pass failure** — grouping errors are logged + metric-counted, never thrown into the host run or source-retire operation; the next trigger re-evaluates fully (idempotent).
- **Empty inventory run** — source still reports identity; group may exist with zero members → `RETIRED` lifecycle.
- **UNMONITORED source** — no runs fire; group and memberships freeze until reactivation, which re-evaluates.
- **Human-assigned foreign group** — component keeps its human group; automation never claims it. If the human later clears it, the next pass may claim it (null-or-ours).
- **Two configs sharing a source, one disabled** — group maintained while any enabling config runs (US3-3).
- **Same swarm, two manager endpoints** — two sources, two overlapping groups (accepted v1 limitation; `ClusterID` merging deferred).
- **Component retires** — `RETIRED` members don't count toward the ACTIVE-member lifecycle rule; component lifecycle changes outside runs still leave group state correct at next evaluation.
- **Slug collision on create** — deterministic template + unique slug constraint; conflict resolves via the existing slug path without duplicating the group (FK link is authoritative, not slug).
- **Human DELETE attempt** — rejected with a controlled conflict while the source link exists; there is no manual destroy path for auto-managed groups.
- **Pre-existing components** — first pass after deploy retroactively assigns eligible existing components (no migration of membership needed; evaluation is derived).

## Requirements *(mandatory)*

### Functional Requirements

**Mechanism**

- **FR-001**: The backend MUST provide a provider-agnostic source-scoped grouping pass that, for each enabled ImporterSource, maintains at most one auto-managed `ComponentGroup`.
- **FR-002**: The pass MUST run after completed Hub and Agent import runs (memberships already written) and MUST be ordered before `runSuggestionPass`.
- **FR-003**: The pass MUST also run on `retireSource` and `reactivateSource` for the affected source.
- **FR-004**: Pass failures MUST be isolated (logged, metric-counted) and MUST NOT fail the host run or source operation.
- **FR-005**: `importer_sources` MUST gain a nullable `componentGroupId` FK → `component_groups` as the durable source→group link and auto-managed marker.

**Membership**

- **FR-006**: A component MUST belong to source S's auto-group iff S is its sole effective-active reporter; the evaluation MUST be a full recompute each pass (assign on exclusivity gained, evict-to-`NULL` on exclusivity lost).
- **FR-007**: The pass MUST NOT modify components whose `componentGroupId` points to a group not owned by this source's auto-group (null-or-ours rule).
- **FR-008**: Eligibility MUST apply the sole-reporter rule to all components regardless of category/provider — no resourceType allowlist.
- **FR-009**: Manually created components (no source memberships) MUST never be assigned.

**Lifecycle & edits**

- **FR-010**: Auto-group lifecycle MUST be derived: `ACTIVE` iff ≥1 member component is `ACTIVE`, else `RETIRED`, recomputed each pass.
- **FR-011**: `PATCH /component-groups/{id}` MUST reject `lifecycle` writes on auto-managed groups with a controlled conflict; name/description/teamOwnerId edits MUST remain allowed. `DELETE /component-groups/{id}` on an auto-managed group MUST likewise be rejected with a controlled conflict — the group is retired via its source, never destroyed by hand.

**Enablement & identity**

- **FR-012**: Importer manifests MUST be able to declare the auto-group capability; config scope MUST support `autoGroup?: boolean` defaulting to `true`.
- **FR-013**: Group `name` MUST derive from source label with engine-name fallback; `slug` MUST be deterministic per strategy; `description` MUST record source provenance; `teamOwnerId` MUST be `NULL`.

**Docker strategy**

- **FR-014**: The Docker importer MUST declare the capability and support the `autoGroup` opt-out; its strategy slug template is `docker-cluster-{hash12(sourceIdentity)}`.
- **FR-015**: Docker group contents MUST equal the source's sole-reporter set with no type exclusions — engine, swarm nodes/services/secrets, standalone containers, and exclusive compose/workload/image components.

**Boundaries**

- **FR-016**: This feature MUST NOT change the importer contract — no `DiscoveredAsset` field, no importer-declared groups or edges.
- **FR-017**: This feature MUST NOT create product edges or modify any existing edge; `product_depends_on_component_group` wiring remains human-authored.
- **FR-018**: Auto-groups MUST be ordinary `component_groups` rows — group edges, read-time expansion, and all existing group surfaces work unchanged.
- **FR-019**: Implementation MUST update `docs/openapi.yaml` for the lifecycle/delete conflict responses and any schema-visible changes (ADR-104), and `docs/importers/docker.md` for the `autoGroup` key.
- **FR-020**: Test-first development applies; grouping tests MUST cover Hub and Agent run paths, source retire/reactivate, and the human-conflict matrix.

### Key Entities *(include if feature involves data)*

- **`importer_sources.componentGroupId`** (new column): nullable FK → `component_groups`; the source→group link and auto-managed marker.
- **Auto-managed ComponentGroup**: ordinary `component_groups` row provisioned by the pass; derived lifecycle; membership = sole-effective-active-reporter set.
- **Source-scoped grouping strategy**: per-importer declaration (manifest capability + slug template + eligibility hook) consumed by the generic pass.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any successful run of an enabled source, the auto-group's member set equals exactly the components for which that source is the sole effective-active reporter — 100% match, verified by tests.
- **SC-002**: Zero modifications to components in human-managed groups or to manual components across all pass triggers.
- **SC-003**: Group lifecycle matches the derived rule after every trigger — no stale `ACTIVE` empty groups, no `RETIRED` groups with active members.
- **SC-004**: `autoGroup: false` sources never gain or lose group membership; disabling never tears down a group another enabling config maintains.
- **SC-005**: Grouping pass failures produce zero run failures and zero source-operation failures across Hub and Agent paths.
