# Feature Specification: App-level auto ComponentGroups + multi-group membership

**Feature Branch**: `070-app-auto-groups`
**Created**: 2026-11-10
**Status**: Draft
**Input**: Source-scoped auto groups (spec 067 / ADR-129) bucket every exclusively-reported component into one flat per-engine group — a Docker catalog cannot express "the componode app" as a unit even though the engine already labels compose projects and swarm stacks. Design grilled and ratified across three rounds (10 decisions, all approved) recorded in `researches/docker-app-level-grouping-proposal.md`. This feature has two coupled halves: (1) promote `ComponentGroup` membership from single-valued to multi-valued, and (2) add app-level auto groups keyed on compose-project / swarm-stack labels, Docker as first adopter. Governing docs: ADR-129 (source groups — partially superseded on membership cardinality and the `importer_sources.componentGroupId` link), ADR-082 (ComponentGroup), ADR-121 (docker importer contract), ADR-113 (suppression interaction).

## Clarifications

### Session 2026-11-10

All decisions resolved in the grilling session — no open markers:

- **Coexistence → multi-membership**: `components.componentGroupId` (single-valued) is promoted to a join table; a component may belong to human + source-auto + app-auto groups simultaneously. The null-or-ours "human-parked" exclusion is retired — it existed only because membership was single-valued. Auto-membership is purely additive.
- **Dimensions → compose project + swarm stack only**: declared application boundaries. Topology-inferred clusters, image lineage, and custom label-key grouping (`componode.app`) are deferred to follow-up specs.
- **Mechanism → generic capability, docker-only adoption**: the pass framework is importer-agnostic; each importer declares the capability and supplies a strategy extracting group keys from persisted `details`. Constitution V preserved — `DiscoveredAsset` untouched.
- **Identity → per-source**: app group key = `(sourceId, kind, key)` where kind ∈ {compose-project, swarm-stack}. Generic project names collide across engines; fleet-wide app identity deferred (same class as `Swarm.Cluster.ClusterID`, ADR-129).
- **Membership → label-carriers reported by that source**: compose/stack workloads, project-labeled networks/volumes, stack-labeled swarm services. NOT members: images (no project label — shared infra), engine, swarm nodes/secrets, standalone containers, shared `bridge`/`host`/`none` networks, external net/vols used-but-not-created by compose.
- **Enablement → reuse `scope.autoGroup`**: `false` freezes ALL auto-grouping for the source (source group + app groups). Per-dimension opt-outs deferred.
- **Provenance → columns on `component_groups`**: `autoSourceId UUID NULL` + `autoGroupKey TEXT NULL` (NULL key = the source's own group). Source groups backfill onto the same columns; `importer_sources.componentGroupId` migrates away; `autoSourceId IS NOT NULL` becomes the single auto-managed predicate.
- **Surface → generic join table, humans included**: group assignment accepts N groups per component; component payloads return `componentGroupIds: string[]`; no per-component auto-opt-out in v1.
- **Presentation**: name = label value verbatim; slug = `docker-app-{key-slug}-{hash12(sourceId:key)}`; description = provenance text; `teamOwnerId` = `NULL`.
- **Q: When an auto-group pass finds a component inside its own auto-managed group that fails that group's eligibility — including a human-placed membership — should it evict? → A: Yes — automation-owned eviction is retained *inside* auto-managed groups. Additive multi-membership changes who can hold memberships, not who owns each group's member set; a human who disagrees places the component in a different (human) group.**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Components belong to multiple groups (Priority: P1)

A component may be a member of any number of ComponentGroups — human-declared, source-auto, and app-auto — at the same time. Membership is a set, not a slot.

**Why this priority**: This is the model promotion everything else stands on; without it app groups cannot coexist with the source group and human groups they overlap.

**Independent Test**: assign one component to two groups (one human, one auto) and verify both memberships persist, render, and survive subsequent auto-group passes; verify component and group APIs expose the full membership set.

**Acceptance Scenarios**:

1. **Given** a component in a human-managed group, **When** an auto-group pass claims it for a source or app group, **Then** it remains in the human group AND gains the auto membership — nothing is evicted.
2. **Given** a component exclusively reported by source S carrying compose project `componode`, **When** passes run, **Then** it is a member of S's source group AND S's `componode` app group simultaneously.
3. **Given** any component, **When** its memberships are read via API or UI, **Then** all groups are returned (plural), not a single group.
4. **Given** a human editing a component's groups, **When** they assign two groups, **Then** both memberships persist and neither pass removes the other.

---

### User Story 2 - Docker applications arrive pre-grouped (Priority: P1)

After a successful Docker import, the catalog contains one auto-managed ComponentGroup per (source, compose project) and per (source, swarm stack) — each holding that application's workloads plus its dedicated networks and volumes.

**Why this priority**: This is the feature's user-facing value — "the componode app" becomes a first-class, `DEPENDS_ON`-able unit instead of N manually-identified components.

**Independent Test**: complete a Docker import against an engine running two compose projects and one swarm stack; verify one app group per project/stack per source, membership equals the label-carrier set, and groups are discoverable through the normal component-groups API/UI.

**Acceptance Scenarios**:

1. **Given** a completed Docker run on an engine with compose project `componode` (services app/caddy/postgres + `componode_default` network + `postgres_data`/`caddy_data` volumes), **When** the pass executes, **Then** a `componode` app group exists containing exactly those labeled components.
2. **Given** a swarm stack `payments` with three services, **When** the pass executes, **Then** a `payments` app group exists containing the three stack-labeled services.
3. **Given** a second compose project `docker-tls-proxy` on the same engine, **When** the pass executes, **Then** it produces a separate app group — projects never merge.
4. **Given** components with no app-boundary label (engine, standalone containers, `bridge`/`host`/`none` networks, unlabeled volumes, images), **When** the pass executes, **Then** they gain NO app-group membership — they remain source-group members only.
5. **Given** the same compose project `componode` on two different Docker sources, **When** passes execute, **Then** two distinct app groups exist (one per source) and a shared `compose:componode:app` component joins both.

---

### User Story 3 - Auto-managed guards and derived lifecycle cover app groups (Priority: P2)

App groups are ordinary `component_groups` rows with the same honesty guarantees as source groups: derived lifecycle, rename/re-describe/re-own allowed, lifecycle writes and deletes rejected.

**Why this priority**: Trust in automation depends on humans being unable to silently contradict derived state; the guard must recognize app groups as auto-managed, not just source groups.

**Independent Test**: scale a project's containers to zero (members retire) and verify the app group derives `RETIRED`; PATCH lifecycle and DELETE on an app group and verify controlled conflicts while name edits succeed.

**Acceptance Scenarios**:

1. **Given** an app group with ≥1 `ACTIVE` member, **When** a pass runs, **Then** lifecycle is `ACTIVE`; **given** zero active members, **Then** `RETIRED`.
2. **Given** an app-managed group, **When** a human PATCHes `lifecycle` or DELETEs it, **Then** the API rejects with the controlled `GROUP_AUTO_MANAGED` conflict; name/description/teamOwnerId edits succeed.
3. **Given** a `RETIRED` source, **When** `retireSource` completes, **Then** its app groups evict all members and derive `RETIRED` while the group rows and provenance links survive for reactivation.
4. **Given** an opted-out source (`autoGroup: false`), **When** passes run, **Then** its app groups freeze exactly as-is — members, lifecycle, links untouched.

---

### User Story 4 - Operators understand provenance and control participation (Priority: P2)

Group naming, description, and the config opt-out make app groups self-explanatory: which source and which application boundary each represents, and how to disable the automation per source.

**Why this priority**: Automation without provenance or an off switch erodes trust; cheap because the provenance columns already exist.

**Independent Test**: inspect a created app group's fields (name = project label, deterministic slug, description names source + project, teamOwnerId null); create a config with `autoGroup: false`, run it, verify no app groups are maintained for its source.

**Acceptance Scenarios**:

1. **Given** `autoGroup` absent or `true`, **When** a run completes, **Then** the source's app groups are created/maintained alongside its source group.
2. **Given** `autoGroup: false`, **When** a run completes, **Then** no app groups are created and existing ones for that source freeze.
3. **Given** a created app group, **When** its fields are inspected, **Then** name equals the project/stack label, slug matches `docker-app-{key}-{hash}` deterministically, description names the source identity and key, and teamOwnerId is null.

---

### Edge Cases

- **Shared compose component on two engines** — `compose:{project}:{service}` is a global identity; the component joins EACH reporting source's app group for that project (multi-membership).
- **Compose project and swarm stack with the same name on one source** — distinct key namespaces (`compose-project` vs `swarm-stack`) produce distinct groups; names may cosmetically collide.
- **Project scaled to zero** — all members' instances stop; components retire; app group derives `RETIRED` but the row persists (same as source groups).
- **Project renamed/re-labeled** — compose identity is `{project}:{service}` so a rename yields new components; the old project's members lose their label-carrier status and evict on the next pass; the emptied group derives `RETIRED`.
- **Component loses its label but stays reported** (e.g. service recreated without compose labels → becomes standalone identity anyway) — label-carrier check fails → evicted from app groups next pass.
- **UNMONITORED source** — no runs; app groups freeze until reactivation re-evaluates (same as source groups).
- **Pass failure** — logged + metric-counted, never thrown into host run or source operation; next trigger recomputes fully (idempotent).
- **Pre-existing catalog** — first pass after deploy retroactively creates app groups for existing labeled components; no data migration of memberships needed beyond the join-table backfill.
- **Human places an app-claimed component in another group** — allowed and preserved; auto-membership is additive, never exclusive.
- **Human places an ineligible component inside an auto group** — evicted on the next pass; the auto group is automation-owned and its member set is fully derived (spec-067 rule carried forward to app groups).
- **Image components** — never join app groups in v1 (no project label; shared infra). Image lineage is a deferred axis.
- **External network/volume attached to compose services** — carries no project label (not created by compose) → stays source-group-only, correctly treated as shared infra.
- **Slug collision** — deterministic template + unique constraint; numeric suffix resolves, FK/provenance link is authoritative.

## Requirements *(mandatory)*

### Functional Requirements

**Multi-membership model**

- **FR-001**: Component↔group membership MUST become multi-valued via a join table; `components.componentGroupId` MUST be migrated (backfill + drop) and all membership reads/writes MUST use the join table.
- **FR-002**: Component API payloads MUST expose all group memberships (plural); group assignment MUST accept multiple groups per component for humans and auto passes alike.
- **FR-003**: Auto-membership MUST be purely additive across groups — passes MUST NOT evict a component from groups they do not own, and MUST NOT remove human or other-auto memberships when adding their own. Within groups they DO own, passes MUST still evict members that fail that group's eligibility rules, including human-placed ones (the group is automation-owned).
- **FR-004**: The source-group pass MUST continue to maintain exactly one group per source with the sole-effective-active-reporter rule — unchanged semantics, now coexisting with app memberships.

**App-level auto groups**

- **FR-005**: The backend MUST provide a generic label-scoped grouping capability: importers declare it in their manifest and supply a strategy extracting app-boundary group keys from persisted component data; the pass framework stays provider-agnostic.
- **FR-006**: The Docker importer MUST adopt the capability; its strategy MUST extract compose-project keys (`details.composeProject` on workloads, `details.labels["com.docker.compose.project"]` on networks/volumes) and swarm-stack keys (`details.stack` on swarm services).
- **FR-007**: App group identity MUST be per-source: `(sourceId, kind, key)` with kind ∈ {compose-project, swarm-stack}; identical project names on different sources MUST produce distinct groups.
- **FR-008**: App-group membership MUST include only components reported (effective-active) by that source AND carrying the matching app-boundary label — workloads, project-labeled networks/volumes, stack-labeled swarm services. Images, engine, swarm nodes/secrets, standalone containers, and unlabeled/shared infra MUST NOT join.
- **FR-009**: Membership evaluation MUST be a full idempotent recompute on the same triggers as source groups (completed Hub/Agent runs, `retireSource`, `reactivateSource`), failure-isolated.
- **FR-010**: `component_groups` MUST gain `autoSourceId` (nullable FK → `importer_sources`) and `autoGroupKey` (nullable text; NULL = the source's own group); existing source groups MUST be backfilled and `importer_sources.componentGroupId` MUST be removed.
- **FR-011**: `autoSourceId IS NOT NULL` MUST be the single auto-managed predicate driving `GROUP_AUTO_MANAGED` rejection of lifecycle writes and deletes — covering source AND app groups.

**Lifecycle, enablement, identity**

- **FR-012**: App-group lifecycle MUST derive `ACTIVE` iff ≥1 member component is `ACTIVE`, else `RETIRED`; `RETIRED` sources get cleanup-only evaluation (evict all, derive `RETIRED`, keep link); `UNMONITORED`/opted-out sources freeze.
- **FR-013**: `scope.autoGroup: false` MUST freeze all auto-grouping for the source — source group and app groups alike.
- **FR-014**: App group `name` MUST equal the project/stack label value; `slug` MUST be deterministic `docker-app-{key-slug}-{hash12(sourceId:key)}`; `description` MUST record source + key provenance; `teamOwnerId` MUST be `NULL`.
- **FR-015**: Auto groups MUST remain ordinary `component_groups` rows — `DEPENDS_ON` group edges, read-time expansion, coverage suppression, and suggestion supersession work unchanged.

**Boundaries**

- **FR-016**: This feature MUST NOT change the importer contract — no `DiscoveredAsset` field, no importer-declared groups or edges (constitution V).
- **FR-017**: This feature MUST NOT create or modify product edges; group `DEPENDS_ON` wiring remains human-authored.
- **FR-018**: Implementation MUST update `docs/openapi.yaml` for membership-array payloads and any new conflict responses (ADR-104), regenerate `docs/api.md`, update `docs/using-the-catalog.md` and `docs/importers/docker.md`, and record the ADR-129 amendment (multi-membership + provenance columns supersede its single-group-per-source link).
- **FR-019**: Test-first development applies; coverage MUST include unit tests for membership reduction and strategy extraction, integration tests for both group types across Hub/Agent paths and retire/reactivate, API contract tests, and Playwright specs for the changed surfaces per AGENTS.md.

### Key Entities *(include if feature involves data)*

- **`component_group_members`** (new table): `(componentId, groupId)` membership join — the single membership store for human and auto groups.
- **`component_groups.autoSourceId` / `autoGroupKey`** (new columns): provenance link to `importer_sources`; `autoGroupKey` NULL = source's own group, `compose:{project}`/`stack:{name}` = app group.
- **App-level auto ComponentGroup**: ordinary `component_groups` row provisioned per (source, app-boundary key); membership = label-carriers effective-active-reported by that source.
- **Label-scoped grouping strategy**: per-importer declaration (manifest capability + group-key extractor over persisted `details`) consumed by the generic pass.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any successful run of an enabled Docker source, every compose-project and swarm-stack label-carrier reported by that source is a member of exactly the matching app group(s) — 100% match, verified by tests.
- **SC-002**: Zero components lose human-group memberships or memberships in groups they were not evicted from, across all pass triggers.
- **SC-003**: A component's membership count is unbounded — verified: one component simultaneously in 1 human + 1 source-auto + N app-auto groups.
- **SC-004**: App-group lifecycle matches the derived rule after every trigger — no stale `ACTIVE` empty groups, no `RETIRED` groups with active members.
- **SC-005**: `autoGroup: false` sources gain/lose zero memberships of any kind; disabling never tears down any group.
- **SC-006**: Grouping pass failures produce zero run failures and zero source-operation failures across Hub and Agent paths.
- **SC-007**: All existing single-group read paths (component detail, group detail, `DEPENDS_ON` expansion, coverage, suggestions) return correct results for multi-member components — verified by integration + Playwright coverage.

## Assumptions

- Compose-project and swarm-stack are distinct key namespaces even on name collision (no cross-kind merge).
- App-group membership requires effective-active reporting by the owning source — a label-carrier reported only by other sources joins THEIR app groups, not this one.
- `componentGroupId` removal includes updating every reader/writer; API shape changes are breaking-but-internal (openapi.yaml is the contract of record).
- The join-table backfill + first grouping pass are one migration + one recompute; no membership data migration beyond backfill.
- Other importers are unaffected — they neither declare the capability nor have label-carriers; their components simply never join app groups.
- Human multi-assign UI ships in this feature (the API accepts N groups; the frontend exposes it) — single-assign UI would silently drop memberships.
