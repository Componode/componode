# Contract: Dependency Suggestions (Phase 2)

**Date**: 2026-11-21 | **Spec**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

`/api/v1` routes. Reads `verifySession` any-role + side-effect-free; decisions require `component:edge:add` (EDITOR) with `x-permission`. `.strict()` Zod; `{code,message,details?}` errors; ADR-130 `{data,pagination}` envelopes.

## `GET /suggestions` — extended with `kind`

| Param | Behaviour |
|---|---|
| `kind` | `edge` (default — unchanged product-edge queue) \| `dependency` |
| `status` | `PENDING` (default) \| `DISMISSED` \| `DECIDED` — same view semantics as the edge queue |
| `sort`,`order` | `kind=dependency`: whitelist `score` (default `desc`), `createdAt`, `decidedAt`, `status`; same pending/decided sort mapping as the edge queue |
| `page`,`pageSize` | ADR-130 envelope |

`kind=dependency` items:

```json
{
  "id": "…",
  "parentComponent": { "id": "…", "slug": "orders-api", "name": "Orders API", "category": "SERVICE" },
  "childComponent": { "id": "…", "slug": "pkg-npm-lodash", "name": "lodash", "category": "LIBRARY" },
  "bomEntryId": "… | null",  // NULL after BOM pruning (SET NULL); decided pairs stay terminal
  "reason": "PURL_EXACT",
  "score": 1.0,
  "status": "PENDING",
  "createdAt": "…", "decidedAt": null, "decidedBy": null, "decidedByName": null
}
```

- Pending dependency reads exclude pairs whose **either** endpoint is RETIRED (read-side filtering parity with the edge queue).
- `kind` is **not** a filter on `edge` items — omitting it returns today's response exactly (nav badge `status=PENDING` unchanged → still product edges only).

## `GET /suggestions/dependencies/groups`

Pending dependency suggestions grouped per library (`childComponentId`) — the segment's default view.

| Param | Behaviour |
|---|---|
| `sort` | `score` (default — strongest group score desc) \| `components` (pending count desc) \| `name` (library name asc) |
| `page`,`pageSize` | groups paginate server-side |

```json
{
  "data": [{
    "childComponent": { "id": "…", "slug": "pkg-npm-lodash", "name": "lodash", "category": "LIBRARY" },
    "purl": "pkg:npm/lodash",
    "pendingCount": 14,
    "versions": 2,
    "reasons": ["PURL_EXACT"],
    "topScore": 1.0,
    "bulkAcceptable": true
  }],
  "pagination": { "total": 4, "page": 1, "pageSize": 25, "pageCount": 1 }
}
```

- `versions` = distinct versions reported on the underlying entries; `reasons` = distinct pending reasons; `topScore` = max pending score.
- `bulkAcceptable` = every pending row in the group is `PURL_EXACT` — mirrors what the server enforces; the UI still shows **Dismiss all** on every group.
- The response also carries `pendingCount` totals per `kind` for the segment chip (shape: `{ total, edge, dependency }` — or a sibling endpoint if cleaner at implementation; contract fixed at tasks).

## `POST /suggestions/dependencies/:id/accept` · `/dismiss`

Per-row decision — same transaction semantics as the edge queue: lock `FOR UPDATE`, `PENDING`-only guard (`409` "already decided"), accept writes the `component_depends_on_component` edge (pre-existing edge → `SUPERSEDED`), dismiss is permanent. `200 { suggestion }`.

## `POST /suggestions/dependencies/bulk`

```json
// body
{ "childComponentId": "uuid", "action": "accept" }   // or "dismiss"
// 200
{ "decided": 14, "failed": 0, "edges": 14 }
```

- `accept`: **409 `CONFLICT`** when any pending row in the group is not `PURL_EXACT` ("Bulk accept requires exact package matches — review name/slug matches one by one"). Otherwise one transaction: every pending row → `ACCEPTED` (or `SUPERSEDED` where the edge already existed), edges inserted `ON CONFLICT DO NOTHING`.
- `dismiss`: every pending row → `DISMISSED` in one transaction (any reasons).
- Partial-failure semantics: per-pair edge failures don't roll back successful siblings — `failed` counts them and the response lists failed suggestion ids for retry (`failedIds: string[]`).

## Errors

| Code | When |
|---|---|
| `VALIDATION_FAILED` | bad params/body (`kind` outside enum, unknown `action`) |
| `NOT_FOUND` | unknown suggestion id / `childComponentId` |
| `CONFLICT` | already-decided row; non-`PURL_EXACT` bulk accept |
| `AUTH_FORBIDDEN` | non-EDITOR decide calls |

## Deferred (documented non-goals)

- `POST /bom-entries/:id/promote` and `/wire` thin aliases — **not built** (spec marks optional; nothing consumes them).
- `GET /bom-entries/impact?purl=` — superseded by `GET /packages/consumers` (Phase 1b already shipped the where-used read).
