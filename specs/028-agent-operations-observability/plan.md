# Implementation Plan: Agent Operations Observability

**Branch**: `028-agent-operations-observability` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/028-agent-operations-observability/spec.md`

## Summary

Give both sides of an Import Agent deployment real operations visibility.
The agent gains a local `node:http` ops listener — `/healthz`, `/readyz`,
`/metrics` (prom-client) — wired into the image `HEALTHCHECK`, plus a
single counter registry that also feeds an `ops` snapshot riding the
existing heartbeat frame. The hub persists the latest snapshot on
`import_agents."reportedStatus"`, exposes it plus live heartbeat freshness
and last disconnect reason on the agent read surfaces, and adds four
Prometheus series covering dispatch wait, remote job duration, session
duration, and last-contact staleness. Docs and ADR-116 Amendment 3 ratify
the new surfaces.

## Technical Context

**Language/Version**: TypeScript 6, Node 24 (per repo stack)

**Primary Dependencies**: existing — `node:http`, `ws`, `zod`, `pino`
(agent); Fastify, Kysely, `prom-client` (backend). **New**: `prom-client`
added to `packages/agent` (same version family as backend).

**Storage**: PostgreSQL — one nullable `jsonb` column on `import_agents`
(migration `019_agent_ops_observability`); live heartbeat freshness stays
in-memory on `AgentSessionService`.

**Testing**: vitest unit tests (agent, frontend), testcontainers
integration tests (backend) — existing harnesses.

**Target Platform**: Docker container (`Dockerfile.agent`), Linux/Windows
dev.

**Project Type**: pnpm monorepo feature across `packages/agent`,
`packages/core`, `packages/backend`, `packages/frontend`.

**Performance Goals**: ops listener adds one HTTP surface + one UPDATE per
agent heartbeat (~30 s) — negligible; no new per-run cardinality.

**Constraints**: outbound-only agent channel preserved; no secrets/paths/
env names on any ops surface; ops listener failure must never affect agent
function (FR-005); `sql.raw` forbidden (ADR-084); Zod at boundaries
(ADR-095).

**Scale/Scope**: small agent fleets (single-digit agents typical); session
history unchanged.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-org** — PASS: no tenancy introduced.
- **II. Importer-first** — PASS: no importer changes; agent stays dumb.
- **III. Two-level taxonomy** — N/A.
- **IV. Environment-as-instance** — N/A.
- **V. Factual vs meaning** — PASS: operational telemetry is neither
  importer facts nor curated hierarchy.
- **VI. Test-first** — PASS: tasks order failing tests before
  implementation per package.
- **VII. Observability from day one** — PASS: this feature *is* the
  instrumentation; agent counters/log events ship with the code paths
  they observe; unauthenticated ops surface mirrors the ratified
  `/metrics` posture (network-policy-restricted).

No violations → no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/028-agent-operations-observability/
├── plan.md              # This file
├── research.md          # Phase 0 decisions D1–D9
├── data-model.md        # Phase 1: schema + payload shapes
├── contracts/
│   ├── agent-ops-endpoints.md  # agent-local listener contract
│   └── api-deltas.md           # hub API response deltas + metrics catalog
├── quickstart.md        # runnable validation guide
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── core/src/contracts/agent-protocol.ts   # heartbeatPayloadSchema + ops
│      constants/import-agent.ts           # AGENT_PROTOCOL_VERSION bump
├── agent/src/
│   ├── ops-server.ts      # NEW: node:http /healthz /readyz /metrics
│   ├── metrics.ts         # NEW: prom-client registry + counter helpers
│   ├── config.ts          # AGENT_OPS_* env parsing
│   ├── client.ts          # heartbeat ops payload, readiness signal, session counters
│   ├── executor.ts        # job/asset counter hooks
│   └── main.ts            # ops server lifecycle + reconnect counter
├── backend/src/
│   ├── db/migrations/019_agent_ops_observability.ts  # "reportedStatus" jsonb
│   ├── db/types.ts                                   # ImportAgentRow field
│   ├── plugins/metrics.ts                            # 4 new series
│   ├── services/agent-session-service.ts             # ops capture, lastHeartbeatAt reader
│   └── services/agent-service.ts                     # payload fields, latest-session join
├── frontend/src/
│   ├── pages/agent-detail.tsx   # heartbeat freshness + agent-reported block
│   ├── pages/agents.tsx         # last-disconnect column
│   └── api/types.ts + api/hooks/agents.ts
├── Dockerfile.agent               # HEALTHCHECK
└── docs/  agents.md, agent-protocol.md, openapi.yaml
researches/adrs/ADR-116-remote-import-agents.md  # Amendment 3
researches/architecture-decisions.md             # index amends line
```

**Structure Decision**: follows the established 025–027 feature layout —
protocol contract in `core`, hub-side state in backend services, agent
runtime surfaces in `packages/agent`, admin UI on the existing agents
pages.

## Phase 0 — Research

See [research.md](research.md). All decisions resolved — no
NEEDS CLARIFICATION items remain. Ratified-boundary surfaces (agent env
vars, wire payload, metric series, agent read fields) are handled by
ADR-116 Amendment 3 in the same change (ADR fidelity rule).

## Phase 1 — Design

- [data-model.md](data-model.md) — `"reportedStatus"` jsonb shape,
  in-memory session freshness, payload contracts.
- [contracts/agent-ops-endpoints.md](contracts/agent-ops-endpoints.md) —
  agent-local listener contract.
- [contracts/api-deltas.md](contracts/api-deltas.md) — hub read-surface
  deltas + metric series catalog.
- [quickstart.md](quickstart.md) — end-to-end validation walkthrough.

## Post-design Constitution Check

Re-evaluated after Phase 1 — PASS on all seven principles; the one new
unauthenticated surface (agent ops listener) is a documented,
network-restricted local endpoint in the same class as the ratified hub
`/metrics` exception, recorded in ADR-116 Amendment 3 rather than ADR-097
(it is not a hub `/api/v1` route).
