# Contracts: Spec-068 follow-ups — e2e spec debt and list-standards cleanup

No HTTP API changes — `docs/openapi.yaml` is untouched (ADR-104 N/A). The
contracts below are internal code contracts the implementation must
honor.

## C1 — 400 validation envelope (B.2 / FR-006)

Every route-level input rejection returns, via `validationFailed`:

```json
{ "code": "VALIDATION_FAILED", "message": "Invalid input", "details": [ /* zod issues */ ] }
```

- Applies to query-param AND body validation failures — one message.
- Forbidden after this spec: `message: "Invalid query"`,
  `message: "Invalid query parameters"`, file-local `invalid()` helpers,
  and any other hand-rolled 400 `{code,message,details}` construction.
- `sendServiceError`'s ZodError path already delegates to
  `validationFailed` — unchanged.

## C2 — Sort ordering contract (B.3 / FR-010)

For every migrated list endpoint:

- The set of orderable targets is declared once per service as a
  `Record<SortKey, target>`; the endpoint's Zod sort enum and the map's
  key set are identical.
- Unknown `sort` values still fail schema validation (400) — the map is
  never a second, wider whitelist.
- Ordering semantics are byte-for-byte preserved: same primary target,
  same direction, same deterministic tiebreak (`id` or the documented
  equivalent, e.g. audit's `createdAt desc, id asc`).
- Computed sorts keep their select-alias/`sql`-expression targets
  (`worstStatus`, `boundConfigCount`, `ACTOR_SORT`, `ENTITY_TYPE_SORT`).

## C3 — List-param adapters (B.4 / FR-007)

- `facetParam(state, key)` is the only definition of the
  `undefined | "" | "all" → undefined` sentinel mapping; all list-param
  builders (`componentsListParams`, `productsListParams`,
  `activityFeedParams`, and any sibling adapters found at implementation)
  consume it.
- One debounced-param hook serves both search (`""` unset) and filter
  (`"all"` unset) inputs; `activity.tsx` no longer defines its own.

## C4 — Pagination hook contract (B.5 / FR-012)

- `useSuggestions(view, { status, page, pageSize, sort, order })` —
  positional `offset`/`limit` args no longer compile.
- `useActivityFeed` / `useEntityHistory` accept `page`/`pageSize` only;
  `limit`/`offset` keys are not part of `ActivityFeedQuery`.
- Behavior preserved: sidebar badge (`pageSize: 1`), product-detail
  suggestions (`pageSize: 100`), entity-history default page size 25.

## C5 — Playwright journey contracts (Part A / FR-001..005)

- Product detail: Map tab exists; `?tab=map` selects it; topology,
  lanes, inspection panel, `+N`, keyboard, overflow, reduced-motion all
  asserted on that tab; empty product → `No relationships yet`.
- Component detail Relationships tab: only lanes with data (or failed
  loads) render; fixture populates `productDependents` + Instances;
  empty lanes absent; provenance labels and nested instances asserted.
- Both spec files pass on every Playwright project.

## C6 — Docs conventions (B.1 / B.7 / B.8)

- `docs/ux.md` §5 documents the type-only-import carve-out for leaf
  patterns.
- `ENTITY_TYPE_LABELS` lives in exactly one module; `importer_config`
  renders "Importer config".
- `?status=` on /suggestions is the accepted convention (recorded; no
  `?tab=` refactor).
