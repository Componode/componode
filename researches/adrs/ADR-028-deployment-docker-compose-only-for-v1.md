### ADR-028 — Deployment: Docker Compose only for v1

> **Status:** Ratified

**Context**: The prior project targeted Kubernetes via Kustomize. For an OSS
v1, the deployment surface should be minimal.

**Decision**: **Docker Compose only for v1.** `docker compose up` brings up
Postgres + backend + frontend. K8s/Helm packaging is a community-contributed
follow-on.

**Rationale**: One path that works, not two paths where one is perpetually
half-maintained. `docker compose up` is the OSS self-hosted default (Grafana,
Backstage, Plausible, Posthog). A community member who wants Helm will
contribute it.

## Amendment 1 — Agent image builds with the stack (2026-10-22)

`docker-compose.yml` gains an `agent` service that builds
`Dockerfile.agent`, so `docker compose build` produces the agent image
together with the hub image. The service declares `deploy.replicas: 0` —
`docker compose up` still brings up only Postgres + backend + frontend, and
the agent starts only on an explicit `docker compose up --scale agent=1`
once an enrollment token is configured. Agents continue to run on remote
hosts per ADR-116; the in-stack service shares the `app` network namespace
so a co-located test agent can reach the hub over loopback (plaintext
`http://`/`ws://` stays refused for non-loopback hosts — the TLS
requirement is unchanged).