# Quickstart: Edge Suggestions

Runnable validation for the three slices. Prereqs: stack running per
`README.md` (`docker compose up` or `pnpm dev`), signed in as an EDITOR+
user (default bootstrap admin is ADMIN), and migration `014` applied. Seed
a recognizable pair first: a GitHub or Kubernetes importer run (or a manual
component named to match a product, e.g. component `payments-shop-api` and
product "Payments Shop").

The reference for API shapes is [contracts/api.md](contracts/api.md);
table/status details are in [data-model.md](data-model.md).

## Scenario 1 — Stage candidates and populate the queue (US2 first — it feeds everything)

1. Run an importer that lands a component whose name overlaps a product's
   name (e.g. repo `payments-shop-api` vs product "Payments Shop").
2. When the run completes, open **Suggestions** in the sidebar — a pending
   row appears for the pair, sorted by score, with a `Name match` chip. No
   user action was needed.
3. Rename another product to share a token with an existing component —
   a candidate for the new name appears; the old-name pairing is untouched
   (still pending until decided or covered).
4. CLI check: `GET /api/v1/suggestions?status=PENDING` returns the rows
   ordered by score descending.
5. `POST /api/v1/suggestions/rescan` (EDITOR+) returns
   `{productsScanned, componentsScanned, staged, superseded}` — running it
   twice returns `staged: 0` on unchanged data (idempotent).

## Scenario 2 — Accept and dismiss (US1)

1. Suggestions page → **Accept** on a pending row — the product's detail
   page now lists that component under Dependencies exactly like a manually
   wired edge; the row leaves the pending queue.
2. Activity feed shows a `DEPENDS_ON_COMPONENT` added entry attributed to
   you — indistinguishable from manual wiring.
3. **Dismiss** another pending row → confirm — it leaves the pending queue
   and is visible under the **Dismissed** filter with your name and the
   decision time.
4. Rescan (or run another import) — neither the accepted nor the dismissed
   pair returns to pending. Decided means decided.
5. Manually wire a still-pending pair via the product's dependency picker —
   the suggestion disappears from the queue (superseded at the next
   generation pass; accept is idempotent if raced).
6. Remove that manual edge — the pair does **not** come back as a
   suggestion. Deliberately unwired stays unwired.
7. Sign in as a VIEWER — the queue reads fine but Accept/Dismiss are
   unavailable (403 on the API).

## Scenario 3 — Group coverage and stale pairs (US1/US2 edges)

1. Put a pending pair's component into a `ComponentGroup` the product
   already depends on (or add the group edge) — the pair is superseded and
   never shows pending again.
2. Accept a suggestion whose component was retired/deleted between staging
   and review — the normal edge-path error surfaces; nothing partial is
   written; the row stays pending (dismiss it or rescan).
3. Retire the product of a pending pair — the row leaves the default queue;
   reactivate the product — it resurfaces still `PENDING`.

## Scenario 4 — Inspect decisions (US3)

1. Filter the queue to **Dismissed** — each row shows product, component,
   reason chip, score, who dismissed, and when.
2. Check an accepted pair's product audit history — the edge entry names
   the accepting user.
3. Every queued row answers "why was this suggested?" via its reason chip —
   `Name match`, `Topic/tag match`, or `Namespace match`.

## Test commands

```bash
pnpm --filter @componode/core test      # suggestion constants + query schema
pnpm --filter @componode/backend test   # incl. test/integration/edge-suggestions.test.ts
pnpm --filter @componode/frontend test  # suggestions page + hooks tests
pnpm docs:api                           # regenerates docs/api.md from openapi.yaml
```

Expected: all green; the OpenAPI contract test passes with the four
`/suggestions` paths documented (`x-permission` on writes, `verifySession`
on the read).
