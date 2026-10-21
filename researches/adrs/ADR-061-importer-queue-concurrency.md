### ADR-061 — Importer queue concurrency

> **Status:** Ratified

**Context**: [ADR-060](./ADR-060-importer-run-coordination.md) established a bounded queue. What is the concurrency
limit?

**Decision**: **`IMPORTER_MAX_CONCURRENCY` env var, default 3, global
semaphore across configs.** Per-config guard ([ADR-039](./ADR-039-importer-trigger-auth-boundary.md)) already enforces
1-per-config, so the only meaningful knob is the global limit. Restart to
change (concurrency limits are infrastructure-sizing decisions).

**Rationale**: Default 3 is conservative for a fresh Docker Compose deployment
(Postgres default `max_connections = 100`, backend pool ~10, leaving
headroom). Env-var approach matches the "deployer brings infra" posture. A
deployer who knows their Postgres has `max_connections = 50` can tune down.
No per-config concurrency field (it's always 1 per [ADR-039](./ADR-039-importer-trigger-auth-boundary.md)).

---

**Amended by ADR-116**: `maxConcurrentJobs` advertised in the agent's
`hello` replaces `IMPORTER_MAX_CONCURRENCY` for remote runs; in-process
runs are unchanged.