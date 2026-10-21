### ADR-097 — Rate limiting

> **Status:** Ratified

**Context**: Without rate limiting, a single user or compromised session
can DoS the backend or Postgres. Importer triggers are a specific DoS
vector.

**Decision**: **Rate-limiting Fastify plugin with in-memory store for v1.**
Login: 5 per username/IP per min. OIDC callback: 5 per IP per min.
Registration: 3 per IP per min. Importer trigger: 10 per user per min.
General API: 300 per user per min. `/metrics`: unlimited. Responses include
`Retry-After` header. General API limit is per-user (session ID), not per-
IP (corporate NAT safety). Multi-instance requires Redis (post-v1, known
v1 limitation). All `/api/v1/*` routes are authenticated (Viewer minimum
per [ADR-054](./ADR-054-rbac-permission-matrix.md)).

**Rationale**: 300/min general limit accommodates dashboard polling (5
concurrent run polls at 2s intervals = ~150/min) plus normal UI
interactions. Per-user keying (not per-IP) prevents a corporate NAT with
100 users from sharing a single limit. Importer trigger keyed per-user
([ADR-039](./ADR-039-importer-trigger-auth-boundary.md)'s per-config in-flight guard handles per-config spam).

---

**Amended by ADR-116**: the "all `/api/v1/*` routes are authenticated"
clause gains a non-session exception — `GET /api/v1/agent/stream` is
authenticated by a dedicated agent bearer-credential middleware (not
`verifySession`), and `POST /api/v1/agent/enroll` is public (single-use
enrollment-token exchange). Session-authed routes are unchanged.