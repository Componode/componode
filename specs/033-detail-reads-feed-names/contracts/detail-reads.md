# Contract: detail reads — `GET /api/v1/{teams,lobs,component-groups}/:id`

Single-entity reads for Team, Line of Business, and Component Group.
`GET /teams/:id` and `GET /lobs/:id` are new routes; `GET
/component-groups/:id` already exists and gains slug resolution.

**Auth**: `verifySession` (any authenticated role — same posture as the
list endpoints and `GET /teams/:id/members`). No `x-permission`.

## Path params

| Param | Type | Resolution |
|---|---|---|
| `id` | string | UUID-shaped → match `id`, fall back to `slug` on miss; otherwise match `slug` |

Slugs are unique per ADR-046, so a slug hit is unambiguous. Mutations
(`PATCH`/`DELETE :id`) remain id-only. Note the identifier contract now
differs across detail endpoints: products/components resolve by slug
only (`/products/:slug`), while teams/LOBs/groups accept id-or-slug —
deliberate, since their mutation routes already take `:id`.

## Response `200`

```json
{ "team":   { "id": "…", "name": "Platform Eng", "slug": "platform-eng", "description": null, "createdAt": "…", "updatedAt": "…" } }
{ "lob":    { "id": "…", "name": "Payments",     "slug": "payments",     "description": null, "createdAt": "…", "updatedAt": "…" } }
{ "group":  { "id": "…", "name": "payments-db",  "slug": "payments-db",  "description": null, "lifecycle": "ACTIVE", "teamOwnerId": null, "createdBy": null, "updatedBy": null, "createdAt": "…", "updatedAt": "…" } }
```

Envelope keys match the existing create/update responses (`team`, `lob`,
`group`). Payload = the same row the list endpoint returns — no expanded
relations; members and related objects come from the existing dedicated
endpoints (`/teams/:id/members`, filtered lists).

## Errors

- `404 { "code": "NOT_FOUND", "message": "…" }` — no entity by id or slug.
- `401 AUTH_NO_SESSION` — unauthenticated.

GETs are side-effect-free (ADR-094): no counters, no state mutation.
