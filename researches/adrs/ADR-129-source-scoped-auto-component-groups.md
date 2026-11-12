### ADR-129 — Source-scoped auto ComponentGroups

> **Status:** Ratified (2026-11-07 grilling, spec 067)
> **Supersedes**: none
> **Amends**: ADR-082, ADR-019, ADR-071 (see "Amendments to earlier ADRs")

**Context**: `ComponentGroup` (ADR-082) is human-declared — a curator creates
the group and assigns `components.componentGroupId` one PATCH at a time.
Products may depend on a group in one edge (ADR-110), which makes groups the
cheap way to wire "everything on this cluster" — but nothing populates them.
Every adopting importer already persists durable Source→Component
memberships (ADR-119/120), so the factual layer knows exactly which source
reported which component; the meaning layer starts empty. This is the same
manual-wiring labor ADR-113 attacked for `DEPENDS_ON` edges, one level down.

Two constraints bound the design. Importers cannot declare catalog structure
(`DiscoveredAsset` has no relationships field — ADR-057, constitution V), so
any automation must be **server-side derivation from stored memberships**,
the ADR-113 pattern. And `components.componentGroupId` is single-valued, so
a component reported by several sources (the deliberately shared
`compose:{project}:{service}`, `workload:{id}`, and `docker-image:{ref}`
identities) cannot belong to two cluster groups at once.

**Decision**:

1. **Source-scoped auto ComponentGroup** — for importers declaring the
   capability, each `ImporterSource` gets at most one system-provisioned
   `ComponentGroup`, linked durably by a new nullable
   `importer_sources.componentGroupId` FK → `component_groups`. The link is
   the provenance marker: it survives group renames (unlike a slug
   convention) and identifies auto-managed groups for the lifecycle guard
   below. One migration; no join table (multi-group-per-source is out of
   scope — promote later if needed).

2. **Membership invariant** — a component belongs to source S's auto-group
   **iff S is its sole effective-active reporter** (membership `active=true`
   AND source status `ACTIVE`/`UNMONITORED` — the ADR-036 A1 definition).
   The pass recomputes fully on every trigger: gaining exclusivity assigns,
   losing it — to a second reporter or to `GONE`/`RETIRED` — evicts to
   `NULL`. Components in *foreign* (human) groups are never touched: the
   assignment rule is null-or-ours (group `NULL` or already this source's
   auto-group). Because the group itself is automation-owned, a human who
   places an ineligible component inside it is overridden on the next pass —
   disagreement means moving it to a different, human-managed group.

3. **Trigger** — a failure-isolated post-run pass beside `runSuggestionPass`
   on completed Hub (`import-run-service`) and Agent
   (`remote-run-service`) runs, ordered **before** the suggestion pass so
   group coverage suppresses stale candidates correctly. `retireSource` /
   `reactivateSource` invoke the same evaluation for that source — source
   retirement retires components outside any run, and the derived lifecycle
   must not go stale. A pass failure is logged and metric-counted, never
   thrown into the host operation (ADR-113 wrapper precedent).

4. **Derived lifecycle** — the auto-group is `ACTIVE` iff ≥1 member
   component is `ACTIVE`, else `RETIRED`, recomputed each pass (mirrors
   ADR-082's rule as a derivation, not a convention). `updateComponentGroup`
   rejects `lifecycle` writes on auto-managed groups (detected via the
   `importer_sources.componentGroupId` link) with a controlled conflict —
   name/description/teamOwnerId stay editable; retiring the group means
   emptying it or retiring the source. `deleteComponentGroup` rejects
   auto-managed groups with the same `409 GROUP_AUTO_MANAGED` conflict
   (clarify-session decision): the group is retired via its source, never
   destroyed by hand — checked before the `REFERENCED` product-dependency
   guard.

5. **Enablement** — the importer manifest declares capability (e.g.
   `autoGroups: "source"`); the importer config scope gains
   `autoGroup?: boolean` **default `true`** (opt-out). Enablement is read
   from the source's **bound** config (`boundConfigId` is single-valued, so
   sequential binding means the most recently reporting config decides):
   `autoGroup: false` freezes the source's group exactly as-is — members,
   lifecycle, and link are never torn down — and maintenance resumes when
   an enabling config binds again. An **unbound** source (config deleted →
   `UNMONITORED`, `boundConfigId NULL`) has no scope to read and is skipped
   entirely: its group freezes until a config rebinds. A `RETIRED` source
   that is still bound and capable gets cleanup-only evaluation — every
   member loses exclusivity (the source is nobody's effective-active
   reporter), so members evict and lifecycle derives `RETIRED`; the link
   survives so reactivation resumes full maintenance.

6. **Identity** — `name` = ImporterSource `label` (already
   `info.Name ?? sourceKey` for docker) falling back to the engine
   component's name; `slug` = strategy-owned deterministic template
   (`docker-cluster-{hash12(sourceIdentity)}` for docker); `description`
   carries provenance text naming the source identity; `teamOwnerId` =
   `NULL`. Deterministic slug + FK link together make find-or-create
   idempotent across renames and re-runs.

7. **Eligibility — pure rule, no type filter** — every component whose sole
   effective-active reporter is the source joins, any category/provider.
   Exclusive `compose-service`/`workload:`/`image` components join (they
   genuinely live on only that cluster); components shared by ≥2 sources
   belong to no auto-group; manually created components never join (no
   source reports them).

8. **Docker strategy (first adopter)** — group contents = the whole source
   footprint: `docker-engine`, `swarm-node`, `swarm-service`,
   `swarm-secret`, standalone `container`, plus exclusive shared-type
   components per item 7. "Cluster" = ImporterSource: one swarm-manager
   endpoint already sees every node (`swarm-node` components *are* the
   hosts); a standalone engine is a single-host group.

**Amendments to earlier ADRs**:

- **ADR-082** (ComponentGroup): gains a second provisioning mode —
  system-provisioned, source-scoped groups — alongside human-declared
  groups. "Human-declared" is no longer the only origin; the lifecycle
  rule is extended so auto-managed groups derive `lifecycle` from member
  activity (item 4) rather than free edits.
- **ADR-019** (hierarchy authoring manual): `componentGroupId` assignment
  gains a system-derived path **for auto-managed groups only**. Product
  hierarchy and every edge type remain human-decided — a group is a
  component attribute, not an edge; `product_depends_on_component_group`
  wiring stays manual.
- **ADR-071** (API error response format): the controlled `code` enum
  gains `GROUP_AUTO_MANAGED` (409) for lifecycle/delete writes rejected
  on system-provisioned groups.

**Consequences**: one migration (`importer_sources.componentGroupId`), a
provider-agnostic grouping service + strategy registry, hooks on both run
paths and source retire/reactivate, the `updateComponentGroup` lifecycle
guard, `docs/openapi.yaml` update for the new conflict response (ADR-104),
and importer manifest/config schema additions per adopter. Groups are
ordinary `component_groups` rows — group edges, read-time expansion,
coverage suppression, and UI all work unchanged.

- **Suggestion suppression (recorded, not a bug)**: once a product
  `DEPENDS_ON` an auto-group, components joining it become group-covered —
  their pending `DEPENDS_ON` suggestions tombstone `SUPERSEDED` per
  ADR-113. Auto-provisioning legitimately reduces the human decision
  surface; the ADR-113 rule is unchanged.
- **Semantic note**: ADR-082 framed groups as human-declared *equivalence*
  (Case B aliasing). Auto-groups are system-derived *membership* sets —
  ADR-110's per-account example already bent the concept toward
  dependency-bundling, so reuse is deliberate; a dedicated entity was
  rejected as heavier for the same read paths.
- **Accepted limitation**: grouping is per-Source. Two configs on managers
  of the *same* swarm yield two sources → two overlapping groups
  (different `/info.ID`s). True cluster identity via
  `info.Swarm.Cluster.ClusterID` is a documented future refinement
  requiring an importer details change — separate spec.
- **UNMONITORED sources** don't run, so their groups freeze as-is —
  consistent with frozen memberships; reactivation re-evaluates.

**Alternatives considered**: deterministic-slug find-or-create without the
FK — rejected (human slug renames orphan the convention → duplicate
groups); resourceType allowlist for eligibility — rejected (sole-reporter
is more precise and needs no per-strategy list); importer-declared group
field on `DiscoveredAsset` — rejected (contract + constitution-V amendment
for zero gain: `sourceId` already encodes the cluster 1:1); assign-only
sticky membership — rejected (cannot self-heal on topology change);
always-on with no config flag — rejected (users can see and disable);
virtual/derived groups at read time — rejected (cannot be `DEPENDS_ON`
targets without persisted rows).

---

**Spec**: `specs/067-auto-component-groups/` (Draft — implementation
scheduled separately via speckit-plan/tasks).

---

## Amendment — spec 070: multi-membership + app-level auto groups

Spec 070 promoted the single-valued membership model this ADR assumed:

- **`components.componentGroupId` → `component_group_members` join
  table.** A component may belong to any number of groups — human,
  source-auto, and app-auto simultaneously. Every group read path
  (component/group detail, `DEPENDS_ON` expansion, coverage suppression,
  edge-suggestion coverage, UI) resolves through the join table; API
  payloads expose `componentGroups[]` and accept `componentGroupIds[]`
  for HUMAN-managed memberships only.
- **Provenance moved onto `component_groups`:** `autoSourceId` +
  `autoGroupKey` replace `importer_sources.componentGroupId`. Every
  auto-managed group — source (`autoGroupKey IS NULL`) or app
  (`compose:{project}` / `stack:{name}`) — has exactly one owning source;
  `autoSourceId IS NOT NULL` is the sole `GROUP_AUTO_MANAGED` predicate.
- **App-level groups:** importers may additionally declare
  `autoAppGroups` and supply `appGroupKinds` strategies that extract
  boundary keys from persisted component `details`. Docker adopts
  Compose projects and Swarm stacks; membership requires effective-active
  reporting by the owning source AND a matching label carrier (workloads,
  project-labeled networks/volumes, stack services — never images,
  engine, nodes, or standalone containers). Groups are per-source:
  identical project names on different engines produce distinct groups.
- **Additive semantics:** auto passes own the member set of groups they
  provision — they evict ineligible members (including human-placed
  ones, per the spec-070 clarification) but never touch memberships in
  groups they don't own. Human writes replace only HUMAN-managed
  memberships; auto memberships are system-owned.
- **Deferred (unchanged):** topology-inferred clusters, image lineage,
  custom label keys, fleet-wide app identity, per-component auto
  opt-out, non-Docker adopters.
