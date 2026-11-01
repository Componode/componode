# Implementation Plan: URL Check Agent-Vantage Probe Bounds

**Branch**: `052-url-check-probe-bounds` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/052-url-check-probe-bounds/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Close the FR-011 gap for Agent-vantage URL Check probes (gap analysis G1).
Today the hub's `p-queue` bound applies only to HUB-vantage probes —
`dispatchProbe` branches to `dispatchAgentProbe` before queueing — and the
agent runs every `url_check.probe` frame unbounded with no cancellation
path. The design adds:

1. **Hub-side admission control** — a per-agent bounded dispatch pool in
   the probe dispatcher: configurable max in-flight probes per agent,
   configurable dispatch rate per sweep interval, and a bounded deferral
   (user-clarified: excess waits; overflow → `MISSED` with a new
   distinguishable `SATURATED` error type, never a silent drop).
2. **Cancellation** — a new `url_check.probe.cancel` frame
   (`AGENT_PROTOCOL_VERSION` 4 → 5) sent when the hub finalizes a dispatch
   without a result; the agent aborts the underlying fetch via
   `AbortSignal` (`executeHttpProbe` already accepts `signal`) and aborts
   all in-flight probes on session close.
3. **Agent-side defensive cap** — the agent enforces its own in-flight
   bound and refuses excess frames immediately with
   `url_check.probe.result{outcome:"FAILURE", errorType:"SATURATED"}`
   (no second deferral layer; the hub queue is the single deferral of
   record). The hub maps `SATURATED` results to `MISSED` observations.
4. **Contract surfaces** — `SATURATED` joins `URL_CHECK_ERROR_TYPES`
   (migration alters the observations CHECK constraint), new env
   tunables, bounded telemetry, and ADR-124 + ADR-116 amendments in the
   same change.

## Technical Context

**Language/Version**: TypeScript, Node.js 20+ (ESM)

**Primary Dependencies**: Fastify, Kysely, `p-queue`, `ws`, `zod` (backend); `ws`, `zod`, undici/`fetch` (agent); `prom-client` (both); vitest + testcontainers (tests)

**Storage**: PostgreSQL — one migration altering `url_check_obs_error_type_check` to admit `SATURATED`; no new tables

**Testing**: vitest unit tests (backend + agent) and testcontainers integration tests (backend `test/integration/url-checks-*`)

**Target Platform**: Linux containers / Node services (hub backend + remote Import Agent daemon)

**Project Type**: web-service + agent daemon in a pnpm monorepo

**Performance Goals**: Bounded agent-vantage probe load — defaults: ≤4 in-flight probes per agent, ≤20 dispatches per sweep interval per agent, ≤100 deferred slots per agent (all configurable)

**Constraints**: No new REST endpoints; all wire frames zod-validated; metric labels bounded enums only (ADR-069); lockstep hub/agent deploy (protocol v5); no secrets on the wire (unchanged — frames carry reference names only)

**Scale/Scope**: 3 packages (`core`, `backend`, `agent`) + docs + 2 ADR amendments; no frontend, no importer changes

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                       | Verdict | Notes                                                                                                                                                                                                    |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Single-organization          | PASS    | Bounds are deployment-global config; no tenancy introduced                                                                                                                                               |
| II. Importer-first              | PASS    | Importer contract untouched; agent probe handling is not an importer                                                                                                                                     |
| III. Two-level taxonomy         | PASS    | No category/provider changes                                                                                                                                                                             |
| IV. Environment-as-instance     | PASS    | Checks stay attached to ComponentInstance; no lifecycle/status conflation                                                                                                                                |
| V. Factual vs. meaning layer    | PASS    | No importer-declared hierarchy changes                                                                                                                                                                   |
| VI. Test-first (NON-NEGOTIABLE) | PASS    | tasks.md orders failing tests before implementation per module                                                                                                                                           |
| VII+ workflow rules             | PASS    | ADR-124/116 amended in-change per ADR fidelity; `docs/` updated in-change; env vars documented; bounded metric labels; zod validation on new frame; no `sql.raw`; no new REST routes (OpenAPI untouched) |

No violations — Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/052-url-check-probe-bounds/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── agent-frames.md  # url_check.probe.cancel + SATURATED semantics (protocol v5)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/url-check.ts          # +SATURATED error type; new bound defaults
├── constants/import-agent.ts       # AGENT_PROTOCOL_VERSION 4 → 5
└── contracts/agent-protocol.ts     # +url_check.probe.cancel frame schema

packages/backend/src/
├── services/probe-dispatcher.ts    # per-agent bounded dispatch pools; overflow → MISSED(SATURATED); SATURATED result → MISSED
├── services/agent-session-service.ts # cancel frame on dispatch deadline; pending-probe hygiene
├── plugins/metrics.ts              # +in-flight / queue-depth gauges (label-free)
└── db/migrations/026_*.ts          # url_check_observations.errorType CHECK += SATURATED

packages/agent/src/
├── probe.ts                        # probe runner: per-probe AbortController, in-flight cap, SATURATED refusal, abortAll
├── client.ts                       # route url_check.probe.cancel; abort probes on socket close
├── config.ts                       # +URL_CHECK_MAX_PROBES env
└── metrics.ts                      # +agent probe counters/gauge

docs/
├── url-checks.md                   # hub bound envs + saturation/cancellation behavior
├── import-agents.md                # agent env + ops metrics tables
└── agent-protocol.md               # Protocol v5 section

researches/adrs/
├── ADR-124-url-check-execution-surfaces.md  # amendment: v5 frame, SATURATED, new tunables
└── ADR-116-agent-*.md              # amendment back-pointer (frame list, protocol 5)
```

**Structure Decision**: extend the existing feature-051 surfaces — no new
packages, services, or tables. The per-agent pool lives in the existing
`probe-dispatcher.ts` (it already owns vantage branching); agent-side
state lives in `probe.ts`/`client.ts` mirroring the `executor.ts`
`AbortController`-per-job pattern.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass.

## Phase 0 → research.md

See [research.md](research.md): enforcement locus, cancellation surface,
agent-side bound shape, `SATURATED` classification, env tunables,
telemetry, and doc/ADR surfaces — all resolved.

## Phase 1 → design artifacts

- [data-model.md](data-model.md) — one enum/constraint change, no new entities
- [contracts/agent-frames.md](contracts/agent-frames.md) — protocol v5 frame and result semantics
- [quickstart.md](quickstart.md) — runnable validation scenarios
