# API Contract Deltas: Practical Catalog Metadata

Normative source of truth is `docs/openapi.yaml` (updated in the same
change, per ADR-104; `docs/api.md` is regenerated). This document lists the
deltas for task authoring.

## `POST /api/v1/products` — create (existing, extended)

Request body gains (all optional):

```json
{
  "links": [{ "title": "Runbook", "url": "https://wiki.example/payments" }],
  "tags": ["pci", "payments"],
  "criticality": "HIGH",
  "sunsetAt": "2027-06-30T00:00:00Z"
}
```

Responses `201`/`400 VALIDATION_FAILED` unchanged. Response body echoes the
new fields.

## `PATCH /api/v1/products/:id` — update (existing, extended)

Same four optional fields; absent keys leave values unchanged (partial
update). `null` clears `criticality`/`sunsetAt`; `[]` clears `links`/`tags`.

## `GET /api/v1/products` — list (existing, extended)

New query params:

| Param | Type | Behavior |
|---|---|---|
| `tag` | string | exact single-tag match — `tags @> ARRAY[?]` |
| `criticality` | enum `CRITICAL\|HIGH\|MEDIUM\|LOW` | equality filter |

Product items in the response include `links`, `tags`, `criticality`,
`sunsetAt`.

## `GET /api/v1/products/:id` — detail (existing, extended)

Response `product` object includes all four new fields.

## `PATCH /api/v1/components/:id` — update (existing, generalized)

Body schema generalizes from `{componentGroupId, teamOwnerId}` to accept
`links`, `tags`, `sunsetAt` alongside the existing assignment fields.
Service call becomes a general component update preserving group-assignment
behavior. `400 VALIDATION_FAILED` on malformed metadata.

## `GET /api/v1/components` — list (existing, extended)

| Param | Type | Behavior |
|---|---|---|
| `tag` | string | exact single-tag match |

Component items include `links`, `tags`, `sunsetAt`.

## `GET /api/v1/components/:id` — detail (existing, extended)

Response `component` includes `links`, `tags`, `sunsetAt`.

## Error contract (unchanged patterns)

- `400 VALIDATION_FAILED` with Zod issue details for unknown fields,
  malformed links (bad URL scheme, title length), tags (charset/length/
  count), criticality (non-enum), sunsetAt (non-date).
- `404 NOT_FOUND` unchanged.
- `403` unchanged — metadata edits ride each entity's existing
  `product:update`/`component:update` permission (FR-014).

## Out of scope (explicit)

- No new endpoints. No multi-tag (`AND`/`OR`) params — `tag` is a single
  value this iteration.
- No server-computed sunset state — API returns the raw date; the client
  derives badge state.
- Importer APIs unchanged — curated fields never appear in
  `DiscoveredAsset` or upsert payloads (FR-015).
