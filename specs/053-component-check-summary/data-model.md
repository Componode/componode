# Data Model: Component Check Summary (spec 053)

No schema changes. All figures derive at read time from the existing
`url_check_observations` table; no new entities, migrations, or CHECK
constraints. One new derived contract type and one extended list item.

## Derived contract types (packages/core)

### `UrlCheckSummary` (new)

Compact per-check windowed rollup embedded in the list response.
Field names and semantics mirror `UrlCheckMetrics` so the two surfaces
cannot drift:

| Field          | Type                         | Semantics                                                               |
| -------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `window`       | `"24h"`                      | Fixed rolling window for the compact summary (clarified 2026-11-02)     |
| `availability` | `number \| null`             | `SUCCESS / (SUCCESS + FAILURE + MISSED)`; `null` when nothing scheduled |
| `p95`          | `number \| null`             | `percentile_cont(0.95)` over SUCCESS `durationMs`; `null` when none     |
| `coverageGap`  | `number`                     | `MISSED / scheduled`; `0` when nothing scheduled                        |
| `counts`       | `{success, failure, missed}` | Outcome counts inside the window                                        |

### `UrlCheckListItem` (extended)

```ts
interface UrlCheckListItem extends UrlCheck {
  latest: UrlCheckLatest | null;
  summary: UrlCheckSummary; // always present; nulls inside mean "no data"
  recent: UrlCheckObservation[]; // ≤12, scheduledAt desc
}
```

`summary` is always present (never null) — its inner fields carry the
no-data signal, keeping the response shape uniform across rows.

## Existing entities (unchanged)

- **`url_checks`** — row unit; unchanged.
- **`url_check_observations`** — sole source of `summary` and `recent`;
  30-day retention unchanged; `outcome` enum unchanged (no `SATURATED`
  additions beyond spec 052's already-shipped value).
- **`component_monitoring_setups`** — supplies the vantage label the card
  already renders; unchanged.

## Validation rules

- `window` is always `"24h"` on the compact summary; the per-check
  metrics endpoint keeps its `24h|7d|30d` parameter.
- `recent` is capped at 12 entries per check, newest first — same depth
  the strip rendered via per-row requests before.
- Percentile semantics are identical to `getMetrics`: ordered-set
  aggregate over `durationMs` of `SUCCESS` observations only; `MISSED`
  counts as unsuccessful in `availability` (conservative SLI).

## State transitions

None — read-path only.
