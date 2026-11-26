# Components Depending on Other Components Research

**Purpose:** Assess how Componode can automatically capture and present
infrastructure support relationships between Components, so product owners can
declare the workload they know about without manually wiring every underlying
host, network, and storage dependency.

**Scope:** Component-to-Component dependency and topology, Product and
ComponentGroup interaction, importer collection, and user-facing presentation.
This research is informative and proposes an architecture for review; it does
not amend ratified ADRs or authorize implementation. Reviewed 2026-11-25.

## Executive summary

The user need is valid: a product owner may know that a Digital Product depends
on `payments-vm-01` without knowing that the VM currently runs on
`pve-node-03`, uses `ceph-rbd-prod`, and is attached to `vmbr20`. Requiring
people to curate every infrastructure layer would make the catalog incomplete
and impose work on people who do not know those details.

Recommended direction:

1. Keep the human-curated boundary at the product level. A person declares the
   Digital Product's direct dependency on a known Component or ComponentGroup.
   Importers do not create product hierarchy or product-to-component edges.
2. Let an authoritative infrastructure Importer automatically report
   provider-evidenced Component relationships, with Source/run provenance and
   source-scoped reconciliation.
3. Distinguish causal `DEPENDS_ON` relationships from topology facts such as
   “runs on,” “backed by,” and “connected to.” A VM's current host placement is
   not always equivalent to a hard availability dependency, especially with
   HA and live migration.
4. Show the declared Product dependency first and keep imported support
   infrastructure in a collapsed, clearly labeled “Supporting infrastructure”
   view. Show relation type, source, and last-observed freshness. Do not insert
   these nodes into the Digital Product `COMPOSES` hierarchy.
5. Do not change the existing Product health rollup to traverse supporting
   infrastructure implicitly. It currently uses direct Component dependencies;
   a topology/impact view can explain the support chain without implying that
   every underlying node's state is the Product's health.

The main architecture choice to grill is whether each imported infrastructure
fact belongs in the existing `DEPENDS_ON` relation or in separate typed
topology relations. This research recommends keeping those meanings distinct
and extending the typed relationship model only for provider facts that the
catalog needs to traverse.

## Domain language and current constraints

Componode distinguishes:

- A **Digital Product**: a curated, human-authored application, capability, or
  shared platform. It is not an imported Component.
- A **Component**: an imported building block, such as a VM, host, storage
  system, or network.
- A **Component Instance**: the operational occurrence of a Component in an
  environment, including its current status.
- A **ComponentGroup**: a set of Components, human-declared or automatically
  provisioned under source/app grouping rules.
- `COMPOSES`: a DigitalProduct-to-DigitalProduct relationship in the curated
  product hierarchy.
- `CONSUMES_FROM`: a Product-to-`PLATFORM`-Product relationship, distinct from
  `COMPOSES`.
- `DEPENDS_ON_COMPONENT`: a Product-to-Component or Product-to-ComponentGroup
  dependency.

The word “platform” is overloaded here. A **platform technology** (for
example, Proxmox VE or Kubernetes) is a provider/source. A `PLATFORM` is a
DigitalProduct type in Componode. They should not be conflated in UI copy or
relationship design.

Relevant existing contracts and decisions:

- Product dependencies can target a Component or ComponentGroup. A group edge
  expands to its members at read time and remains a single stored Product
  dependency; it is not an edge between every member. See
  [ADR-110](./adrs/ADR-110-product-dependency-on-component-group.md).
- Product health is a derived rollup over direct Component dependencies
  (including Components expanded from a directly referenced group). It does
  not transitively roll through `CONSUMES_FROM`. See
  [ADR-112](./adrs/ADR-112-product-health-rollup.md).
- Component relationships are currently `DEPENDS_ON`, `SOURCES_FROM`, and
  `EXPOSES`; the graph is stored in typed junction tables, not a polymorphic
  `edges` table. See [ADR-016](./adrs/ADR-016-component-component-relationships.md)
  and [ADR-048](./adrs/ADR-048-graph-relationship-persistence.md).
- Importer-declared Component edges are supported behind a per-config opt-in.
  `DEPENDS_ON`, `SOURCES_FROM`, and `EXPOSES` declarations target Components
  yielded in the same run; completed runs reconcile importer-declared edges
  source-scoped, and users can suppress an importer edge so it is not recreated.
  Product edges remain human-curated. See
  [ADR-133](./adrs/ADR-133-importer-declared-component-edges.md) and
  [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md).
- The current Component Relationships UI is a read-only, one-hop view with
  progressive disclosure. It explicitly says that it does not infer or create
  relationships. See [ADR-128](./adrs/ADR-128-component-relationship-read-view.md).
- Source-scoped auto ComponentGroups and app-level auto-groups already reduce
  manual membership maintenance. They are groups, not dependency edges or
  nested topology. See [ADR-129](./adrs/ADR-129-source-scoped-auto-component-groups.md).
- Server-generated Product-to-Component edge suggestions are an existing
  human-decision mechanism for uncertain matches. Decided pairs are terminal;
  suggestions are not automatically accepted. See
  [ADR-113](./adrs/ADR-113-staged-edge-suggestions.md).

## The design problem

There are two different reasons to connect Components:

1. **Causal dependency:** a problem with the target may affect the dependent
   Component. Example: an application Component depends on a VM that hosts its
   runtime.
2. **Provider topology/placement:** the source says where or how a Component
   is attached, without claiming that the target's failure necessarily makes
   the dependent unavailable. Example: a VM currently runs on a PVE node, or
   its virtual NIC is attached to a bridge.

These may overlap, but they are not interchangeable. In particular, a
“currently runs on” relation can change during migration or failover. A VM's
placement on a node is an important topology fact, but a cluster may restart
or migrate it elsewhere after that node fails. Likewise, a network interface
being attached to a named network is not by itself proof that every service
running in the VM depends on every resource in that network.

The imported relationship should retain what the provider actually reported.
Do not turn a location or attachment fact into a causal dependency merely to
reuse the existing `DEPENDS_ON` edge.

## Recommended architecture

### 1. Keep Product authoring human-curated and shallow

The user continues to express the meaningful business-level dependency they
understand:

```text
Payments DigitalProduct
  └─ DEPENDS_ON_COMPONENT (curated) → payments-vm-01 Component
```

The importer adds provider facts below that Component:

```text
payments-vm-01
  ├─ RUNS_ON     → pve-node-03
  ├─ BACKED_BY   → ceph-rbd-prod
  └─ CONNECTED_TO → vmbr20
```

The names above are illustrative relationship labels, not ratified enum
values. The UI must distinguish the user's direct dependency from the
provider-reported support topology. A user who does not know the hypervisor
topology can stop at the VM.

Do not generate `COMPOSES`, `CONSUMES_FROM`, or Product-to-Component edges
from imported infrastructure. The Product's business meaning and the
provider's observed topology are different layers. An importer may provide
candidate signals for human review where evidence is weak, but it must not
automatically author Product structure.

### 2. Use importer evidence for automatic Component relationships

For authoritative provider facts, collection should produce the Component
inventory and its relationship declarations in the same run. For a Proxmox
Importer, that means yielding the VM and any discovered node, storage, or
network Component that the provider relationship targets. The core then
resolves the provider-native IDs and materializes a typed relationship with
ImporterSource and run provenance.

Follow the existing importer pattern where it fits:

- An importer declares an edge only when its manifest/config enables that
  edge family.
- Targets must be resolved, yielded Components; never create a dangling
  relationship from an unverified name or arbitrary text field.
- The importer reports Source identity before the first yield, even for an
  empty inventory.
- A completed, authoritative run can retire that Source's no-longer-reported
  relationship claims. Failed, cancelled, or incomplete runs must not retire
  topology.
- Preserve provenance so users can inspect “reported by Proxmox, observed in
  run …”. Make importer-generated relations suppressible by an authorized
  user, following the existing veto model.

The current `relationships[]` contract only targets assets yielded in the same
run. This is a good fail-closed boundary for a Proxmox cluster inventory where
the VM and its host are collected together. It does not cover a relationship
whose target is known only to a different ImporterSource. Cross-Source
relationship resolution and independent claims from multiple Sources require
an explicit design rather than silently relaxing same-run resolution.

### 3. Preserve relationship semantics

Two viable designs should be compared during grilling:

| Design | Benefits | Risks |
| --- | --- | --- |
| Use existing `DEPENDS_ON` for every support edge | Smallest implementation; existing Product health, relationship read paths, and edge suppression already understand it | Overstates causality for placement/attachment; can make users infer that a VM hard-depends on its current node despite HA or migration |
| Keep `DEPENDS_ON` for causal dependencies and add typed topology relations (recommended) | Distinguishes “will this failure affect availability?” from “where is this Component currently hosted/attached?”; clearer labels and impact semantics | Requires additional typed relationship persistence, API/read contracts, importer opt-in, provenance/reconciliation rules, and UI treatment |

The recommended direction is the second design, with a deliberately small
initial relation set chosen from actual importer evidence. Candidates:

- `RUNS_ON`: guest VM → current host/node.
- `BACKED_BY`: VM/disk → storage Component, when the provider exposes a stable
  storage identity.
- `CONNECTED_TO`: VM/NIC → network Component, when that network is actually
  inventoried as a Component.
- `DEPENDS_ON`: only for an evidenced causal dependency whose failure can
  affect the dependent Component; retain its existing meaning.

These names and distinctions are proposed, not decisions. A VM may have
multiple disks/storage targets or NICs/networks; represent distinct targets
without flattening away per-disk/NIC evidence. Relation direction should be
consistent and readable, e.g. “VM runs on node” and “VM is backed by storage.”

If these relation families are added, keep them typed and relational, in line
with ADR-048. Do not introduce a generic polymorphic `edges` table just to
avoid choosing semantics. The precise storage model, inverse labels,
constraints, and cycle policy are open design questions.

### 4. Treat ComponentGroups as selectors, not topology

A ComponentGroup answers “which Components belong to this set?” It does not
mean that every member depends on every other member, nor should it imply
parent/child topology.

- If a Product depends on a ComponentGroup, its direct dependency view should
  expand the group members (as it does today), then show each member's imported
  support relations beneath it.
- Source-scoped auto-groups can make it easy to reference a provider inventory,
  but a group containing every node, guest, and storage Component may be too
  broad to serve as a Product's primary dependency. Prefer a Product dependency
  on the specific known VM or on a deliberate workload/app group.
- App-level auto-groups can identify workload boundaries when a provider
  exposes a stable app/project/stack key. Infrastructure Components should
  appear as support links to those workload roots, not be inserted into the
  app group merely because they share the same Source.
- Assigning a Component to a group should not manufacture `DEPENDS_ON` edges.
  Group membership is not dependency evidence.

### 5. Keep Product types and product relationships distinct

- A Business or Customer-facing DigitalProduct can depend on its known VM
  Component. Provider topology can be expanded below that VM for context.
- A `PLATFORM` DigitalProduct can depend on a VM or ComponentGroup and expose
  its own support topology. A consumer's `CONSUMES_FROM` edge should remain a
  curated Product-to-Product relationship; do not clone all of the platform
  Product's Component and infrastructure edges onto each consumer.
- `COMPOSES` remains the human-authored DigitalProduct hierarchy. Supporting
  infrastructure is not a child Product and should not appear as if it were
  part of the product composition tree.
- Product health continues to use its declared direct Component/ComponentGroup
  dependencies unless a separate ADR explicitly changes the health contract.
  The support graph may provide navigation or impact context, but must not
  silently make every host/network/storage status a direct Product health
  input. This preserves ADR-112 and avoids repeated or misleading rollups.

## User presentation proposal

Use an anchored, progressive-disclosure topology rather than expanding every
Product into a deep graph by default. A possible Product detail section:

```text
Direct dependencies
  payments-vm-01                 COMPUTE · Proxmox · RUNNING
    Supporting infrastructure (3)  [collapsed]
      Runs on       pve-node-03      RUNNING · observed by Proxmox
      Backed by     ceph-rbd-prod    available · observed by Proxmox
      Connected to  vmbr20           available · observed by Proxmox
```

Recommended interaction:

- The default Product page shows only the direct Component or ComponentGroup
  dependencies the user curated. Each direct row provides a small
  “Supporting infrastructure (N)” affordance only when imported relations
  exist.
- Expanding it reveals a bounded tree rooted at the direct dependency, with
  explicit relation labels, provider/category, current status when known,
  ImporterSource, and last-observed time. Label the section “Supporting
  infrastructure” or “Observed topology,” never “Composes.”
- Cap initial depth (for example, one or two support hops) and provide
  “Show more” for deeper/cyclic/shared graphs. Deduplicate a shared support
  Component in the rendered view while retaining all paths and relation
  labels.
- Clicking a support Component opens its existing detail and Relationships
  view. The existing read-only one-hop relationship panel can provide the
  deeper investigation surface.
- Distinguish curated edges from imported observations with a provenance badge
  and accessible visual treatment; do not rely on color alone.
- An import outage or stale Source should be visible as freshness/availability
  context. Do not interpret an absent edge from a failed run as proof that the
  relationship ended.
- Keep a meaningful empty state: “No supporting infrastructure reported” is
  different from “No dependencies configured.”
- Expose impact analysis in the reverse direction only if the UI can explain
  the path and relation semantics. Do not imply that current placement always
  proves a failure dependency.

This matches the general pattern of a context-anchored topology: Broadcom
Tanzu Hub describes application views that show only relevant hosting
foundations and underlying VCF infrastructure; it also supports a focused
anchor rather than requiring users to navigate the entire estate. AWS
Application Discovery Service documents collecting server profiles and
network connections and using discovered dependencies to help group servers
into applications. AWS notes that Application Discovery Service is no longer
open to new customers, so it is cited as a design precedent, not a
current-product recommendation. These examples support progressive,
evidence-backed topology, not an unbounded default graph.

## Risks and unresolved technical questions

### Reconciliation and evidence

- **Provider identity:** Can the provider supply stable IDs for the host,
  storage, network, disk, and attachment targets? Names alone are not reliable
  edge keys.
- **Placement versus dependency:** Does a particular relation mean “currently
  placed on,” “configured to use,” “required for service,” or only “observed
  communicating with”? The API facts and UI label must agree.
- **Run completeness:** Does a run collect all targets needed to make its
  declared relationship set authoritative? Relationship absence must not erase
  prior data after partial collection.
- **Multi-Source reporters:** Current importer edge storage has one
  provenance-bearing row per pair and retains the first writer on conflict.
  If two Sources independently report the same relation, one Source's
  reconciliation must not erase the other Source's still-valid claim. Options
  include one authoritative Source per relation family or a separate
  Source-scoped claim layer.
- **Multiple instances:** A logical VM Component may have multiple Instances.
  A relation based on the current host should usually be Instance-scoped, not
  only Component-scoped, if different environments or clusters can place it
  differently. The current Component edge contract is Component-to-Component;
  this scope mismatch needs resolution before implementing placement edges.
- **Shared infrastructure:** A single storage or network Component may support
  many VMs. Retiring one VM's membership or edge must not retire infrastructure
  still reported/used by another.
- **Suppression:** Should a user be allowed to suppress a factually accurate
  provider edge? A suppression is a presentation/catalog veto, not a change to
  the provider's source data. Should it be per Source, per relation pair, or
  per Product view?
- **Evidence class:** Provider configuration (for example, a VM disk mapped to
  storage) is generally stronger than inferred network traffic. Should
  low-confidence observations become staged suggestions, while explicit
  provider configuration becomes an automatic topology edge?

### User intent and scale

- Can the user choose “show support topology” at a Product, ProductGroup, or
  entire catalog level? Which default keeps the Product page useful without
  hiding important operational context?
- How should support details inherit across `COMPOSES` child Products and
  `CONSUMES_FROM` platform Products: navigation only, or any derived display
  aggregation? The current Product health contract explicitly avoids some
  transitive rollups.
- How should Components from an auto-group be selected as dependency roots:
  group as a single dependency, individual members, or a user-selected subset?
- What is the right max depth, node count, and truncation behavior for a
  Product depending on a group with hundreds or thousands of members?
- How should a provider failover/migration appear when the VM remains healthy
  but its `RUNS_ON` target changes between runs?

## Grill-ready decisions

1. Is the target concept only causal `DEPENDS_ON`, or should the catalog model
   a separate class of provider-reported topology facts?
2. Do we want `RUNS_ON`, `BACKED_BY`, and `CONNECTED_TO` as separate typed
   relationships, or a smaller initial set? What exact user-facing verbs and
   directions do we ratify?
3. Should importer-reported topology be opt-in per ImporterConfig, enabled by
   default for authoritative provider facts, or configurable per relation
   family?
4. Which relation facts are Component-scoped versus ComponentInstance-scoped?
   How do multiple clusters/environments and guest migrations affect identity?
5. Is same-run target resolution sufficient, or must the architecture support
   Source-owned claims to already-known Components from other runs/Sources?
6. How do multiple Sources reporting the same relationship contribute and
   reconcile independently?
7. Should an automatically collected host/storage/network be created as a
   first-class Component even if no user directly depends on it, or only when
   referenced by an in-scope workload?
8. What is the default Product UX: collapsed support tree, a separate
   “Topology” tab, or an explicit toggle? How much should be visible without
   interaction?
9. Does support topology affect Product health or attention alerts? If not,
   what label prevents users mistaking support status for the Product health
   calculation?
10. Should group-based Product dependencies expand support for every member,
    or can users choose a subset/anchor Component?
11. How should source-stale, inaccessible, or partially inventoried support
    relationships be represented without implying that they disappeared?
12. What policy governs importer edge suppression when the provider continues
    to report a relationship?

## Proposed implementation sequence

This is a future spec outline, not an implementation instruction.

1. Ratify terminology and edge semantics, including the distinction between
   causal dependency and placement/attachment topology.
2. Select an initial provider use case (Proxmox is a strong first case) and
   prove that its API provides stable IDs and sufficiently authoritative
   relationship evidence.
3. Decide whether existing `relationships[]` can safely represent the chosen
   edge types or whether new typed relationship tables/contracts are needed.
   Preserve ADR-048's typed relational model and ADR-133's provenance,
   opt-in, suppression, and source-scoped reconciliation principles.
4. Resolve Component-versus-ComponentInstance relationship scope and
   multi-Source claim ownership before migration design.
5. Define a bounded read model for a Product's direct dependencies plus
   progressive support paths. Preserve current Product health semantics
   unless separately ratified.
6. Prototype the anchored/collapsed Product UX with representative trees:
   one VM on one host; an HA VM that migrates; multiple VMs sharing storage;
   a group dependency; stale Source data; and duplicate relation claims from
   two ImporterSources.
7. Write ADR amendments and a spec-kit feature specification. The generated
   `tasks.md`, not this research note, must drive implementation.

## Primary sources

- [ServiceNow: CI relationships in the CMDB](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/c_CIRelationships.html)
  distinguishes dependent relationships from non-dependent relationships and
  describes `Depends on` as “Parent CI depends on child CI.”
- [ServiceNow: Server class](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/class-server.html)
  describes representing a VM Instance separately and connecting it to its
  host with `Hosted_On`.
- [ServiceNow: Cloud class](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/class-cloud.html)
  gives a VM-to-compute `Runs on:Runs` relationship example and discusses
  connecting cloud compute with host OS identity.
- [Broadcom Tanzu Hub: Use topology views](https://techdocs.broadcom.com/us/en/vmware-tanzu/platform/tanzu-hub/10-4/tnz-hub/monitoring-using-topology.html)
  describes application-anchored views that show relevant services and
  underlying infrastructure for the hosting foundation.
- [AWS Application Discovery Service User Guide](https://docs.aws.amazon.com/application-discovery/latest/userguide/what-is-appdiscovery.html)
  describes discovering server profiles and network dependencies and grouping
  discovered servers into applications for migration planning.

## Componode references

- [CONTEXT.md](../CONTEXT.md) — canonical terms for Digital Products,
  Components, Component Instances, ComponentGroups, and product relationships.
- [ADR-016](./adrs/ADR-016-component-component-relationships.md) and
  [ADR-048](./adrs/ADR-048-graph-relationship-persistence.md) — current
  Component relation semantics and typed relational persistence.
- [ADR-110](./adrs/ADR-110-product-dependency-on-component-group.md),
  [ADR-112](./adrs/ADR-112-product-health-rollup.md), and
  [ADR-113](./adrs/ADR-113-staged-edge-suggestions.md) — group dependencies,
  direct Product health, and human-reviewed candidates.
- [ADR-128](./adrs/ADR-128-component-relationship-read-view.md) and
  [ADR-129](./adrs/ADR-129-source-scoped-auto-component-groups.md) — current
  relationship UI and automatic ComponentGroup behavior.
- [ADR-133](./adrs/ADR-133-importer-declared-component-edges.md) and
  [ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md) — opted-in
  importer edges, provenance, Source identity, and reconciliation.
