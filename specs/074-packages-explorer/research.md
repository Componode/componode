# Phase 0 Research: Packages Explorer (Phase 1b)

**Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All spec unknowns resolved. The research doc (`researches/sbom_research.md` § UX-PKG / read contract / G37) already ratified the endpoint shapes; the decisions below cover what it left open. No NEEDS CLARIFICATION items remain.

## D1 — Grouping key: stored `purlIdentity` column (not query-time SQL strip)

**Decision**: Add `bom_entries.purlIdentity` (`text NOT NULL`) — the output of core's `normalizePurlIdentity(purl)` (packageurl-js: version/qualifiers/subpath stripped + per-type casing/encoding normalization) — backfilled per-row inside migration `034` and written by `processBomEntries` on every upsert. Index `bom_entries_purl_identity_idx`. Fallback for an unparseable purl: the verbatim purl itself (still a stable group key).

**Rationale**: `bom_entries.purl` is verbatim and includes `@version` (`pkg:npm/lodash@4.17.21`), so "one row per version-free purl" cannot group on it directly. The purl.ts header already designates the normalized form as the where-used grouping identity for Phase 1b; storing it makes grouping/matching index-assisted and gives Phase 2's `resolvedComponentId` match (`components.externalId` = normalized purl) a join-ready column. Backfill is a bounded TS loop inside `up()` (Kysely migrations run TS; `sql` templates parameterize the UPDATEs).

**Alternatives considered**: (a) SQL `regexp_replace` version-strip at query time — cannot apply per-type purl normalization (npm/golang/pypi casing and encoding rules differ) and can't be indexed without a generated column (which can't call packageurl-js); (b) normalize in JS after fetching all rows — breaks server-side pagination. Both rejected: they either diverge from the ratified normalized identity or defeat ADR-130 pagination.

## D2 — Consumer-row merge: `DISTINCT ON (componentId, version, scope)`, `direct` = `bool_or`

**Decision**: `GET /packages/consumers` returns one row per `(componentId, version, scope)` — the Phase 1 merged-view identity — choosing the most recently reported entry (`DISTINCT ON … ORDER BY lastReportedAt DESC`) for display fields and `bool_or(direct)` for directness (any instance/source reporting it as declared ⇒ shown direct). `lastReportedAt` = max over the group.

**Rationale**: Mirrors the merged BOM read (`getBomForComponent` DISTINCT ON pattern) so the explorer and the tab agree on what "one consumer" means; instance-level split would re-introduce the duplicate-rows problem the merged view exists to solve. `bool_or` is the honest directness rollup — a component that declares the package directly somewhere is a direct consumer.

**Alternatives considered**: group by `(componentId, version, scope, direct)` (two near-identical rows per component — noise) or per-instance rows (duplicates the component, contradicts merged-view parity).

## D3 — Top-5 `versions[]`: second grouped query over the page's purls

**Decision**: `GET /packages` paginates the grouped rollup first, then issues one grouped follow-up over `bom_entries` for just that page's `purlIdentity`s — `GROUP BY (purlIdentity, version)` → `count(DISTINCT componentId)` — slicing top 5 per package in JS.

**Rationale**: the same two-query shape `getBomForComponent` already uses (`groupStats` pass), keeping per-package version stats off the pagination path and bounded to ≤25 groups × versions.

**Alternatives considered**: `jsonb_agg` per group inside the main rollup (couples ordering/limits inside one query, harder to page) or a lateral join per row (N subqueries).

## D4 — Ctrl+K: extend `GET /search` with a `packages` group

**Decision**: `globalSearch` gains `packages: { purl, name, ecosystem, componentCount }[]` — prefix ILIKE on `name`/`purlIdentity` over the grouped rollup, `componentCount` over ACTIVE components, capped at 5. `SearchResults` (backend interface + frontend type) gains the key; `command-menu.tsx` renders a **Packages** `CommandGroup` (flag-gated) navigating to `/packages?q={purl}`.

**Rationale**: one existing palette request carries all groups; extending it keeps the top-5 shape UX-PKG-05 wants (`{name} · {ecosystem} · {n} components`) without a second round-trip or a bespoke endpoint.

**Alternatives considered**: palette calls `GET /packages?pageSize=5` directly — a second request per keystroke and a second loading path, rejected.

## D5 — ACTIVE components only

**Decision**: `componentCount`, `versions[].componentCount`, `pendingSuggestionCount`, consumers rows, and search hits count/join only `components.lifecycle = 'ACTIVE'`.

**Rationale**: default list queries exclude RETIRED records (AGENTS.md lifecycle rule; the research's impact SQL already filters `c.lifecycle = 'ACTIVE'`). Entries on retired components stay stored but don't inflate "where is it used".

**Alternatives considered**: include RETIRED with a marker — scope creep; no UX requirement asks for it.

## D6 — `catalog` filter: schema-accepted, service-inert

**Decision**: `listPackagesQuerySchema` accepts `catalog: linked|suggested|none` and the service ignores it in Phase 1b — identical to `listBomQuerySchema`'s Phase-2 placeholder.

**Rationale**: contract stability — Phase 2 flips behavior without a schema change; UX-PKG-02 names the *In catalog* filter, whose column+filter render only under `bomCuration` anyway.

## D7 — Sort: `order` applies to the primary key; `name asc` is the permanent tiebreak

**Decision**: sort whitelist `name|components|versions|ecosystem` mapped to `name|componentCount|versionCount|ecosystem`; default `components` + `order=desc`. `order` flips only the primary direction — `name ASC` (then `purlIdentity ASC`) is always appended for deterministic pages.

**Rationale**: UX-PKG-02's "default sort `components desc` then `name asc`" is a two-key default; applying `order` to the tiebreak too (`components desc, name desc`) would contradict it literally.

## Confirmed facts (no decision needed)

- `bom_entries` columns confirmed against migration 032 — verbatim `purl` NOT NULL, `version` nullable, `ecosystem` NOT NULL, `componentInstanceId` nullable; no identity column exists today.
- Only two writers populate `purlIdentity`: `processBomEntries` (upsert) and `playwright/data/seed-app-flows.ts` (direct pg inserts — must add the column or the NOT NULL breaks seeding).
- `useGlobalSearch` hits `GET /search?q=&limit=` once per keystroke; `SearchResults` is a backend-local interface mirrored in `api/hooks/search.ts` — both extended.
- Sidebar ordering: research places **Packages** after *Component groups* → NAV_SECTIONS Catalog order becomes Products, Components, Component groups, **Packages**, Suggestions; `BlocksIcon` (`PackageIcon` taken), no `badgeKey`.
- Route registration: `{ path: "packages", element: authed(<UxPackagesPage />) }` in `routes.tsx` (all roles — no `requiredRole`; Viewer reads per the research role table).
- Docs scripts: `pnpm docs:api` (backend) regenerates `docs/api.md` from `openapi.yaml`; `docs:oracle:check`, `docs:sidebar:check`, and the ADR-104 route-coverage contract test run in CI — openapi + `x-permission` must be exact.
- Playwright BOM coverage lives at `playwright/tests/journeys/component-bom.spec.ts` with pg-seeded fixtures; the new `packages.spec.ts` reuses `seed()` + `pgClient` patterns.
