# Spec Proposal — Docker App-Level Auto-Grouping

> **Status:** Grilled — all design decisions resolved (2026-11-10).
> **Date:** 2026-11-10
> **Builds on:** ADR-129 / spec 067 (source-scoped auto ComponentGroups),
> ADR-121 (docker importer contract), ADR-113 (staged edge suggestions).
> **Next step:** `speckit-specify` → plan → tasks → implement.

## 1. Context

Spec 067 shipped **source-scoped auto groups**: each `ImporterSource` whose
importer declares `autoGroups: "source"` gets at most one auto-managed
`ComponentGroup`, membership = components for which the source is the sole
effective-active reporter. Docker is the only adopter today.

Observed behavior (verified on a live catalog): the `docker-desktop` group
contains the engine, standalone containers, networks, volumes, and images —
a **flat per-engine bucket**. Compose projects are invisible as a unit:
`componode/app`, `componode/caddy`, `componode/postgres` sit beside
`docker-tls-proxy/proxy` and infra volumes with no grouping that reflects
the application boundary.

## 2. The gap

Docker's own management tools (Portainer, Rancher, `docker stack`) treat
the **application** — compose project / swarm stack — as the primary
grouping unit, with the engine/cluster as secondary infrastructure scope.
Componode currently has only the secondary scope. A platform engineer
asking "what makes up the `componode` app?" must mentally filter a flat
list; "what depends on the payments app?" cannot be expressed as a single
`DEPENDS_ON` target.

## 3. Available signals (verified persisted — no importer contract change)

| Signal | Engine source | Persisted at | Coverage |
|---|---|---|---|
| Compose project | container/network/volume label `com.docker.compose.project` | `components.details.composeProject` (workloads); `details.labels["com.docker.compose.project"]` (networks, volumes) | all compose workloads + their dedicated net/vols |
| Compose service | `com.docker.compose.service` | `details.composeService`, externalId `compose:{project}:{service}` | workloads |
| Swarm stack | service label `com.docker.stack.namespace` | `details.stack`, `sourceDetails.stack` | swarm services only |
| Topology | network attachments, volume mounts | `instances.rawConfig.networks`, `rawConfig.mounts` (`volume:{name}`), network `details.attachedContainers` | all containers |
| Image lineage | `docker-image:{repo@digest}` externalId; OCI `org.opencontainers.image.*` labels | `details.ociLabels`, name/externalId | images only |
| Engine identity | `/info` `ID`, `Swarm.Cluster.ClusterID` | importer source `externalIdentity`, engine `details` | source scope |

Identity asymmetry (verified): compose workloads use **global**
externalIds (`compose:{project}:{service}` — shared across engines);
networks/volumes/swarm services/images are source-qualified or
globally-deduped by ref. Non-signals (deliberately excluded): environment
(already a `ComponentInstance` dimension), `componode.component-id`
override (already identity-level dedup), engine facts (attributes).

## 4. Resolved decisions (grilling rounds 1–3, 2026-11-10)

### D1 — Coexistence model → **multi-membership join table**

Promote `components.componentGroupId` (single-valued) to a
`component_group_members`-style join table. A component may belong to
human + source-auto + app-auto groups simultaneously. The null-or-ours
tension disappears — auto-membership is purely additive; the
"human-parked" exclusion rule is retired (it existed only because
membership was single-valued). Every group read path moves from "the
group" to "the groups": component detail, group detail, `DEPENDS_ON`
expansion, coverage suppression, suggestions, UI badges/filters.

### D2 — Dimensions in scope → **compose project + swarm stack only**

Declared boundaries only. Topology-inferred clusters (B) and image
lineage (C) deferred to follow-up specs.

### D3 — Mechanism shape → **generic capability, docker-only adoption**

The pass framework (provenance, membership recompute, derived lifecycle)
is importer-agnostic; each importer declares the capability in its
manifest and supplies a strategy extracting its own group keys from
persisted `details`. Docker implements compose/stack; kubernetes could
adopt namespace/label grouping later with zero backend changes.
Constitution V preserved — `DiscoveredAsset` untouched.

### D4 — App group identity → **per-source**

Key = `(sourceId, projectKey)`. "componode on docker-desktop" ≠
"componode on remote-engine". Generic project names (`wordpress`, `app`)
collide constantly — global grouping would structurally merge unrelated
apps. A shared `compose:{project}:{service}` component joins *each*
reporting source's app group for that project (multi-membership makes
this natural). Fleet-wide app rollup deferred — same class as
`Swarm.Cluster.ClusterID` (ADR-129).

### D5 — Membership contents → **label-carriers reported by that source**

- compose/stack workloads (`details.composeProject` / `details.stack`)
- project-labeled networks & volumes (`details.labels["com.docker.compose.project"]`)
- stack-labeled swarm services (`details.stack`)

NOT members: images (no project label; shared infra — image lineage is a
separate axis), engine, swarm nodes/secrets (no stack label mapped),
standalone containers, shared `bridge`/`host`/`none` networks. External
networks/volumes used-but-not-created by compose carry no label → stay
source-group-only (correctly treated as shared infra).

### D6 — Enablement → **reuse `scope.autoGroup`**

`autoGroup: false` freezes ALL auto-grouping for the source (source group
+ app groups). One flag, one mental model. Granular per-dimension
opt-outs deferred (YAGNI).

### D7 — Provenance link → **columns on `component_groups`**

Add `autoSourceId UUID NULL REFERENCES importer_sources(id)` +
`autoGroupKey TEXT NULL`. App group = both set (`compose:{project}` /
`stack:{name}`); source group = `autoSourceId` set + `autoGroupKey` NULL.
Source groups backfilled onto the same columns;
`importer_sources.componentGroupId` migrates away. `autoSourceId IS NOT
NULL` becomes the single auto-managed predicate for `GROUP_AUTO_MANAGED`
guards — simpler than today's two-mechanism check.

### D8 — Multi-membership surface → **generic join table, humans included**

- Humans get multi-assign: group-assignment API/UI accepts N groups per
  component. `Componode Dockers` + `docker-desktop` + `componode`
  coexisting is the designed outcome.
- API: component payloads return `componentGroupIds: string[]` (plural);
  `docs/openapi.yaml` updated per ADR-104; frontend badges/filters
  become multi-valued.
- No per-component auto-opt-out in v1.

### D9 — Custom label-key grouping → **deferred**

`componode.app`-style user labels are persisted already; grouping by an
arbitrary label key is a follow-up spec once the framework exists.

### D10 — Identity presentation

- Name = label value verbatim (`componode`, `mystack`); collisions
  cosmetic (names aren't unique).
- Slug = `docker-app-{key-slug}-{hash12(sourceId:key)}` — readable and
  collision-free, same pattern as `docker-cluster-{hash}`.
- Description = provenance text naming source + key.
- `teamOwnerId` = NULL; humans can set it post-creation.

## 5. Inherited semantics (unchanged from spec 067)

- Full idempotent recompute per trigger; failure-isolated
  (`runAutoGroupPass` never throws into host op).
- Same triggers: post-run (Hub + Agent), `retireSource`,
  `reactivateSource`. App-group pass is order-independent of the
  source-group pass (no precedence under multi-membership).
- `RETIRED` bound source → cleanup mode (evict all app members, derive
  RETIRED, keep link); `UNMONITORED`/opted-out → frozen.
- Derived lifecycle: `ACTIVE` iff ≥1 member component `ACTIVE`.
- `GROUP_AUTO_MANAGED` (409) on lifecycle writes + delete for ALL
  auto-managed groups (source and app).
- Groups remain ordinary `component_groups` rows → `DEPENDS_ON` on a
  group, read-time expansion, coverage suppression all work; group
  coverage suppresses stale `DEPENDS_ON` suggestions per ADR-113.
- Empty app group (project scaled to zero) → row persists, lifecycle
  RETIRED — same as source groups.

## 6. Non-goals

- No importer contract changes (`DiscoveredAsset` untouched).
- No group hierarchy (groups-in-groups), no multi-tenancy.
- No auto-wired edges — suggestions queue stays human-decided.
- No other importer adopters (kubernetes) — mechanism allows, doesn't ship.
- No topology-inferred clusters, no image lineage, no custom label keys,
  no fleet-wide app identity, no per-component auto-opt-out.

## 7. Implementation surface (for plan phase)

- **Migration**: `component_group_members` join table (backfill from
  `components.componentGroupId`, then drop the column); `component_groups`
  + `autoSourceId`/`autoGroupKey`; drop `importer_sources.componentGroupId`.
- **Backend**: membership reads/writes via join table; generalized
  auto-group pass (source-scoped + label-scoped strategies); strategy
  interface gains group-key extraction; manifest capability declaration;
  `GROUP_AUTO_MANAGED` guard update; API payloads `componentGroupIds[]`;
  openapi.yaml + generated docs.
- **Frontend**: multi-group display/assignment; group badges, filters,
  detail pages.
- **Docs**: `docs/using-the-catalog.md`, `docs/importers/docker.md`,
  ADR amendment/new ADR (multi-membership supersedes part of ADR-129's
  single-group-per-source scope note), `docs/openapi.yaml`.
- **Tests**: unit (membership reduce, strategy extraction), integration
  (pass behavior, guards, API), Playwright per AGENTS.md testing rules.
