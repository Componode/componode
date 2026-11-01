### ADR-069 — Prometheus metrics

> **Status:** Ratified

**Context**: [ADR-032](./ADR-032-observability-full.md) lists example metrics. The exact set and labels need
pinning down.

**Decision**: **Metric set approved as proposed in Q48.** Importer metrics
(`componode_importer_runs_total{importer, status, trigger_reason}`,
`..._run_duration_seconds`, `..._assets_processed_total`, `..._assets_created
_total`, `..._assets_updated_total`, `..._instances_orphaned_total`,
`..._components_retired_total`, `..._run_errors_total{importer, error_type}`,
`..._queue_depth`, `..._active_runs`). HTTP metrics
(`componode_http_requests_total{method, route, status}`,
`..._request_duration_seconds`). DB metrics (`componode_db_query_duration_
seconds{operation}`, `..._pool_active_connections`, `..._pool_idle_connections
`). Auth metrics (`componode_auth_login_attempts_total{method, result}`,
`..._auth_active_sessions`). The `/metrics` endpoint is **unauthenticated**
(standard Prometheus scrape pattern), protected by being on a separate port
or path that the deployer's network policy restricts (documented in
`docs/deployment.md`).

**Rationale**: `importer` label is the importer name (low-cardinality, 7
values), not config ID (high-cardinality). `status` label uses terminal
statuses only (transient statuses would create series that never get a final
value). `route` label uses normalized route patterns (not raw paths with
UUIDs). No per-user/per-session labels (high-cardinality, security-relevant).
Histograms use Prometheus default buckets.

## Amendment 1 — URL Check probe series (2026-11-01, ADR-124)

**Refinement**: `url_check_probes_total{vantage, outcome, errorType}`
counter and `url_check_probe_duration_seconds{vantage}` histogram join
the metric inventory — bounded enum labels only. No check id, URL, or
config labels; the low-cardinality rule stands unchanged.

---

**Amended by ADR-124**: the inventory gains `url_check_probes_total` and
`url_check_probe_duration_seconds` under the existing bounded-label
policy; see Amendment 1.