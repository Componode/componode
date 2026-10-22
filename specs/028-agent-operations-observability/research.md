# Research: Agent Operations Observability

**Feature**: `028-agent-operations-observability` | **Date**: 2026-10-22

Scope guardrail inherited from spec: this is *agent operations* observability
— surfaces that answer "is the agent process alive, connected, and doing
work". Log shipping, alerting engines, agent trace export, and hub-initiated
agent connections remain ratified non-goals (ADR-116, research §12).

## D1 — Agent-local ops listener: `node:http` + `prom-client`

**Decision**: A small `node:http` server inside `packages/agent` serving
three GET routes — `/healthz` (liveness), `/readyz` (readiness),
`/metrics` (Prometheus text exposition via `prom-client`).

**Rationale**: The agent is deliberately a thin host (ADR-116 item 2).
`node:http` adds zero dependencies and is sufficient for three read-only
GET surfaces — no router, body parsing, or middleware needed. `prom-client`
is already the project's metrics library (backend `plugins/metrics.ts`);
reusing it in `packages/agent` keeps exposition format, default-metrics
collection, and registry semantics identical rather than hand-rolling the
text format. Per AGENTS.md dependency rules the package is added with
`pnpm add` at a `^x.y.z` range matching the backend's version.

**Alternatives considered**:

- **Fastify on the agent** — consistent with the hub but pulls a full web
  framework into a thin process for three static GETs; rejected as
  disproportionate.
- **Hand-rolled exposition text** — avoids a dependency but risks format
  drift and duplicates prom-client's default process metrics; rejected.
- **No HTTP surface, file-based health signal** — cannot serve Prometheus
  scrapes and is unidiomatic for orchestrator probes; rejected.

## D2 — Ops listener bind & defaults

**Decision**: `AGENT_OPS_HOST` (default `0.0.0.0`), `AGENT_OPS_PORT`
(default `9464`), `AGENT_OPS_DISABLED` (`"true"` disables). New agent env
vars → ADR-116 amendment (the env list is an enumerated surface).

**Rationale**: Default-on is required for the image `HEALTHCHECK` to work
with zero configuration (spec FR-006, SC-001). `0.0.0.0` because the
useful consumer (a Prometheus scraper or orchestrator probe in the agent's
own network) is outside localhost; operators can rebind to `127.0.0.1` or
disable. The surface is unauthenticated — same posture as the hub's
`/metrics` (constitution VII permit: "unauthenticated but
network-policy-restricted"). It serves GET-only state/counters — no
request bodies, no secret material (spec FR-004).

Port `9464` sits in the conventional exporter range and avoids collisions
with Prometheus itself (9090/9091) and common exporters.

## D3 — Readiness vs liveness semantics

**Decision**: `/healthz` → `200 {status:"ok"}` whenever the process is up
(config loaded, credential material resolved). `/readyz` → `200` only
while a stream session is established (post-`hello.ok`); `503` with
`{ready:false, state}` otherwise.

**Rationale**: A hub outage puts the agent in reconnect backoff — that is
*not ready*, not *dead*. Liveness staying `200` through backoff prevents
restart loops (spec edge case); readiness reflecting connectivity gives
orchestrators and operators the distinct signal.

## D4 — Agent-reported snapshot: extend `heartbeat` payload

**Decision**: `heartbeatPayloadSchema` gains an optional strict `ops`
object — the snapshot rides the existing ~30 s heartbeat; no new frame
type, no new channel (spec FR-012, outbound-only preserved).

```text
ops?: {
  reportedAt: ISO string
  uptimeSeconds: int >= 0
  jobs: { assigned: int, completed: int, failed: int, cancelled: int }
  activeJobs: int
  assetsStreamed: int
  credentialTests: { dispatched: int, succeeded: int, failed: int }
  secretResolutionFailures: int
  reconnects: int          // session ends followed by a reconnect
}
```

Numeric/state fields only — the Zod schema makes FR-008 (no paths, env
names, or error text) enforceable rather than documented.

`AGENT_PROTOCOL_VERSION` is bumped: the change is additive/optional but
the wire contract changed, and lockstep versioning (ADR-116 item 7) makes
a bump the honest signal — same-commit builds are unaffected.

**Alternatives considered**:

- **Separate `agent.status` frame** — a second cadence/channel to manage
  and reason about; the heartbeat already fires at the right interval and
  already carries `currentJobs`/`activeRunIds`; rejected.
- **Report on `hello` + job boundaries only** — heartbeat freshness display
  (spec US2-AS1) needs the regular cadence; rejected.

## D5 — Hub persistence of the snapshot: `"reportedStatus"` jsonb column

**Decision**: `import_agents` gains nullable `"reportedStatus" jsonb`
(migration `019_agent_ops_observability`), updated on each heartbeat that
carries `ops`. Detail payload gains `reportedStatus` + `lastHeartbeatAt`
(live-session `lastContactAt`, already tracked per accepted frame);
list + detail gain `lastDisconnectReason` (latest closed
`agent_sessions.disconnectReason`).

**Rationale**: Spec FR-009 — retain the *latest* snapshot only. A nullable
jsonb column survives hub restarts (the agent outlives a hub restart and
re-asserts on reconnect, but persisted state avoids a blank window) at the
cost of one UPDATE per heartbeat per agent — trivial write volume. In-
memory-only storage would lose the snapshot on every hub restart despite
the agent being alive; a dedicated table is oversized for replace-on-write
latest state.

`lastHeartbeatAt` is *not* persisted — it is live-session state read from
the in-memory `LiveSession.lastContactAt` via a session-service reader
(same dependency-injection pattern `RemoteRunReader` already uses);
`lastSeenAt` on the row already provides the durable freshness floor.

## D6 — Hub metrics additions

**Decision**: four series in the existing `plugins/metrics.ts` discipline:

| Series | Type | Labels | Point |
|---|---|---|---|
| `agent_dispatch_wait_seconds` | histogram | `agent` | run created → `job.assign` sent |
| `agent_remote_job_duration_seconds` | histogram | `agent, importer` | `job.assign` → `run.complete` |
| `agent_session_duration_seconds` | histogram | `agent, reason` | session open → close |
| `agent_last_contact_timestamp_seconds` | gauge | `agent` | every accepted frame |

**Rationale**: Directly answers spec US3's questions (queue wait, job
duration, drop cause) and gives operators a staleness alert expression
(`time() - agent_last_contact_timestamp_seconds > 90`). Label discipline
matches existing `agent_sessions_total{agent,reason}` /
`agent_assets_received_total{agent,importer}` — bounded agent-name labels,
no per-run cardinality.

## D7 — Agent-local metric series

**Decision**: `prom-client` registry in the agent mirroring the snapshot
counters plus process defaults:

`agent_stream_connected` (gauge), `agent_sessions_total{reason}`,
`agent_reconnects_total{outcome}`, `agent_jobs_received_total`,
`agent_jobs_completed_total{result}`, `agent_jobs_active` (gauge),
`agent_assets_streamed_total{importer}`, `agent_credential_tests_total{result}`,
`agent_secret_resolution_failures_total`, plus `collectDefaultMetrics()`
process series (uptime is covered by `process_start_time_seconds`).

**Rationale**: One counter registry feeds both the local `/metrics`
surface and the reported `ops` snapshot — the two stories share a single
source of truth instead of parallel counters.

## D8 — UI surfaces

**Decision**: Agent detail Overview gains "Last heartbeat" (live
freshness vs the ~30 s cadence) and an "Agent-reported" block (uptime,
counters, active jobs) labeled agent-reported with an explicit
"not reported by this agent" empty state; the Overview also surfaces the
latest disconnect reason. The agents list gains a last-disconnect column
next to existing status/running-jobs columns. `lastSeenAt` freshness is
already rendered on detail.

**Rationale**: Mirrors the established "agent-reported" labeling already
used for `agentVersion`/`maxConcurrentJobs` on the same page; no new
routes or permission changes (existing `agent:read`).

## D9 — ADR fidelity plan

ADR-116 Amendment 3 (ratified with this change — enumerated surfaces
extended):

- Agent env list gains `AGENT_OPS_HOST` / `AGENT_OPS_PORT` /
  `AGENT_OPS_DISABLED`.
- `heartbeat` payload gains the optional `ops` snapshot;
  `AGENT_PROTOCOL_VERSION` bumped.
- `import_agents` gains `"reportedStatus"` jsonb (item-1 column list).
- Hub Prometheus series gain the D6 entries; agent-local surfaces gain the
  D7 listener + series (item-12 series list was hub-scoped — the agent's
  own unauthenticated local surface is new and noted explicitly).
- `GET /api/v1/agents[...]` response fields gain `reportedStatus`,
  `lastHeartbeatAt`, `lastDisconnectReason` (openapi.yaml updated per
  ADR-104).

No constitution violations; security ADRs respected (ADR-084 Kysely-only,
ADR-095 Zod at boundaries, ADR-096 sanitized errors, ADR-097 auth model
unchanged — ops listener is documented as the same class of surface as
`/metrics`).
