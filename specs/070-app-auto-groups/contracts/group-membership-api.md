# Contract: ComponentGroup membership API

Deltas to the existing REST surface (`/api/v1`). No new endpoints; request
and response schemas change. `docs/openapi.yaml` updated in the same change
(ADR-104).

## `PATCH /components/:id` — request body

```jsonc
{
  "name": "...", "description": "...", // unchanged fields
  "componentGroupIds": ["uuid", "uuid"]  // NEW — replaces componentGroupId
}
```

| Field | Semantics |
|---|---|
| `componentGroupIds` | Array of group UUIDs. **Absent** = unchanged. **Present** = replace-set of the component's memberships in **human-managed groups only**. `[]` clears human memberships. |
| auto-managed group id in array | `409 GROUP_AUTO_MANAGED` — auto group memberships are system-owned; they cannot be set through this field. |
| unknown group id | `404 NOT_FOUND` / validation — same handling as today's bad `componentGroupId`. |
| duplicate ids | deduplicated server-side (or `400` — pick one, document). |

Memberships in auto-managed groups are never modified by this field —
additive coexistence is the designed outcome.

Audit: human membership changes write `entity_changes` on the component
(action `updated`, changes carry the `componentGroupIds` before/after).

## `POST /components` — request body

Same `componentGroupIds` semantics for initial human memberships.

## Component payloads (`GET /components`, `GET /components/:id`,
`POST /components`, `PATCH /components/:id` responses)

```jsonc
{
  "id": "...", "name": "componode/app", /* ...existing fields... */
  "componentGroups": [
    { "id": "uuid", "name": "Componode Dockers", "slug": "componode-dockers" },
    { "id": "uuid", "name": "docker-desktop", "slug": "docker-cluster-a0b6…" },
    { "id": "uuid", "name": "componode", "slug": "docker-app-componode-…" }
  ]
}
```

`componentGroupId` and `componentGroupName` are **removed** from the
payload — `componentGroups` is the single source. Order: stable (by group
name or insertion — pick deterministic order, document).

## `GET /components` — query params

`componentGroup` / `group` (slug filter) — **unchanged request shape**,
semantics widen: returns components having **any** membership in a group
with that slug. `group=none` = components with zero memberships (was:
`componentGroupId IS NULL`). A multi-group component appears under each of
its groups' filters.

## `GET /component-groups`, `GET /component-groups/:id`

Payload gains nullable provenance fields:

```jsonc
{
  "id": "...", "name": "...", "slug": "...", "lifecycle": "ACTIVE",
  "memberCount": 7,
  "autoSourceId": "uuid | null",   // NEW — owning ImporterSource when auto-managed
  "autoGroupKey": "compose:componode | null"  // NEW — NULL = source group
}
```

`autoSourceId IS NOT NULL` identifies auto-managed groups to clients
(replaces the implicit "linked from importer_sources" test). `memberCount`
now counts join rows.

`POST/PATCH/DELETE /component-groups` — **unchanged**. Auto-managed guards
(`409 GROUP_AUTO_MANAGED` on lifecycle PATCH / DELETE) now key off
`autoSourceId IS NOT NULL`, covering app groups identically.

## `GET /importer-sources` payload

`componentGroupId` retained with narrowed meaning: the source's **own**
auto group (`autoSourceId = source.id AND autoGroupKey IS NULL`), or null.
App groups are discoverable via `/component-groups`.

## Error semantics (unchanged codes)

`GROUP_AUTO_MANAGED` (409) — lifecycle writes/deletes on any auto-managed
group, and `componentGroupIds` containing an auto-managed id.
`NOT_FOUND` (404) — unknown component/group ids.
`VALIDATION` (400) — schema violations.
