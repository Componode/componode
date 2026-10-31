# Data Model: List Enrichment

No schema/migration changes — computed response fields only.

## `GET /components` row additions

| Field | Type | Source | Null when |
|---|---|---|---|
| `worstStatus` | `string \| null` | `eb.case()` over `component_instances.status` (ERROR > GONE > STOPPED > RUNNING) | component has zero instances |
| `lastSeenAt` | `string \| null` | `MAX(component_instances.lastSeenAt)` | no instances, or all null |

## `GET /teams` row additions

| Field | Type | Source |
|---|---|---|
| `memberCount` | `number` | `COUNT(persons WHERE teamId = teams.id)` |
| `componentCount` | `number` | `COUNT(components WHERE teamOwnerId = teams.id)` |

## Flag transitions (`ux/lib/flags.ts`)

| Flag | From | To | Fallback handling |
|---|---|---|---|
| `componentListHealth` | `false` | `true` | rows without instances render the existing null-badge fallback (honest empty, not flag-off) |
| `componentListLastSeen` | `false` | `true` | null timestamp → `RelativeTime` existing empty render |
| `teamMemberCounts` | `false` | `true` | real counts everywhere the flag gated |

## Frontend view types

`Component` view gains `worstStatus`, `lastSeenAt` (mapper reads the new
payload fields — `worstStatus()` helper may already exist and shift from
client-computed to backend-supplied); `TeamEntity`/`OrgEntity` gains
`memberCount`, `componentCount`.
