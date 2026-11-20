# Contract: Packages Explorer API (Phase 1b)

**Date**: 2026-11-20 | **Spec**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

All routes live under `/api/v1`, are session-gated (`verifySession`, every role incl. Viewer), side-effect-free `GET`s (ADR-094/097), Zod `.strict()`-validated (ADR-095), and return the `{code,message,details?}` error envelope (ADR-071/096). `docs/openapi.yaml` ships these in the same change (ADR-104).

## `GET /packages`

Server-paginated rollup — **one row per version-free purl** (`purlIdentity`).

### Query

| Param | Type | Behaviour |
|---|---|---|
| `page`, `pageSize` | list base | ADR-130 envelope; `pageSize` 1–100 default 25 |
| `search` | string ≤100 | `q` — case-insensitive match on entry `name`, verbatim `purl`, or `purlIdentity` |
| `ecosystem` | CSV | multi-value OR on `ecosystem` |
| `scope` | CSV enum | multi-value OR; entry-level filter applied before grouping (a package qualifies when any entry matches) |
| `catalog` | enum `linked\|suggested\|none` | accepted, **ignored** until Phase 2 (D6) |
| `sort` | enum `name\|components\|versions\|ecosystem` | maps to `name\|componentCount\|versionCount\|ecosystem`; default `components` |
| `order` | `asc\|desc` | primary direction, default `desc`; `name ASC`,`purlIdentity ASC` permanent tiebreaks (D7) |

Unknown params → `VALIDATION_FAILED` (`.strict()`).

### Response `200`

```json
{
  "data": [
    {
      "purl": "pkg:npm/lodash",
      "name": "lodash",
      "ecosystem": "npm",
      "versionCount": 2,
      "versions": [
        { "version": "4.17.21", "componentCount": 3 },
        { "version": "4.17.20", "componentCount": 1 }
      ],
      "componentCount": 4,
      "catalogComponent": null,
      "pendingSuggestionCount": 0
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 312 },
  "facets": { "ecosystems": ["deb", "npm", "pypi"] }
}
```

- `versions` is the top 5 by `componentCount` (remaining versions are implied by `versionCount` — the UI renders "+N more").
- `componentCount`/`versions[].componentCount` count ACTIVE components only (D5).
- `facets.ecosystems` is the ecosystem filter domain: distinct ecosystems over the whole ACTIVE-component inventory, independent of applied filters — present even on an empty page so a filtered-out value stays selectable.
- Empty inventory / empty result set → `200` with `data: []` (never an error).

## `GET /packages/consumers`

Paginated consumers of one package. `purl` is a **query parameter** (never a path segment — purls contain `:` `/` `@`).

### Query

| Param | Type | Behaviour |
|---|---|---|
| `purl` | string, required | any verbatim or version-free purl; server normalizes via `normalizePurlIdentity` and matches `purlIdentity` (unparseable ⇒ verbatim fallback match) |
| `version` | string | narrows to consumers of that exact version |
| `page`, `pageSize` | list base | same envelope |
| `sort` | enum `name\|version\|scope\|lastReportedAt` | default `name` |
| `order` | `asc\|desc` | default `asc` |

Missing/empty `purl` → `VALIDATION_FAILED`. Unknown purl → `200` with `data: []` (not an error).

### Response `200`

```json
{
  "data": [
    {
      "component": { "id": "…", "slug": "payments-api", "name": "Payments API", "category": "APPLICATION" },
      "version": "4.17.21",
      "scope": "RUNTIME",
      "direct": true,
      "lastReportedAt": "2026-11-19T08:12:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 4 }
}
```

One row per `(component, version, scope)` (D2); ACTIVE components only.

## `GET /search` — response extension

`SearchResults` gains `packages` (alongside `products`, `components`, …). Each
entry is a `SearchHit` (`kind: "package"`, `id`/`slug` = the version-free
purl) with the display name pre-formatted
`{name} · {ecosystem} · {n} component(s)` (singular for `n = 1`) and
`href` deep-linking into the explorer:

```json
"packages": [
  { "id": "pkg:npm/lodash", "name": "lodash · npm · 4 components", "slug": "pkg:npm/lodash", "kind": "package", "href": "/packages?q=pkg%3Anpm%2Flodash" }
]
```

Top 5 (hard cap regardless of `limit`), prefix match on `name`/`purlIdentity`,
ACTIVE-component counts. No new endpoint, no query change.

## Error contract

| Case | Status | Code |
|---|---|---|
| Unknown/invalid query param | 400 | `VALIDATION_FAILED` |
| Missing `purl` on consumers | 400 | `VALIDATION_FAILED` |
| Unauthenticated | 401 | `UNAUTHENTICATED` (existing) |
| Unknown purl / no rows | 200 | — (`data: []`) |

No 404s: both endpoints are collection reads — absence is an empty page, not a missing resource.
