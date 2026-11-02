# HTTP API Contract: Component Check Summary (spec 053)

One changed response — additive fields on the existing list endpoint.
No new routes, no removed fields, no parameter changes.

## `GET /api/v1/components/:componentId/url-checks`

**Auth**: session (any role that can view the component) — unchanged.

**200 response** (extended):

```jsonc
{
  "setup": { "/* MonitoringSetup — unchanged */": "…" },
  "checks": [
    {
      "/* UrlCheck fields — unchanged */": "…",
      "latest": { "/* UrlCheckLatest | null — unchanged */": "…" },

      // NEW — compact 24h rollup (FR-001/002/005/006)
      "summary": {
        "window": "24h",
        "availability": 0.975, // number | null — null when nothing scheduled in window
        "p95": 340, // number | null — null when no successful timed responses
        "coverageGap": 0.0125, // MISSED / scheduled; 0 when nothing scheduled
        "counts": { "success": 78, "failure": 1, "missed": 1 },
      },

      // NEW — last ≤12 observations, scheduledAt desc (FR-008)
      "recent": [
        {
          "id": "uuid",
          "urlCheckId": "uuid",
          "scheduledAt": "2026-11-02T10:00:00Z",
          "outcome": "SUCCESS", // SUCCESS | FAILURE | MISSED
          "httpStatus": 200, // number | null
          "durationMs": 118, // number | null
          "errorType": null, // UrlCheckErrorType | null
          "vantage": "HUB", // HUB | AGENT
          "agentId": null, // uuid | null
          "createdAt": "2026-11-02T10:00:01Z",
        },
      ],
    },
  ],
}
```

### Semantics

- `summary.availability` counts `MISSED` as unsuccessful (conservative
  SLI) — identical formula to `GET /url-checks/:id/metrics?window=24h`.
- `summary.p95` is `percentile_cont(0.95)` over `SUCCESS` `durationMs`
  in the same window — request-start → response-headers, the same
  measurement boundary as the detail metrics.
- `summary` is always present; `null` inner fields are the no-data
  signal (new check, empty window). It is never omitted.
- `recent` is empty `[]` when the check has no observations.
- Bounded shape: one request returns every row's `latest`, `summary`,
  and `recent`; the handler executes a constant number of queries
  independent of check count.

### Errors

Unchanged — `400 VALIDATION_FAILED` (bad `componentId`), `401`,
`404 COMPONENT_NOT_FOUND`.

## Unchanged surfaces

- `GET /url-checks/:id`, `PATCH`, `DELETE` — untouched.
- `GET /url-checks/:id/metrics?window=24h|7d|30d` — untouched; remains
  the detail page's full-window source and the formula reference.
- `GET /url-checks/:id/observations` — untouched; remains the
  cursor-paginated history read (no longer called per table row).
- `GET|PUT /components/:componentId/monitoring-setup` — untouched.
