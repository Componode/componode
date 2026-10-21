### ADR-060 — Importer run coordination

> **Status:** Ratified

**Context**: [ADR-022](./ADR-022-importer-execution-scheduled-on-demand.md) says scheduled + on-demand. How is a run actually
started?

**Decision**: **`202 Accepted` + `{runId}`; bounded in-process queue;
`PENDING`-on-restart → `INTERRUPTED`; clients poll for status.** Both
scheduler and HTTP trigger call a shared `RunService.start(configId,
triggeredBy)`, which checks the in-flight guard ([ADR-039](./ADR-039-importer-trigger-auth-boundary.md): one per config,
`409`), creates a `PENDING` row, enqueues into a bounded queue ([ADR-061](./ADR-061-importer-queue-concurrency.md)). The
HTTP response is `202` with `{runId}` — the client polls
`GET /api/v1/importers/:configId/runs/:runId`. `PENDING` runs that survive a
restart are marked `INTERRUPTED` (not re-enqueued — re-enqueuing on restart
could trigger a storm if the backend flaps).

**Rationale**: `202 + poll` is the standard for long-running operations (GitHub
Actions, AWS). A bounded queue prevents the thundering-herd problem (10 cron
configs aligning). Re-enqueuing on restart is dangerous (flap storm);
`INTERRUPTED` lets the next cron tick or manual trigger re-run cleanly. SSE/
WebSocket push is post-v1; polling every 2-3s is adequate for a "refresh AWS"
interaction that takes 30-60s.

---

**Amended by ADR-116**: run coordination gains an agent-capacity
dimension — remote runs wait `PENDING` for the bound agent's advertised
`maxConcurrentJobs` (replacing `IMPORTER_MAX_CONCURRENCY` for remote
runs) up to a dispatch timeout.