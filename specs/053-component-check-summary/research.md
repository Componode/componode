# Research: Component Check Summary (spec 053)

Phase 0 decisions for the G2 gap from
[researches/url_check_monitoring_gap_analysis.md](../../researches/url_check_monitoring_gap_analysis.md).
Every NEEDS CLARIFICATION in Technical Context resolved; all choices map
to spec FRs.

## R1 — Where the summary data comes from

**Decision**: extend the existing `GET /components/:componentId/url-checks`
list response. Each `UrlCheckListItem` gains two fields:

- `summary: UrlCheckSummary` — `{window: "24h", availability, p95,
coverageGap, counts{success, failure, missed}}`, computed with the same
  formulas `getMetrics` already implements (missed counts as unsuccessful;
  percentiles over `SUCCESS` observations only).
- `recent: UrlCheckObservation[]` — the ≤12 most recent observations,
  the exact payload the `Recent` dot strip already renders.

**Rationale**: FR-007 requires a bounded read whose request count is
constant in check count. The card already makes exactly one list request;
embedding the summary there keeps it at one request total. A second
per-component aggregate endpoint would also satisfy the bound but adds a
new route, permission row, and OpenAPI surface for zero new capability.

**Alternatives considered**:

- _Per-check `GET /url-checks/:id/metrics` calls from each row_ — rejected:
  this is exactly the fan-out the gap flags (N requests for N checks).
- _New `GET /components/:id/url-checks/summary` aggregate endpoint_ —
  rejected: two requests where one suffices; more contract surface.
- _Reuse `UrlCheckMetrics` as the embedded shape_ — rejected: it carries
  p50/p99/errorRate/latest/vantage/target the table does not render;
  the compact `UrlCheckSummary` type keeps the contract honest about
  what the list guarantees. `getMetrics` stays the formula reference.

## R2 — Windowed aggregate query shape

**Decision**: one `GROUP BY urlCheckId` query over
`url_check_observations` filtered to `urlCheckId IN (:checks)` and
`scheduledAt >= now() - 24h`, selecting per-outcome `countAll().filterWhere(...)`
counts and `percentile_cont(0.95) within group (order by case when
outcome = 'SUCCESS' then "durationMs" end)` as `p95` — the `sql` tagged
template mirrors the existing `getMetrics` percentile calls, and
`percentile_cont` ignores null inputs so the `CASE` scopes percentiles
to successful timed responses without a second scan.

**Rationale**: FR-010 requires a bounded query shape — one aggregate
query serves every check on the Component. The `CASE`-inside-order-by
form keeps it to a single query: PostgreSQL's `FILTER` clause is not
supported with ordered-set aggregates, so `percentile_cont ... filter
(where outcome = 'SUCCESS')` is not available.

**Alternatives considered**:

- _Two grouped queries (counts + percentiles)_ — viable fallback; the
  single-query form is still constant-cost and halves round trips.
- _Call `getMetrics` per check_ — rejected: N+1 at the SQL layer,
  the same fan-out moved server-side (violates FR-010).
- _Pre-aggregated rollup table_ — rejected: ADR-124 already rejected
  pre-aggregated rollups for percentiles; observations are retained
  30 days and the window aggregate over ≤~8.6k rows/check is cheap.

## R3 — Recent-observations read

**Decision**: one query — `row_number() over (partition by "urlCheckId"
order by "scheduledAt" desc)` in a subquery over the same `IN (:checks)`
set, outer-select `where rn <= 12`, then `observationToApi`. Returns
descending per check; the frontend reverses to oldest→newest as it does
today.

**Rationale**: the strip depth (12) and dot payload are unchanged —
only the data source moves into the bounded read (FR-008). A window
function is the single-query shape; the existing `DISTINCT ON` latest
query stays separate because "latest 1" and "latest 12" are different
projections and merging them adds complexity, not savings.

**Alternatives considered**:

- _LATERAL join top-12 per check_ — Postgres-native and fine, but the
  `row_number` subquery is the more portable/readable Kysely shape and
  equally bounded.
- _Return the last 12 inside the aggregate query via array_agg_ —
  rejected: `array_agg` with an ordered slice per group is legal but
  produces nested rows the mapper must unpack; a flat row set reuses
  `observationToApi` untouched.

## R4 — Coverage-gap presentation in the row

**Decision**: when `summary.counts.missed > 0`, the availability cell
renders the figure plus a small warning-toned annotation ("· N missed"
with a tooltip naming the monitor-side coverage gap) — matching the
detail page's coverage-gap note. An all-missed window shows the low
availability figure with the same annotation, so "monitor was down"
never reads as "endpoint is down".

**Rationale**: FR-006 requires coverage gaps distinguishable from
endpoint failures in the compact surface; the counts already ride in
`summary`, so the presentation needs no extra data.

## R5 — Empty and partial states

**Decision**: a check whose `counts` are all zero (no observations in the
window — new check, disabled with purged history, or a coverage gap with
zero recorded slots) shows an explicit "No data yet" presentation in
both summary cells — never `0%` or `100%`. `p95` alone is null → "—"
when the window has observations but no successful timed responses
(all-failure window shows true low availability with empty latency).

**Rationale**: FR-005 forbids fabricated figures; `availability: null`
from the API is the honest signal and the mapper preserves it.

## R6 — Fan-out verification strategy

**Decision**: two test layers. Frontend unit test spies
`useUrlCheckObservations` and asserts it is not called when the card
renders rows (the hook stays mocked for the detail-page tests in the
same file). Backend integration test asserts the list response carries
a correct `summary` and `recent` per check across the empty, all-missed,
partial, and many-check fixtures.

**Rationale**: the contract test cannot observe "number of SQL queries",
so the bounded shape is enforced by construction (constant query calls in
`listChecks`) plus response-shape assertions; the per-row-request removal
is directly testable on the hook boundary.

## R7 — Contract and doc surfaces

**Decision**: `UrlCheckSummary` joins `packages/core` contracts and the
OpenAPI `components/schemas`; `UrlCheckListItem` extends in place (same
route, same 200 shape plus two fields — additive, backward-compatible).
`docs:api` regenerates `docs/api.md`. `docs/url-checks.md` documents the
two columns and the missed-slot annotation. **ADR-124 Amendment 2**
records the read-path extension: ADR-124's decision list names the API
surfaces as closed contract, and the ADR-fidelity rule requires the
amendment in the same change.

**Rationale**: additive response fields need no migration and no
protocol/version bump; only the ADR's surface inventory changes.

**Alternatives considered**:

- _No ADR amendment (additive changes don't count)_ — rejected: ADR-124
  enumerates the URL Check API surface as a closed contract; extending a
  listed response is a surface change and the repo's ADR-fidelity rule
  keeps the ADR as the accurate record.
