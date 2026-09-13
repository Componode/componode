### ADR-101 — Database connection security

> **Status:** Ratified

**Context**: The database connection is the crown-jewel trust boundary.
Without TLS, the connection string and all query data are sniffable. Without
pool limits, a burst of requests can exhaust Postgres connections. Without
least-privilege, a SQL injection can `DROP DATABASE`.

**Decision**: **(1) TLS: `DATABASE_SSL_MODE` env var (default `require` in
production, `disable` in dev; `verify-full` for remote Postgres with
`DATABASE_SSL_CA`). (2) Pool limits: `MAX_DB_CONNECTIONS` env var (default
10), with documented pool budget calculation. (3) Credential rotation:
update env var + restart. (4) Least-privilege DB user: `init-db.sql` script
in the example `docker-compose.yml` creates a `componode` user with
`CONNECT` + DML/DDL on `public` schema (not the Postgres superuser). (5)
Migration privileges: single user for DDL+DML in v1; split
(`MIGRATION_DATABASE_URL` for DDL, `DATABASE_URL` for DML-only) is v1.1.
(6) Driver: chosen by spec 001-foundation; MUST support TLS, prepared
statements, configurable pool limits.

**Rationale**: `require` (not `verify-full`) as default because the Docker
Compose deployment has Postgres on the same Docker network (low MITM risk).
`verify-full` documented for remote Postgres. The `init-db.sql` is an
enforceable artifact (not just documentation). The migration-privilege
split is deferred to v1.1 (adds complexity for a hardened-deployment
minority).

**Amendment (2026-09-10 security assessment)**: (a) The `require`-in-
production default is now implemented — previously the code defaulted to
`disable` in every environment. The bundled Compose Postgres has no TLS, so
`docker-compose.yml` and `.env.example` set `DATABASE_SSL_MODE=disable`
explicitly. (b) Startup platform preflight: before migrations, the backend
verifies `server_version_num >= 140000` (PostgreSQL 14+) and that the
`pgcrypto` extension exists, creating it when the database user has the
privilege. `init-db.sql` pre-creates it for the bundled Compose database.