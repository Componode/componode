# Research: Source-scoped auto ComponentGroups — grilling record

**Status**: Ratified design (2026-11-07, two rounds, 16 decisions)
**Governing ADR**: [ADR-129](../../researches/adrs/ADR-129-source-scoped-auto-component-groups.md)
**Spec**: [spec.md](./spec.md) (Draft)

This document records the design exploration and grilling session that
produced ADR-129. It is the rationale trail, not an implementation plan —
`plan.md`/`tasks.md`/`contracts/` are deferred to `speckit-plan` when the
feature is scheduled.

## Origin

A Docker importer user asked whether the `docker-engine` COMPUTE component
(spec 064) could automatically be "part of the parent products or component
groups that a container running on it is part of." Investigation established:

- The engine component exists and is cataloged, but **no mechanism attaches
  it (or any imported component) to groups automatically** — group
  membership is a single `components.componentGroupId` FK set only by human
  PATCH.
- Importers cannot declare relationships (`DiscoveredAsset` has no
  `relationships[]` — ADR-057, constitution V).
- `product_depends_on_component_group` edges (ADR-110) already provide the
  payoff: one product edge covers a whole group at read time — but only if
  something populates the group.
- Edge suggestions (ADR-113) cover component pairs only, with three signals
  (name/tag/namespace) — no topology signal.

The design question became: can the backend derive ComponentGroup membership
from the durable `source_component_memberships` every importer already
writes (ADR-119/120)?

## What one Docker ImporterSource emits

| Asset | resourceType | externalId form | Source-bound? |
|---|---|---|---|
| Engine | `docker-engine` (COMPUTE) | `docker-engine:{info.ID}` — *is* the source identity | yes |
| Swarm node | `swarm-node` (COMPUTE) | `docker-engine:{id}::swarm-node:{name}` | yes |
| Swarm service | `swarm-service` (CONTAINER_ORCHESTRATION) | `docker-engine:{id}::swarm-service:{name}` | yes |
| Swarm secret | `swarm-secret` (SECRET) | `docker-engine:{id}::swarm-secret:{name}` | yes |
| Standalone container | `container` (CONTAINER) | `docker-engine:{id}::{name}` | yes |
| Compose service | `compose-service` (CONTAINER) | `compose:{project}:{service}` | **no — shared across engines by design** |
| Override workload | `container` | `workload:{componentIdLabel}` | **no — shared** |
| Image | `image` (PACKAGE_REGISTRY) | `docker-image:{repo}@{ref}` | **no — shared** |

Two structural facts drive the design:

1. **Every asset gets a `source_component_memberships` row — including
   shared ones.** A compose service on two clusters has two active
   memberships. The membership table, not `externalId`, is the authoritative
   "which source reported this" record.
2. **`components.componentGroupId` is single-valued.** A component can be
   in exactly one group — shared components cannot belong to two cluster
   groups simultaneously.

"Cluster" maps to **ImporterSource**: one swarm-manager endpoint sees every
node (`swarm-node` components *are* the hosts); a standalone engine is a
single-host group. True cross-endpoint cluster identity
(`info.Swarm.Cluster.ClusterID`) is a documented future refinement.

## Consistency check vs. prior research

Checked against `researches/docker-importer-plan.md` (binding constraints),
`researches/docker-importer-research.md` (confirmed mappings),
`researches/digital_product_concepts_review_research.md` (DPAM model), and
`researches/ComponodeImprovementOpportunitiesDevinResearchandPlanningBrief.md`
(P1-1 impact views).

**Consistent**:

- Importer contract untouched — groups are server-side derivation from
  stored memberships (ADR-113 precedent: "generated server-side from stored
  import data, not yielded by importers"). `docker-importer-plan.md`'s
  "ComponentGroup … is not an importer-created folder/project" holds in
  letter (backend-created, not importer-created).
- Products and edges stay human-authored — "no auto-derived product
  hierarchy" non-goal stands; group *membership* is a component attribute,
  not an edge.
- Shared-component handling completes the plan's deliberate canonical
  `compose:{project}:{service}` identity decision — shared Components stay
  shared; they simply can't satisfy the sole-reporter rule.
- Reuses `source_component_memberships` — the exact provenance layer
  ADR-119/120 built.

**Deltas the ADR owns explicitly**:

1. **Letter vs. spirit on "not importer-created"** — catalog structure now
   appears from import data automatically → ADR-082 amendment
   (system-provisioned groups).
2. **Semantic stretch: equivalence → membership** — ADR-082 framed groups
   as human-declared *equivalence*; auto-groups are derived *membership*
   sets. ADR-110's per-account example already bent the concept toward
   dependency-bundling — reuse deliberate, named in ADR-129.
3. **Suggestion suppression** — group coverage tombstones pending
   suggestions `SUPERSEDED`; auto-provisioning legitimately reduces the
   human decision surface → recorded as ADR-129 consequence.

## Grilling record — Round 1 (top-level forks)

| # | Question | Decision |
|---|---|---|
| Q1 | Generic mechanism vs docker-only | **Generic** post-run pass keyed on `sourceId`; Docker first strategy |
| Q2 | Group contents | **Full source footprint** (engine, nodes, services, secrets, standalone containers + exclusive shared-type components) |
| Q3 | Group identity/link | **`importer_sources.componentGroupId` FK** (new nullable column) — durable, rename-proof |
| Q4 | Write path | **Post-run failure-isolated pass** beside `runSuggestionPass`; Hub + Agent; zero importer changes |
| Q5 | Human-conflict policy | **Null-or-ours** — never overwrite foreign human groups; owns own groups + unassigned |
| Q6 | Lifecycle | **Derived** (user chose c over never-auto-retire): `ACTIVE` iff ≥1 `ACTIVE` member |
| Q7 | Naming | **Both**: `name` = source label → engine-name fallback; `slug` = deterministic `docker-cluster-{hash12(sourceIdentity)}`; description = provenance; teamOwnerId null |
| Q8 | Same swarm, two endpoints | **Accepted per-source limitation**; `ClusterID` merging = future spec |
| Q9 | Packaging | **ADR-129** + amendments to ADR-082/ADR-019 + spec 067 docs; plan/tasks deferred |

## Grilling record — Round 2 (dependent decisions)

| # | Question | Decision |
|---|---|---|
| Q10 | Shared/multi-source components | **Strict sole-effective-reporter invariant**, recomputed fully each pass; evict-to-null on losing exclusivity |
| Q11 | Eligibility filter | **Pure rule, no resourceType allowlist** — exclusive images/secrets join; manual components never (no memberships) |
| Q12 | Enablement | **Manifest capability + `autoGroup?: boolean` default `true`** (opt-out); per-config flag, per-source group |
| Q13 | Human lifecycle writes | **Reject `lifecycle` PATCH on auto-managed groups** (controlled conflict); name/description/teamOwner editable |
| Q14 | Trigger coverage | **Hook `retireSource`/`reactivateSource`** — same pass, keeps derived state honest outside runs |
| Q15 | Naming/provenance | Confirmed Q7 details (name fallback chain, slug template, provenance description, null owner) |
| Q16 | Spec packaging | `spec.md` + `research.md` now; `plan.md`/`tasks.md`/contracts deferred to `speckit-plan` |

**Additional settled detail** (ordering): the grouping pass runs **before**
`runSuggestionPass` so group coverage suppresses stale component-pair
suggestions correctly.

## Refinements vs. the initial proposal

The grilled design is a strict refinement of the initial in-conversation
proposal — every delta is an improvement or clarification:

| Initial proposal | Grilled settlement | Delta |
|---|---|---|
| Slug find-or-create, "no new tables" | `importer_sources.componentGroupId` FK + migration | Rename-proof provenance; slug lookup breaks on human slug renames |
| Type-based exclusion (`skip compose-service/workload:/image`) | Sole-effective-reporter rule, no type filter | A compose service on *one* cluster legitimately joins; exclusion derived not hardcoded |
| Assign-only, sticky | Strict invariant with evict-to-null | Self-heals on topology change both directions |
| "Retire when source retires or zero members" | Fully derived lifecycle + API write-guard + retire/reactivate hooks | Bidirectional; covers the no-run retirement path |
| Docker-only framing | Generic mechanism, docker first | Broadening for future adopters |
| No enablement discussed | Manifest capability + `autoGroup` opt-out default-on | User control preserved |
| Group trigger ordering unspecified | Before `runSuggestionPass` | Suppression correctness |

**Edge the invariant creates** (recorded in spec): a human who manually
places an ineligible (shared/manual) component *inside* the auto-group is
evicted next pass — the group is automation-owned; its contents are
derived, not curated. Disagreement = move it to a human-managed group.

## Deferred / future

- `plan.md`, `tasks.md`, `contracts/` — `speckit-plan`/`speckit-tasks` when
  scheduled.
- UI surface (badge "auto-managed", dedicated view) — not in v1 scope.
- `Swarm.Cluster.ClusterID`-based cross-endpoint cluster merging —
  requires importer details change; separate spec.
- Other importer adopters (k8s, aws, …) — each opts in via own spec.
- Runtime verification of the missing `docker-engine` component on
  localhost:3000 was resolved separately (component now visible after a
  successful run on the 064 branch).
