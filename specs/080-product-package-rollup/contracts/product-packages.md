# API Contracts: Product Package Roll-up

Both endpoints are authenticated (`verifySession`), side-effect-free GETs
(ADR-094/097), under `/api/v1`. Errors: `{code, message, details?}`
(ADR-071). `docs/openapi.yaml` is updated in the same change (ADR-104);
route coverage is enforced by the backend contract test.

Base path: `/products/:slug/...` — slug-addressed like `GET /products/:slug`.

---

## `GET /products/:slug/packages`

One row per version-free purl across the product's reachable ACTIVE
component set.

### Query params (`listProductPackagesQuerySchema`, strict)

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥1 | 1 | ADR-130 |
| `pageSize` | int 1–100 | 20 | ADR-130 |
| `search` | string ≤200 | — | name/purl/purlIdentity `ilike`; client withholds <2 chars |
| `ecosystem` | csv/array string | — | multi-value OR at entry level |
| `skew` | `"true"` | — | only rows with `versionCount > 1` |
| `declared` | `"declared" \| "undeclared"` | — | group-level filter on the declared signal |
| `sort` | `name\|components\|versions\|ecosystem` | `components` | whitelist |
| `order` | `asc\|desc` | `desc` | |

### 200 response

```json
{
  "data": [
    {
      "purl": "pkg:npm/lodash",
      "name": "lodash",
      "ecosystem": "npm",
      "versionCount": 2,
      "versions": [{ "version": "4.17.21", "componentCount": 3 }],
      "componentCount": 4,
      "lastReportedAt": "2026-11-20T10:00:00.000Z",
      "catalogComponent": { "id": "…", "slug": "pkg-npm-lodash", "name": "lodash" },
      "declared": { "kind": "GROUP", "group": { "id": "…", "name": "Runtime libs", "slug": "runtime-libs" } }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42, "pageCount": 3 },
  "coverage": { "reporting": 8, "total": 11, "reachable": 13 },
  "staleThresholdDays": 7,
  "facets": { "ecosystems": ["deb", "npm", "pypi"] }
}
```

### Errors

| Code | When |
|---|---|
| `VALIDATION_FAILED` | Unknown/invalid query params (strict schema) |
| `NOT_FOUND` | No product with that slug |
| `UNAUTHENTICATED` | No session |

---

## `GET /products/:slug/packages/consumers`

Paginated consumers of one package, scoped to the product's reachable set —
merged-view parity (one row per (component, version, scope)).

### Query params (`listProductPackageConsumersQuerySchema`, strict)

| Param | Type | Default | Notes |
|---|---|---|---|
| `purl` | string 1–500 | required | normalized via `normalizePurlIdentity` |
| `version` | string ≤200 | — | exact version filter (version-chip drill) |
| `page`, `pageSize` | int | 1 / 20 | ADR-130 |
| `sort` | `name\|version\|scope\|lastReportedAt` | `name` | whitelist |
| `order` | `asc\|desc` | `asc` | |

### 200 response

```json
{
  "data": [
    {
      "component": { "id": "…", "slug": "api-server", "name": "API Server", "category": "SERVICE" },
      "depSource": { "kind": "INHERITED", "product": { "id": "…", "name": "Commerce Core", "slug": "commerce-core" } },
      "version": "4.17.21",
      "scope": "REQUIRED",
      "direct": true,
      "lastReportedAt": "2026-11-18T09:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 3, "pageCount": 1 }
}
```

Unknown purls → empty page, not an error (workspace-consumers parity).

### Errors

Same codes as the list read.

---

## Frontend surface contract

- **Route**: product detail gains a `packages` tab (`/products/:slug?tab=packages`)
  — appended to `TABS` in `product-detail.tsx`; `useValidatedTab` rejects
  unknown values.
- **Flag**: `productPackageRollup` (G41) — tab trigger and content hidden
  when off; URL `?tab=packages` with flag off falls back per
  `useValidatedTab` semantics.
- **URL state**: search/filters/sort/page live in query params via
  `useListState`; `?pkg=<purl>` marks the expanded row and `?version=`
  narrows its consumers (SC-004 — expansion reproduces from the URL).
- **Consumers deep link**: component cell links to
  `/components/:slug?tab=bom&q={purl}` (BOM-tab search parity).
- **Empty states**: `coverage.reachable === 0` → "no component dependencies";
  `reachable > 0 && reporting === 0` (incl. library-only scope) →
  "components have not reported package data"; filter misses →
  "No packages match" + Clear filters.
- **Copy rule (D8)**: subtitle mirrors the explorer — "Packages reported
  across this product's components. Inventory only: Componode does not scan
  for vulnerabilities."
