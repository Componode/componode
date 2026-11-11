# Data Model: App-level auto ComponentGroups + multi-membership

## Schema changes (migration `030_component_group_membership`)

### `component_group_members` (new table)

The single membership store replacing `components.componentGroupId`.

| Column | Type | Notes |
|---|---|---|
| `componentId` | `uuid NOT NULL` | `REFERENCES components(id) ON DELETE CASCADE` |
| `groupId` | `uuid NOT NULL` | `REFERENCES component_groups(id) ON DELETE CASCADE` |
| `createdAt` | `timestamptz NOT NULL DEFAULT now()` | provenance of the row |

- **PK** `(componentId, groupId)` — membership is a set; no duplicate rows.
- **Index** `component_group_members_group_idx` on `groupId` (member counts,
  group expansion, eviction scans).
- **Index** `component_group_members_component_idx` on `componentId`
  (component→groups fetch — the list/detail hot path).
- Backfilled `INSERT … SELECT componentGroupId, id FROM components WHERE
  componentGroupId IS NOT NULL` before the column drop.

Cascade on both sides: deleting a group removes its memberships; deleting a
component removes its memberships (replaces the old `ON DELETE SET NULL`).

### `component_groups` provenance columns

| Column | Type | Notes |
|---|---|---|
| `autoSourceId` | `uuid NULL REFERENCES importer_sources(id) ON DELETE SET NULL` | owning source for auto-managed groups; `IS NOT NULL` = the auto-managed predicate |
| `autoGroupKey` | `text NULL` | `NULL` = the source's own group; `'compose:{project}'` / `'stack:{name}'` = app group (docker strategy) |

- **Partial unique** `component_groups_auto_app_key_idx`
  `UNIQUE (autoSourceId, autoGroupKey) WHERE autoSourceId IS NOT NULL AND
  autoGroupKey IS NOT NULL` — one app group per (source, key).
- **Partial unique** `component_groups_auto_source_idx`
  `UNIQUE (autoSourceId) WHERE autoSourceId IS NOT NULL AND autoGroupKey IS
  NULL` — at most one source group per source.
- Backfill: every `component_groups` row referenced by
  `importer_sources.componentGroupId` gets `autoSourceId = source.id`,
  `autoGroupKey = NULL`.

### Columns dropped

- `components.componentGroupId` (replaced by join table).
- `importer_sources.componentGroupId` + `importer_sources_component_group_idx`
  (replaced by `component_groups.autoSourceId`).

## Entities

### Membership ownership rule

A membership row has no origin column — ownership derives from the **group**:

- `component_groups.autoSourceId IS NULL` → human-managed group; its
  memberships are human-editable via `componentGroupIds` on component
  create/update (replace-set over human memberships only).
- `component_groups.autoSourceId IS NOT NULL` → auto-managed group; its
  member set is fully recomputed by the owning source's pass. Human writes
  never touch these rows; passing an auto-managed group id in
  `componentGroupIds` is rejected.

This preserves spec-067's "automation-owned contents" (clarify Q1 → A):
an ineligible component inside an owned auto group is evicted on the next
pass regardless of how the row got there.

### Auto-managed group kinds (one table, two shapes)

| Kind | `autoGroupKey` | Name | Slug |
|---|---|---|---|
| Source group | `NULL` | source label → engine component name → externalIdentity | `{slugBase}-{hash12(externalIdentity)}` (existing strategy templates) |
| App group | `compose:{project}` | the key label verbatim (`componode`) | `docker-app-{slug(key)}-{hash12(sourceId:autoGroupKey)}` |
| App group | `stack:{name}` | the stack name verbatim | same template |

`description` = provenance text naming importer, source identity, key, and
the spec. `teamOwnerId` = NULL at provisioning, human-editable.
`createdBy`/`updatedBy` = NULL (system writes). `lifecycle` = derived:
`ACTIVE` iff ≥1 member component `ACTIVE`, else `RETIRED` — recomputed every
pass for both kinds.

### Membership invariants (recomputed fully each pass)

**Source group** (unchanged rule, new store): component C joins source S's
group iff S is C's sole effective-active reporter
(`|reporters(C)| = 1 ∧ S ∈ reporters(C)`), where

```
reporters(C) = { s.id | ∃ m ∈ source_component_memberships:
                 m.componentId = C ∧ m.active ∧ s.status ∈ {ACTIVE, UNMONITORED} }
```

**App group** (new): component C joins source S's group for key K iff

```
S ∈ reporters(C)                      -- reported by THIS source (not sole)
∧ extractor(C.details) ∋ K           -- carries the app-boundary label
```

A component reported by two sources and carrying `compose:componode` joins
**both** sources' `componode` app groups — additive by design. A component
with no reporters (manual) or only inactive memberships joins no auto group.

**Eviction** (both kinds, clarify Q1-A): members of an owned auto group not
in that group's eligible set are deleted on the next evaluation —
including rows a human somehow placed there.

**Never touched by auto passes**: memberships in human-managed groups
(`autoSourceId IS NULL`); `source_component_memberships` (reconciliation's
domain); product edges.

### Enablement (per source, per group type)

From the bound config's `scope` (`importer_sources.boundConfigId →
importer_configs.scope`):

- `scope.autoGroup === false` → **both** group types frozen for that source.
- `boundConfigId IS NULL` → frozen until reactivation.
- Importer manifest `autoGroups: "source"` gates the source group;
  `autoAppGroups: true` gates the app dimension. Docker declares both.
- Evaluation mode (`full` vs `cleanup`) is unchanged — cleanup sources
  evict app-group members too and mark groups RETIRED.

## State transitions

```
(no group) --first enabled evaluation--> group created (lifecycle per members)
group ACTIVE --all members RETIRED/gone--> RETIRED   (derived, each pass)
group RETIRED --≥1 member ACTIVE again-----> ACTIVE    (derived, each pass)
source RETIRED/UNMONITORED/disabled -------> all its auto groups frozen
component reported by 2nd source ---------> leaves source groups, KEEPS app groups
component loses label/details ------------> evicted from app group, stays in source group
component gains human membership ---------> additive alongside all auto memberships
```

Human membership edits: `componentGroupIds` present on PATCH/POST =
replace-set of **human-group** memberships. `[]` clears human memberships;
auto memberships unaffected. Auto-managed ids in the array → rejected.
