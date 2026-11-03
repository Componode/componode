# Data Model: Read-only Component Relationships

## Scope

The feature adds a typed read projection over existing relationships. It adds
no relationship type, entity, edge writer, or polymorphic persistence table.

## Read model groups

| Group                         | Source → target                                     | Display meaning                             |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------- |
| `dependsOn`                   | Focused Component → Component                       | “Depends on”                                |
| `dependedOnBy`                | Component → focused Component                       | “Depended on by”                            |
| `sourcesFrom`                 | Focused service Component → repository Component    | “Sources from”                              |
| `sourcedBy`                   | Repository Component → focused service Component    | “Sourced by”                                |
| `exposes`                     | Focused service Component → API Component           | “Exposes”                                   |
| `exposedBy`                   | Service Component → focused API Component           | “Exposed by”                                |
| `productDependents.direct`    | DigitalProduct → focused Component                  | Direct Product dependency                   |
| `productDependents.viaGroups` | DigitalProduct → ComponentGroup → focused Component | Product dependency through a named group    |
| `instances`                   | Focused Component → ComponentInstance               | Environment-specific operational occurrence |

All Component-to-Component relations remain typed. Source/target direction
must not be inferred solely from lane position.

## Node data

### Component

`id`, `name`, `slug`, `category`, `provider`, `resourceType`, and `lifecycle`.
Existing status/health presentation uses current ComponentInstance statuses;
it does not invent a Component-level state.

### DigitalProduct

`id`, `name`, `slug`, `type`, `lifecycle`, and the fields required by existing
Product summary surfaces. A Product reached through a ComponentGroup carries
the group identity/name/slug in `viaGroup`; a direct relation has no
`viaGroup`.

### ComponentInstance

`id`, `environment`, `status`, `region`, `version`, and URL Check summary/link
where permitted by the existing read contract. Instances are nested beneath
the focused Component in Relationships and remain present in the Overview
Instances table.

## Visibility and states

- Related Component visibility follows the existing Component detail read
  policy; any returned target carries its lifecycle visibly.
- ComponentInstance visibility follows the current detail read default, which
  excludes `GONE` instances; an explicit `includeGone` request includes them.
- Empty Component-to-Component groups render explicit empty states.
- Product direct and group-mediated paths remain distinct even when they
  identify the same Product.
- `MISSED`, no-data, and disabled URL Checks do not create a ComponentInstance
  status transition. Active URL Check `SUCCESS`/`FAILURE` status propagation
  follows ADR-126.

## View state

- Focused Component ID comes from the detail route.
- Focus/selection, inspected node, and expanded-lane state are view-only and
  reset on navigation.
- Each typed lane initially shows up to four entries; `+N` expands that lane.
- The read response identifies unavailable relation groups for a partial
  state; the UI renders available groups with an inline warning.
- The surface has no mutations and creates no audit events.

## Invariants

- Direction and relation kind are explicit.
- `ComponentGroup` membership is never presented as a direct
  Product-to-Component edge.
- ComponentInstances are owned children, not peer graph nodes.
- Empty stored edge tables yield empty states; the view never infers edges.
- Many-to-many persistence remains in typed junction tables per ADR-048.
