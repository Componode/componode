# Quickstart: Product Package Roll-up

Runnable validation for spec 080. Prereqs: repo deps installed
(`pnpm install`), Postgres up (`pnpm dev` stack or the Playwright
`e2e` harness).

## What to verify

1. **Packages tab** — open `/products/<slug>?tab=packages` for a product
   with BOM-reporting components: server-paginated package rows (name,
   purl, ecosystem, version chips, component count, declared marker).
2. **Declared signal** — a package whose Library component the product
   `DEPENDS_ON` shows the declared marker (attributed: direct / via group /
   via child product); the `declared=undeclared` filter drops it.
3. **Skew** — `skew=true` leaves only multi-version packages.
4. **Consumers** — expand a row: per (component, version, scope) rows with
   DepSource attribution; version chip narrows to that version; component
   cell deep-links to `?tab=bom&q={purl}`.
5. **Coverage + staleness** — the "N of M components" summary; stale badge
   on rows older than the stale threshold.
6. **Empty states** — product with no edges vs. edges-but-no-BOM render the
   two distinct empty states.
7. **Flag** — `localStorage["componode.flag.productPackageRollup"]="false"`
   hides the tab entirely.
8. **URL round-trip** — every list state reproduces from the URL on reload.

## Commands

```bash
# Backend
cd packages/backend && pnpm test -- product-packages

# Frontend unit
cd packages/frontend && pnpm test -- product-packages

# Contract/test suite
pnpm lint && pnpm typecheck && pnpm test

# E2E (full stack workload)
cd playwright && pnpm e2e -- --grep "product.*packages"
```

## Expected

- `GET /api/v1/products/<slug>/packages` returns `data` + `coverage` +
  `staleThresholdDays` + `facets`; strict schema rejects unknown params
  (`VALIDATION_FAILED`); unknown slug → `NOT_FOUND`.
- `GET /api/v1/products/<slug>/packages/consumers?purl=…` returns merged
  (component, version, scope) rows each carrying `depSource`.
- All reads are session-authenticated, side-effect-free GETs.
