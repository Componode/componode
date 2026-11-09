# Data Model: Spec-068 follow-ups — e2e spec debt and list-standards cleanup

No database or persisted-data changes. This spec touches test expectations,
route-helper usage, service-layer ordering declarations, frontend hook/type
conventions, and docs. The "entities" below are code-level contracts, not
domain records.

## Contract entities

### `validationFailed(reply, issues)` — existing, becomes canonical (B.2)

- **Location**: `packages/backend/src/routes/route-helpers.ts` (exists).
- **Signature**: `(reply: FastifyReply, issues: unknown) => FastifyReply`
- **Response**: `400 { code: "VALIDATION_FAILED", message: "Invalid input",
  details: issues }`
- **Rule**: every route-level `safeParse` failure MUST call this helper;
  no hand-rolled `{ code, message, details }` 400 envelopes.

### Per-service sort map (B.3)

- **Shape**: `Record<SortKey, string | RawBuilder<unknown>>` declared near
  each service (module-level `const`, `as const` where the key set is
  closed). Values are Kysely `orderBy` targets: table-qualified column
  names, select aliases (e.g. `boundConfigCount`, `worstStatus`), or `sql`
  template expressions (e.g. audit's `ACTOR_SORT`).
- **Application**: inside `paginateQuery`'s `orderBy` callback (or the
  service's manual ordering block for audit/edge-suggestion), resolve
  `SORT_MAP[sort] ?? DEFAULT_TARGET`, apply `.orderBy(target, order)`, then
  the existing deterministic tiebreak (`id` or documented equivalent).
- **Whitelist coupling**: map keys MUST equal the endpoint schema's sort
  enum — a sort key absent from the map falls back to the documented
  default, and unknown keys still fail Zod `.strict()` upstream (ADR-095).
- **Special cases**: edge-suggestion-service resolves an effective sort
  first (status/createdAt/decidedAt-view/score) then orders; its `score`
  branch keeps its extra `createdAt asc, id asc` tiebreaks.

### `facetParam(state, key)` — new shared helper (B.4)

- **Location**: shared module under `packages/frontend/src/api/hooks/`
  (e.g. `list-params.ts`).
- **Signature**: `(state: ListQueryState, key: string) => string | undefined`
- **Semantics**: returns `state.filters[key]` unless it is `undefined`,
  `""`, or the `"all"` sentinel → `undefined`. Replaces the three identical
  copies (`facet` ×2, `auditFacet` ×1).

### Debounced filter hook — consolidated (B.4)

- **Location**: `packages/frontend/src/ux/hooks/` (extend or sibling of
  `use-list-search.ts`).
- **Contract**: one hook providing `[input, setInput]` with two-way
  debounce sync (URL → input on external change; input → commit ~300 ms
  after typing stops), parameterized by unset sentinel (`""` for search,
  `"all"` for filters) and commit callback. `useListSearch` and
  `useDebouncedFilter` become thin wrappers or are replaced at call sites.

### Pagination hook signatures — single contract (B.5)

- **`useSuggestions(view, options?)`**: only the
  `{ status, page, pageSize, sort, order }` options-object signature
  remains; positional `(view, offset, limit)` is removed.
- **`useActivityFeed(query)` / `useEntityHistory(type, id, query)`**:
  `ActivityFeedQuery` keeps `page`/`pageSize`; `limit`/`offset` keys and
  `normalizeFeedQuery`'s translation layer are removed (any residual
  normalization inlined).

### View-type promotions (B.6)

- `ux/lib/view-types.ts` `ImportRun` gains `completedAt: string | null`
  (already on `api/types.ts` `ImportRun` and produced by
  `mappers/operations.ts`).
- `SummaryRowMap` (`title-with-summary.tsx`) drops all `& { … }`
  intersections; fields real payloads carry move onto the proper view/API
  types; fields no payload carries are deleted.
- Org list rows (`TeamEntity`/`OrgEntity` intersections) and suggestion
  rows: verify field presence on the underlying type, then remove the
  intersection — no new intersections at call sites.

### Entity-type label registry (B.7)

- **Location**: `packages/frontend/src/ux/lib/entity-type-labels.ts` (new).
- **Shape**: `Record<string, string>` mirroring the audit entity-type
  vocabulary; `importer_config` → `"Importer config"`.
- **Consumer**: `ux/app/activity.tsx` filter dropdown (only consumer).

### Documentation carve-out (B.1)

- `docs/ux.md` §5 gains an explicit exception: `import type` entity
  imports are permitted in leaf display/presentational patterns;
  runtime value imports of `@/api/types` in components remain forbidden.
