# Data Model: Source-scoped auto ComponentGroups

## Schema change (migration `029_source_auto_groups`)

### `importer_sources.componentGroupId` (new column)

| Aspect | Value |
|---|---|
| Type | `uuid`, nullable |
| FK | `REFERENCES component_groups(id) ON DELETE SET NULL` |
| Index | `importer_sources_component_group_idx` on `componentGroupId` |
| Meaning | Durable source→auto-group link **and** the auto-managed marker: a `component_groups` row is auto-managed iff some `importer_sources.componentGroupId` points at it |

`ON DELETE SET NULL` is defense-in-depth — `deleteComponentGroup` rejects
auto-managed groups (`409 GROUP_AUTO_MANAGED`), so the API cannot reach the
set-null path; if the row is ever removed out-of-band the next pass
re-provisions and re-links (find-or-create via slug + link).

`componentGroupId` on `components` is unchanged — still single-valued,
still `ON DELETE SET NULL` (existing migration 001).

## Entities

### Auto-managed ComponentGroup

An ordinary `component_groups` row provisioned by the grouping pass:

| Field | Rule |
|---|---|
| `name` | `importer_sources.label` → engine component name (member with `resourceType = 'docker-engine'`) → `externalIdentity` |
| `slug` | Strategy-owned deterministic template — Docker: `docker-cluster-{sha256(externalIdentity).hex.slice(0,12)}`; `generateUniqueSlug` suffix fallback on collision |
| `description` | Provenance text naming the importer + source identity + ADR-129 |
| `lifecycle` | **Derived**: `ACTIVE` iff ≥1 member component `lifecycle = 'ACTIVE'`, else `RETIRED`; recomputed each pass; human `lifecycle` writes rejected |
| `teamOwnerId` | Always `NULL` at provisioning; human-editable afterwards |
| `createdBy`/`updatedBy` | `NULL` for system-provisioned writes (runActor has `id: null`) |

Human-editable fields (`name`, `slug`, `description`, `teamOwnerId`) remain
editable — edits survive because identity is anchored by the FK link, not
the slug.

### Membership invariant (recomputed fully each pass)

For source **S** (enabled, capability-declaring importer):

```
effectiveActiveReporters(c) =
  { s.id | ∃ membership m: m.componentId = c ∧ m.active
              ∧ s.status ∈ {ACTIVE, UNMONITORED} }

member(c, S) ⟺ |effectiveActiveReporters(c)| = 1 ∧ S ∈ effectiveActiveReporters(c)
            ∧ (c.componentGroupId IS NULL ∨ c.componentGroupId = S.autoGroup)
```

Apply per pass:

1. **Assign**: `componentGroupId NULL → group` for every sole-reporter
   component not in a foreign group.
2. **Evict**: `componentGroupId = group → NULL` for every current member not
   in the eligible set (lost exclusivity, stopped reporting, human-placed
   ineligible — automation-owned contents).
3. **Lifecycle**: recompute derived `ACTIVE`/`RETIRED`.

Never touched: components in human-managed groups, manual components (no
memberships), components whose sole reporter is a different source.

### Enablement

Per source, from its **bound** config (`importer_sources.boundConfigId →
importer_configs.scope`):

- `scope.autoGroup` absent or `true` → enabled (default-on opt-out).
- `scope.autoGroup === false` → source's group frozen: no membership or
  lifecycle changes on any trigger.
- `boundConfigId IS NULL` (UNMONITORED) → skipped — frozen until reactivation.
- Importer manifest must declare `autoGroups: "source"` — non-adopters are
  never evaluated regardless of scope keys.

Under single-valued binding, "a disabled config never tears down a group
another enabling config maintains" holds across binding handoffs: whichever
config is bound at trigger time decides; an enabling config's next run
re-binds and resumes maintenance.

## State transitions

```
(no group) --first enabled evaluation--> group created (lifecycle per members)
group ACTIVE --all members RETRIRED/gone--> RETIRED   (derived, each pass)
group RETIRED --≥1 member ACTIVE again-----> ACTIVE    (derived, each pass)
source RETIRED/UNMONITORED/disabled -------> group frozen (no evaluation)
```

There is no manual destroy path: `DELETE` and `lifecycle` PATCH on
auto-managed groups → `409 GROUP_AUTO_MANAGED`. Retirement of the group
happens by emptying it (source stops reporting / members retire) — the row
persists as `RETIRED`, hidden from default lists.
