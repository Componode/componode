# Quickstart: validating spec 069

Prerequisites: repo installed (`pnpm install`), Playwright workload stack
able to start (`pnpm e2e` handles its own stack per `playwright/` docs).

## 1. E2E spec debt (Part A)

```bash
cd playwright
pnpm e2e -- tests/journeys/product-map.spec.ts tests/journeys/component-relationships.spec.ts
```

Expected: all tests pass on every configured project (previously 10
consistent failures). Spot-check the rewritten assertions:

- `product-map.spec.ts` navigates to `?tab=map`; asserts the Map tab is
  `aria-selected`; empty product shows "No relationships yet".
- `component-relationships.spec.ts` expects only populated lanes;
  `Depended on by`/`Depends on` (and any other data-less lane) are absent;
  no `'None'` empty-state assertions remain.

## 2. Backend unifications (B.2, B.3)

```bash
cd packages/backend
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Spot checks:

- `grep -rn 'message: "Invalid query' src/routes` → no hits;
  `message: "Invalid query parameters"` → no hits; docker-targets
  `invalid()` gone. All 400s flow through `validationFailed`.
- `grep -rn 'sort ===' src/services` → no ternary dispatch chains remain;
  each service declares a sort map whose keys match its Zod sort enum.
- Integration tests still pass (ordering semantics unchanged).

## 3. Frontend unifications (B.4, B.5, B.6, B.7)

```bash
cd packages/frontend
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Spot checks:

- `useSuggestions(` call sites all pass an options object; no positional
  `offset`/`limit` callers; `normalizeFeedQuery` legacy path gone.
- `facetParam` defined once; `componentsListParams`,
  `productsListParams`, `activityFeedParams` consume it.
- One debounced-param hook; `activity.tsx` has no local
  `useDebouncedFilter`.
- `SummaryRowMap` has no `& { … }` intersections; view-type `ImportRun`
  carries `completedAt`.
- `ENTITY_TYPE_LABELS` exists only under `ux/lib/`; activity page imports
  it; `importer_config` label reads "Importer config".

## 4. Docs (B.1, B.8)

- `docs/ux.md` §5 mentions the type-only-import carve-out for leaf
  patterns.
- `pnpm docs:sidebar:check` / `docs:oracle:check` clean if docs scripts
  cover the touched pages.

## 5. Full sweep

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # root
cd playwright && pnpm e2e                                # full workload
```
