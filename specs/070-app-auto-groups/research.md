# Research: App-level auto ComponentGroups + multi-membership

Phase 0 output. All decisions resolved — no NEEDS CLARIFICATION items.

## Decision record

### Grilling round (10 decisions, user-confirmed)

| # | Question | Decision |
|---|---|---|
| Q1 | Coexistence model | **(b) Multi-membership join table** — promote `componentGroupId` now; cluster ∩ app facets |
| Q2 | Grouping dimensions v1 | **Compose project + Swarm stack only** — declared boundaries, zero inference |
| Q3 | Mechanism shape | **Generic capability** — manifest flag + per-importer strategy; docker-only adoption |
| Q4 | App group identity | **Per-source** — `(sourceId, key)`; name is display-only, slug carries source hash |
| Q5 | Member resource types | **Workloads + labeled networks/volumes + stack services**; images/engine/nodes/standalone stay source-group-only |
| Q6 | Enablement | **Reuse `scope.autoGroup`** for both group types |
| Q8 | Multi-membership semantics | **Full promotion** — humans multi-assign; auto purely additive; API returns plural |
| Q7 | Provenance link | **Columns on `component_groups`** (`autoSourceId`, `autoGroupKey`); migrate source groups onto same scheme; retire `importer_sources.componentGroupId` |
| Q9 | Custom label-key dimension | **Deferred** — compose/stack only in v1 |
| Q10 | Identity presentation | name=key verbatim; slug=`docker-app-{key}-{hash}`; description=provenance; teamOwnerId=NULL |

### Clarify round (1 question, user answered A)

Auto-group passes **evict ineligible members from groups they own**,
including human-placed rows inside auto groups — additive multi-membership
changes who can *hold* memberships, not who *owns* each group's member set.

### Deferred (explicitly out of scope)

Topology-inferred clusters, image lineage, custom label keys, fleet-wide
app identity (`compose:{project}` global merge), per-component auto-opt-out,
other importers adopting the capability.

## Code-surface map (verified)

`components.componentGroupId` readers/writers — all migrate to
`component_group_members`:

| Site | Usage |
|---|---|
| `component-group-service.ts` | memberCount subqueries, isAutoManagedGroup, updateComponent/createComponent group writes, `getComponentGroupByComponentId` |
| `component-catalog-service.ts` | list join + `componentGroup`/`group` slug filter, detail group payload |
| `component-relationship-service.ts` | `viaGroupDependents` — single-group expansion → all memberships |
| `product-service.ts` | group-edge expansion (`components.componentGroupId = edge.componentGroupId`) ×2, memberCount |
| `product-health-service.ts` | group-edge expansion |
| `catalog-coverage-service.ts` | `wiredComponentIdsQuery` union |
| `edge-suggestion-service.ts` | `isCovered(productId, componentGroupId)` → any-membership ∩ depended-groups |
| `importer-source-service.ts` | source→group serialization → own-group lookup via `autoSourceId`/`autoGroupKey IS NULL` |
| `source-group-service.ts` | the pass itself — plans, ensureGroup, membership assign/evict, lifecycle |
| `db/types.ts` | `ComponentRow.componentGroupId`, `ComponentGroupRow` (+2 cols), `ImporterSourceRow.componentGroupId`, new `ComponentGroupMemberRow`, `DB` map |
| `packages/core` | `updateComponentSchema`/`createComponentSchema` (`componentGroupId` → `componentGroupIds`), component contract (`componentGroups[]`), `ImporterManifest.autoAppGroups` |
| `routes/components.ts`, `routes/component-groups.ts` | unchanged signatures — schemas carry the delta |
| `docs/openapi.yaml` | request/response schema updates (ADR-104) |

Frontend sites: `api/types.ts`, `api/mappers/catalog.ts`,
`api/hooks/component-groups.ts` (assign mutation), `component-edit-dialog`,
`component-create-dialog`, `component-detail`, `components/new.tsx`,
`title-with-summary.tsx`, `view-types.ts`, group filter on list pages.

## Key design decisions (plan-level)

1. **Human write rule**: `componentGroupIds` manages human-group
   memberships only (`autoSourceId IS NULL` groups); auto memberships are
   system-owned. Auto ids in the array → rejected. Avoids a per-row origin
   column — ownership derives from the group.
2. **Manifest capability**: `autoAppGroups?: boolean` added to
   `ImporterManifest` alongside existing `autoGroups?: "source"`. Orthogonal
   flags — an importer could adopt either independently.
3. **Strategy extension**: `SourceGroupStrategy` gains an optional
   `appGroupKinds` spec: per-kind `keyOf(details) → string[]`,
   `autoGroupKey(kind, key)`, `slugFor`, `nameFor`, `descriptionFor`.
   Docker implements `compose-project` + `swarm-stack`.
4. **App-group member set**: `reporters(C) ∋ S` (not sole) AND
   `keyOf(C.details) ∋ K`. Computed per source from the same
   `source_component_memberships`-joined query the pass already runs —
   grouped by `sourceId` rather than filtered to sole reporters.
5. **Coverage = any-membership**: everywhere the single `componentGroupId`
   fed a group lookup, the join table feeds a set; "covered" =
   intersection non-empty (suggestions) or EXISTS (expansion queries).
6. **Importer-source payload**: keeps `componentGroupId` field name meaning
   "this source's own auto group" (`autoGroupKey IS NULL`); app groups
   surface through `/component-groups` like ordinary rows.
