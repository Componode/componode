# Research: Product Package Roll-up

Phase 0 output. Every decision below was resolved against the merged SBOM
programme (specs 073–079), the settled research (`researches/sbom_research.md`),
and existing code. No NEEDS CLARIFICATION remains.

## Decisions

### 1. Contributing component set

- **Decision**: reuse the product's reachable component set — direct
  `DEPENDS_ON` edges + `DEPENDS_ON` on component groups (expanded to current
  members, ADR-110 §2) + `COMPOSES` descendants' edges — attributed per
  `DepSource` (DIRECT / GROUP / INHERITED), filtered to `ACTIVE` components.
- **Rationale**: identical semantics to the existing Components tab and
  `computeComponentCountsForProducts`; the clarify answer ("declared edges
  now") needs the same map anyway.
- **Alternatives considered**: declared-only (rejected — understates what the
  product runs on); all components transitively under COMPOSES regardless of
  edges (rejected — that's a different model than DEPENDS_ON).

### 2. Where the reachable set lives

- **Decision**: extract the inline descendant/dep-queries in
  `getProductDetail` (`product-service.ts` ~L427–619) into
  `services/product-dep-scope.ts` → `productComponentScope(productId)`
  returning `Map<componentId, { component fields, sources: DepSource[] }>`.
- **Rationale**: one truth for reachability; detail read keeps identical
  output; the packages service gets the same map for free. Deep-module seam
  — the alternative (duplicating the CTE + two edge queries) guarantees
  drift.
- **Alternatives considered**: a SQL-only reachable-set view/function
  (rejected — DepSource attribution needs per-source rows, not just ids).

### 3. Read contract

- **Decision**: `GET /products/:slug/packages` and
  `GET /products/:slug/packages/consumers?purl=&version=`, authenticated
  (`verifySession`, no role gate — inventory is catalog-visible, matching
  `/packages`), strict Zod query schemas rejecting unknown params.
- **Rationale**: slug-addressed like the detail read; `purl` as query param
  per the established read contract (purls contain `:` `/` `@` — never a
  path segment).
- **Alternatives considered**: `/products/:slug/packages/:purl` path form
  (rejected — encoding hazard, breaks the spec-074 contract precedent);
  hanging the reads off `/packages?product=` (rejected — conflates workspace
  and product scopes, and loses the reachable-set/DepSource context).

### 4. Declared-dependency signal

- **Decision**: per package row, resolve the matched component exactly as
  `listPackages` does (`resolvedComponentId` consensus, else a non-retired
  component whose `externalId` equals the version-free purl), then check the
  scope map: member → `declared` carrying the DepSource attribution
  (DIRECT / GROUP {name,slug} / INHERITED {product name,slug}); absent →
  undeclared. `declared` filter values: `declared` / `undeclared` (plus
  `all`).
- **Rationale**: clarified 2026-11-23 — the operator's actionable question is
  "which runtime packages are undeclared?". Reuses both established
  primitives (catalog match + scope map); zero new semantics.
- **Alternatives considered**: deferring the correlation (rejected by the
  clarify answer); counting only the product's own edges for "declared"
  (rejected — an inherited declaration is still a declaration; attribution
  keeps the distinction visible).

### 5. Freshness and coverage

- **Decision**: response adds `coverage { reporting, total }` (reachable
  ACTIVE components with ≥1 `bom_entries` row vs. total) and
  `staleThresholdDays` (from `app_settings` via settings-service, default 7,
  Q1). Each package row and consumer row carries `lastReportedAt`
  (`max`/`newest`); the frontend reuses `isStale` like the BOM tab.
- **Rationale**: honest-freshness design principle; the coverage denominator
  distinguishes "no packages" from "components unmonitored" — spec FR-009/
  FR-013 empty states need `coverage.total === 0` vs `reporting === 0`.

### 6. Grouping, filters, sort

- **Decision**: same `purlIdentity` grouping as `listPackages`, scoped by
  `componentId IN (reachable set)`; search `ilike` on name/purl/purlIdentity
  (≥2 chars enforced client-side); filters: `ecosystem` (multi),
  `skew` (`versionCount > 1`), `declared` (`declared|undeclared`); sort
  whitelist `name|components|versions|ecosystem`, default `components desc`;
  consumers sort whitelist adds nothing new (`name|version|scope|lastReportedAt`).
  Facets = ecosystems across the product's contributing set.
- **Rationale**: FR-004/FR-005 parity with the explorer minus catalog
  concerns (the declared signal replaces the catalog column — a product view
  asks "declared?", not "in catalog?").

### 7. Flag and surface

- **Decision**: new flag `productPackageRollup` (`flagOverride("productPackageRollup") ?? true`),
  gap-registry entry **G41**, `docs/ux.md` flag-table row, hidden-not-disabled.
  Surface = a `Packages` tab on product detail (`TABS` array gains
  `"packages"`), rendering a scoped explorer table + expand-to-consumers
  with an attribution column.
- **Rationale**: G37–G39 precedent (ship ON with the contract, gap entry,
  hidden when off).
- **Alternatives considered**: nesting under the Components or Dependencies
  tab (rejected — the table needs its own toolbar/pagination URL state;
  top-level tabs are the established pattern); reusing `packagesExplorer`
  (rejected — independent surface, independent kill-switch per flag
  governance).

### 8. No new persistence, no ADR

- **Decision**: derived read only — no tables, no migration, no ADR.
- **Rationale**: spec 074 precedent; nothing in ADR-131/132/133 changes
  (entries are still source-scoped facts; edges stay human/agent-decided).
  The declared marker is a read-time join, not a write.

### 9. Consumers panel reuse

- **Decision**: parameterize `PackageConsumersPanel`'s table internals to
  accept a consumers query + optional attribution column, rather than
  forking a second panel.
- **Rationale**: the product consumers table is identical plus one column;
  forking duplicates the version-chip wiring and pagination.
- **Alternatives considered**: fork (rejected — drift); reusing the
  workspace panel unchanged (rejected — wrong endpoint and no attribution).

## Resolved upstream facts (verified in code)

- `getProductDetail` is slug-addressed (`GET /products/:slug`); reachable-set
  queries live inline at `product-service.ts` L427–619 and already dedupe
  multi-path components into `sources: DepSource[]`.
- `listPackages`/`listPackageConsumers` group on stored
  `bom_entries.purlIdentity` (migration 034), join ACTIVE components, use
  `paginateQuery` + `sortTarget` whitelist, and return server facets.
- `staleThresholdDays` is served from `app_settings`
  (`settings-service.ts` `BOM_STALE_THRESHOLD_KEY`, default 7).
- Flags are frontend-only (`ux/lib/flags.ts`); backend BOM reads are
  session-authenticated, ungated.
- `bom_entries` rows carry `componentId`, `componentInstanceId`,
  `sourceId`, `purl`, `purlIdentity`, `ecosystem`, `version`, `scope`,
  `direct`, `lastReportedAt`, `resolvedComponentId`.
