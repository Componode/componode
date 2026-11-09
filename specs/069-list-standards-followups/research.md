# Research: Spec-068 follow-ups — e2e spec debt and list-standards cleanup

Phase 0 output. Every decision below was verified against the code on
`069-list-standards-followups` @ branch point (`origin/main` `c2f89e2`).

## D1 — product-map.spec.ts targets the Map tab

**Decision**: rewrite the four failing tests to navigate to
`/products/{slug}?tab=map` (or click the Map tab) and keep every existing
assertion — `Product topology` heading, the five relation-family lanes,
inspection panel, `+N` expansion, keyboard operation, no-overflow,
reduced-motion — unchanged in substance.

**Rationale**: `product-detail.tsx` ships `TabsTrigger value="map"` →
`<ProductMap>`; `useValidatedTab(TABS)` with
`TABS = [overview, map, components, dependencies, activity]` makes
`?tab=map` a first-class deep link. The topology code itself is untouched
by spec-068 — only the spec's navigation target is stale.

**Alternatives considered**: asserting topology on Dependencies — rejected,
the component no longer renders there.

## D2 — `?tab=map` deep-link + empty-state assertions

**Decision**: test :87 becomes "`?tab=map` selects the Map tab; empty
product shows the map empty state". Assert
`getByRole('tab', { name: 'Map' })` has `aria-selected="true"` and the
empty-state copy `No relationships yet` (product-map.tsx:327 — matches the
existing `/no relationships/i` regex). Remove the
`getByRole('tab', { name: 'Map' })).toHaveCount(0)` assertion — Map now
exists.

**Rationale**: the old test encoded the pre-`2f77c56` world where `map`
wasn't a valid tab and `useValidatedTab` fell back to the first tab.

**Alternatives considered**: keeping a legacy-redirect assertion — there
is no redirect; `?tab=map` is canonical now.

## D3 — component-relationships.spec.ts expects populated lanes only

**Decision**: update the lane loop to expect only lanes with data for the
fixture, assert the no-data lanes absent, and delete the `'None'`
empty-state block (spec :94-98).

**Rationale**: `component-relationships.tsx:313` —
`laneVisible = lanes[key].length > 0 || view.unavailableKinds.includes(key)`;
`laneColumn` returns `null` for invisible lanes. The fixture
(`buildRelationshipFixture`) creates one component + instance + group
membership + two product `DEPENDS_ON` edges — it populates **only**
`productDependents` (direct + viaGroup provenance) and the Instances
section. `dependedOnBy`, `sourcedBy`, `exposedBy`, `dependsOn`,
`sourcesFrom`, `exposes` all have no writer exercised by the fixture and
must be asserted **absent** (`toHaveCount(0)`), not merely empty. The
`unavailableKinds` path keeps headers only when a relation-kind read
fails — not exercised here.

**Alternatives considered**: seeding component→component edges to populate
more lanes — rejected; the fixture's purpose is provenance/nesting coverage
and the doc scopes this to expectation updates, not new fixture surface.
Implementer verifies actual rendered lanes on first run and adjusts the
expected set if the API derives additional relations.

## D4 — B.2: one validation helper, canonical "Invalid input"

**Decision**: migrate every hand-rolled 400 site to the existing
`validationFailed(reply, issues)` in
`packages/backend/src/routes/route-helpers.ts` (already imported by 8 route
files). Canonical message stays `"Invalid input"`; `code` stays
`"VALIDATION_FAILED"`; `details` carries `p.error.issues`.

**Rationale**: the helper already exists and is the majority pattern
(org/sessions/users/importer-sources/products/suggestions/url-checks/
components partially). Sites to migrate: `"Invalid query"` in
agents.ts (×3), importers.ts (×4), credentials.ts, audit.ts (×2);
`"Invalid query parameters"` in component-groups.ts, components.ts (×2);
file-local `invalid()` in docker-targets.ts; plus any `"Invalid input"`
hand-rolls that bypass the helper (agent-channel.ts, auth.ts ×4,
components.ts, credentials.ts, importers.ts, sessions.ts, users.ts,
org.ts, products.ts — full sweep at implementation via grep for
`status(400)` / `message: "Invalid`).

**Alternatives considered**: separate `invalidQuery()`/`invalidBody()`
helpers with distinct messages — rejected; the doc asks to remove copy
drift, and Zod `details[].path` already distinguishes query vs body.

## D5 — B.3: sort maps replace ternary chains

**Decision**: per-service `Record<SortKey, OrderTarget>` constants where
`OrderTarget = string | RawBuilder<unknown>` (Kysely accepts both in
`orderBy`), applied via a small shared helper (e.g.
`applySort(qb, SORT_MAP, sort, order, tiebreak)`) in
`packages/backend/src/utils/` — or a local `qb.orderBy(SORT_MAP[sort] ??
DEFAULT, order)` where the chain is a one-liner. ~15 chains across 14
files: agent, audit (×2), component-catalog, component-group, credential,
docker-target, edge-suggestion, import-run (×2), importer-config,
importer-source, org (×2), product, session, user services.

**Rationale**: every chain branch is `qb.orderBy(<string-or-sql-expr>,
order)` — audit's `ACTOR_SORT`/`ENTITY_TYPE_SORT` are `sql` template
expressions (allowed; ADR-084 bans `sql.raw`/`sql.fragment` only) and
become map values. `paginateQuery`'s `orderBy` callback keeps its shape;
the map lookup + default + id tiebreak happens inside it.
edge-suggestion-service computes an `effectiveSort` (status→status,
createdAt→createdAt, decidedView→decidedAt, score→score, else createdAt)
with a special 3-key ordering for score — express as an explicit
`EFFECTIVE_SORT` resolution + `SORT_COLUMNS` map, preserving the
score branch's extra tiebreaks (`createdAt asc`, `id asc`).

**Alternatives considered**: a single global sort registry — rejected;
orderable targets are service-specific (table-qualified columns, select
aliases like `boundConfigCount`, per-view expressions).

## D6 — B.4: shared facet-param helper + one debounced hook

**Decision**: extract the sentinel logic — currently three identical
copies (`facet` lambda in `componentsListParams` hooks/components.ts:74
and `productsListParams` hooks/products.ts:67; `auditFacet` in
hooks/audit.ts:76) — into one exported helper, e.g.
`facetParam(state: ListQueryState, key: string): string | undefined` in a
shared module (`api/hooks/list-params.ts` or `ux/lib/`). Consolidate
`useDebouncedFilter` (ux/app/activity.tsx:107) and `useListSearch`
(ux/hooks/use-list-search.ts) into one generalized debounced-param hook
that handles both the search-string case and the `"all"`-sentinel filter
case (parameterize the unset value / commit target).

**Rationale**: the three facet copies are byte-identical logic; the two
debounced hooks share the debounce+two-way-sync skeleton and differ only
in sentinel handling (`""` vs `"all"`) and commit signature.

**Alternatives considered**: keeping per-hook copies with a shared
`isSet` util — rejected; the doc asks for one mapping definition.

## D7 — B.5: drop dual signatures, migrate 3 call sites

**Decision**: migrate `useSuggestions("PENDING", 0, 100)` in
`ux/app/products/$slug.tsx:21` → `useSuggestions("PENDING", { page: 1,
pageSize: 100 })`; `useSuggestions("PENDING", 0, 1)` in
`ux/components/app/app-sidebar.tsx:135` → `{ page: 1, pageSize: 1 }`; the
`useEntityHistory` wrapper in `ux/hooks/use-entity-history.ts:54` already
passes an options object — verify it uses `page`/`pageSize` keys only.
Then delete the positional branch in `useSuggestions` and the
`limit`/`offset` translation in `normalizeFeedQuery` (audit.ts:117),
keeping `normalizeFeedQuery` only if other normalization remains (it also
strips legacy keys — after migration it may become a passthrough and can
be inlined/removed). Update `spec-068-list-adapters.test.ts` and
`entity-history-pagination.test.tsx` to the single signature.

**Rationale**: clarify session chose migrate-and-drop; inventory found
only these callers. Both positional callers use `offset=0`, so
`page=1` preserves semantics exactly.

**Alternatives considered**: keep compat + warn — rejected per clarify;
documented silent clamp — rejected.

## D8 — B.6: promote real fields, delete speculative members

**Decision**: (a) add `completedAt: string | null` to the view-type
`ImportRun` (`ux/lib/view-types.ts:134`) — the API type
(`api/types.ts:122`) and mapper (`mappers/operations.ts`) already carry
it; verify the mapper populates it and remove the
`& { completedAt?: string | null }` intersection in `SummaryRowMap` plus
the derivation workaround at title-with-summary.tsx:287-290.
(b) For `team`/`lob`/`edgeSuggestion` intersections: the API list types
already declare `productCount?`/`teamCount?` (api/types.ts:413-419) and
the suggestions mapper already emits `score`/`createdAt`
(mappers/suggestions.ts:24-27) — verify each field exists on the
underlying type the row actually is, then delete redundant `& {...}`
members; add genuinely-missing fields to the proper view type rather
than intersecting at the call site. Any field no payload carries is
deleted, not kept "for forward-compat".

**Rationale**: clarify session + doc recommend populate-or-delete; the
codebase evidence says most intersected fields already exist on API/view
types — the intersections are likely pure redundancy.

## D9 — B.7: one entity-type label registry

**Decision**: move `ENTITY_TYPE_LABELS` out of `ux/app/activity.tsx:64`
into a single registry module (e.g. `ux/lib/entity-type-labels.ts`),
consumed by the activity filter dropdown; fix
`importer_config: "Importer"` → `"Importer config"` to match sibling
labels ("Importer source", "Importer config" appears nowhere else —
canonical sibling style is the entity name). The registry documents that
it mirrors the backend audit entity-type vocabulary (free-form
`entityType` strings per `core/schemas/audit.ts`, enumerated in the
activity page's `ACTIVITY_FILTERS.entityType.options`).

**Rationale**: only one consumer today, but the map duplicates domain
vocabulary and already drifted (`"Importer"` vs `"Importer config"`). A
`ux/lib/` module keeps it frontend-side — backend never renders labels;
making it a core constant would imply backend usage that doesn't exist.

**Alternatives considered**: core constant shared with backend —
rejected, no backend consumer; keeping `ENTITY_KIND` in
`mappers/dashboard.ts` as the registry — rejected, it maps to kind
buckets (product/component/importer/…), not display labels.

## D10 — B.1: docs/ux.md §5 carve-out (clarify decision)

**Decision**: amend `docs/ux.md` §5 "No component reads API contracts
directly" to carve out type-only (`import type`) entity imports in leaf
display/presentational patterns; value (runtime) imports of `@/api/types`
in components remain forbidden. Verify the three flagged files
(`title-with-summary.tsx`, `org-tables.tsx`, `docker-targets/index.tsx`)
use only `import type` — confirmed — and grep `ux/components/patterns/`
for any runtime `@/api/types` import to confirm none exist.

**Rationale**: clarify session chose the carve-out; ~20 `ux/` files
already import API types, all flagged ones are type-only, and a mapper
layer for org/docker-target/importer entities is deferred work.

## D11 — B.8: `?status=` confirmed (clarify decision)

**Decision**: no code. The clarification is recorded in spec.md; FR-013
closed. Optionally note the convention in `docs/ux.md` list-state section
if a natural anchor exists — implementer's discretion, not required.

## D12 — A.3 load flakes: no new work

**Decision**: out of scope per spec. `retries: 1` (52c3184) already
absorbs the observed flake class; the two full-suite-only failures passed
on targeted rerun. If they recur during this spec's e2e runs, apply the
same retry treatment — do not re-architect the rate limit.
