# Quickstart: Component Check Summary (spec 053)

Runnable validation that the Component checks table shows the compact
24h summary through a bounded read — no per-row observations requests.

## Prerequisites

- pnpm workspace installed (`pnpm install`), Postgres available for
  testcontainers (backend integration tests pull their own image).
- For the manual pass: a running dev stack (`pnpm dev`) with a logged-in
  editor/admin session.

## Scenario 1 — Backend integration tests

```bash
cd packages/backend
pnpm vitest run test/integration/url-checks.test.ts
pnpm vitest run test/integration/url-checks-metrics.test.ts
```

Expected: the list-response assertions cover —

- Each check item carries `summary` (`window: "24h"`, availability with
  MISSED counted unsuccessful, `p95` over successes only, `coverageGap`,
  `counts`) and `recent` (≤12, `scheduledAt` desc).
- A check with zero observations returns `summary.availability: null`,
  `p95: null`, `recent: []` — never fabricated figures.
- A many-check fixture returns a correct `summary`/`recent` per check in
  the single list response.

## Scenario 2 — Frontend unit tests (fan-out removal)

```bash
cd packages/frontend
pnpm vitest run src/test/unit/url-checks.test.tsx
```

Expected: card tests assert each row renders the 24h availability and
p95 cells, the no-data state for a fresh check, the missed-slots
annotation when `counts.missed > 0`, and that
`useUrlCheckObservations` is **not** invoked by the card (the dot strip
reads `check.recent`).

## Scenario 3 — Manual smoke (optional)

1. `pnpm dev`; open a Component with ≥2 URL Checks that have observations.
2. DevTools → Network: loading the page issues **one**
   `/api/v1/components/:id/url-checks` request and **zero**
   `/url-checks/*/observations` requests from the table.
3. Each row shows an availability % and a p95 latency labeled "(24h)";
   the card description still phrases vantage as "reachable from …".
4. A check whose window contains MISSED slots shows the missed
   annotation — not a plain red figure.
5. Open a check's detail page: its 24h figures match the row's values.

## Contract verification

```bash
pnpm docs:api && git diff --exit-code docs/api.md   # generated table current
cd packages/backend && pnpm vitest run test/unit/api-docs-contract.test.ts
```

Expected: OpenAPI `UrlCheckListItem` documents `summary` + `recent`;
the route-coverage contract test passes.
