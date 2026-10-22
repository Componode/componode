# Implementation Plan: Remote Import Execution

**Branch**: `feature/027-remote-import-execution` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/027-remote-import-execution/spec.md`

## Summary

Activate remote import execution end-to-end (ADR-116 items 4–6, 10–11;
research §3–4, §8, §10–11): importer configs gain an executor binding
(`importer_configs.agentId`, column already exists), `startRun` on a bound
config stamps `import_runs.agentId` and queues for remote dispatch, and the
reserved job frames (`job.assign`/`job.ack`/`asset.batch`/`phase`/
`run.complete`/`run.error`/`cancel`) go live over the existing agent
stream. A new hub-side `remote-run-service` owns per-agent FIFO dispatch,
capacity gating, ack/dispatch bounds, asset ingestion through the unchanged
validate/upsert path, and session-bound failure semantics
(`AGENT_UNAVAILABLE`/`AGENT_LOST`/`AGENT_INCOMPATIBLE`/`ASSET_TOO_LARGE`).
The agent package gains a job executor that resolves `AGENT_MANAGED`
reference maps locally and streams every yielded asset back. UI gains the
Execution selector, executor attribution on runs/configs/cards/dashboard,
and bound-config + run surfaces on agent detail.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 20+ ESM

**Primary Dependencies**: Fastify + `ws` (stream transport, existing),
Kysely (queries/migrations), Zod (wire + route schemas), p-queue
(in-process run queue — remote runs bypass it), React 18 + TanStack Query +
Tailwind/shadcn (UI)

**Storage**: PostgreSQL — one migration: `import_runs.agentId` nullable
(+ index). Dispatch state is in-memory by design (session-bound runs die
with the session; a hub restart fails them `AGENT_LOST` via `recoverRuns`).

**Testing**: Vitest — unit (schemas, dispatcher, executor, binding
validation) + integration (testcontainers Postgres + real `ws` client as
the fake agent, the `credential-test-remote.test.ts` pattern)

**Target Platform**: hub = Linux container (Fastify app); agent =
`componode-agent` container (`packages/agent`)

**Project Type**: web-service (monorepo: `packages/core`, `backend`,
`agent`, `frontend`)

**Performance Goals**: asset batches ≤100 assets / ~1 MB per frame; no new
per-request hot paths — dispatch is event-driven off the WS session

**Constraints**: secrets never cross the wire (`job.assign` carries
`secretRefMap` names only); session = run lifeline, no resume; capacity
never exceeds the agent's advertised `maxConcurrentJobs`; dispatch bound
default ~10 min, ack bound ~15 s (hub env-overridable)

**Scale/Scope**: ~12 files backend (new `remote-run-service.ts` +
touches to run/config/agent services, session service, recovery,
metrics, routes), ~4 files agent package (new `executor.ts` + client/main),
~6 files frontend, 1 migration, contracts + docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Evidence |
|---|---|---|
| I. Single-org | PASS | no tenancy introduced |
| II. Importer-first | PASS | agent forwards raw `DiscoveredAsset`s; upsert/dedup/reconciliation/run history stay hub-side in the unchanged `processAsset` path; agent imports only `core` + importer packages |
| III. Two-level taxonomy | PASS | untouched |
| IV. Environment-as-Instance | PASS | untouched |
| V. Factual vs meaning | PASS | edge suggestions still staged hub-side post-run by the unchanged `runSuggestionPass` |
| VI. Test-first | PASS | tasks order failing tests before each implementation step; remote path is integration-tested with a real `ws` client (spec-026 precedent) |
| VII. Observability | PASS | `agent_jobs_total`/`agent_assets_received_total` metrics, runId correlation, pino only, agent-side `ctx.logger` stays local |

No violations — Complexity Tracking intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/027-remote-import-execution/
├── plan.md              # This file
├── research.md          # Phase 0 output — dispatch model + protocol decisions
├── data-model.md        # Phase 1 output — schema delta + derived flags
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/           # Phase 1 output
│   ├── agent-protocol.md   # job frame payloads, ordering, failure semantics
│   └── api.md              # REST surface deltas (configs, agents, runs, dashboard)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── contracts/agent-protocol.ts   # promote job.* frames to real schemas
├── contracts/import-run.ts       # + agentId/agentName on ImportRun
├── contracts/importer-config.ts  # + agentId + agent summary + flag
├── contracts/import-agent.ts     # + activeRuns/runningJobs/bound configs
├── constants/error-codes.ts      # + AGENT_LOST/UNAVAILABLE/INCOMPATIBLE/ASSET_TOO_LARGE
├── constants/import-agent.ts     # + dispatch/ack timeout defaults, ack result type
└── schemas/importer-config.ts    # + agentId input field

packages/backend/src/
├── db/migrations/018_remote_run_agent.ts      # NEW — import_runs.agentId + index
├── db/types.ts                              # ImportRunRow.agentId
├── services/
│   ├── remote-run-service.ts   # NEW — dispatch queue, capacity, ack bound,
│   │                           #       frame handlers, finalize, in-flight map
│   ├── import-run-service.ts   # branch on config.agentId in startRun; export
│   │                           # shared processAsset/finalize helpers; cancel
│   │                           # routes to dispatcher for remote runs
│   ├── agent-session-service.ts # delegate job.* frames + session-lost to the
│   │                           # injected remote-run handler; capacity from hello
│   ├── importer-config-service.ts # agentId validation + effective-executor
│   │                           # credential-kind revalidation + agent summary join
│   ├── agent-service.ts        # bound-configs/runs listings + drift flag
│   ├── recovery-service.ts     # remote non-terminal runs → FAILED AGENT_LOST
│   └── dashboard-service.ts    # + OFFLINE_AGENT attention kind
├── routes/
│   ├── agents.ts               # + GET /agents/:id/configs, /agents/:id/runs
│   └── importers.ts            # unchanged routes; service gains executor logic
└── app.ts                      # wire RemoteRunService into AgentSessionService

packages/agent/src/
├── executor.ts                 # NEW — job runner: resolve refs, run importer,
│                               #       batch assets, cancel/abort, terminal frames
├── client.ts                   # job.assign/job.ack/cancel handling, real heartbeat
│                               # job counts, delegate frames to executor
└── main.ts                     # no change expected (executor driven from client)

packages/frontend/src/
├── api/types.ts                # + executor fields
├── api/hooks/agents.ts         # + useAgentConfigs/useAgentRuns
├── components/importer-config-form.tsx  # Execution selector + credential filtering
├── pages/importers.tsx         # config card "Runs on" + warnings
├── pages/importer-run.tsx      # executor line / "Waiting for agent"
├── pages/agents.tsx            # running-jobs column
├── pages/agent-detail.tsx      # Configs + Runs tabs, in-flight jobs
└── pages/dashboard.tsx         # OFFLINE_AGENT attention rendering
```

**Structure Decision**: extends the existing pnpm workspace layout; the
only new modules are `remote-run-service.ts` (hub orchestration) and
`executor.ts` (agent job runner) — both placed beside their peers per the
existing service/file conventions. The session service keeps transport
concerns; run semantics live in the run services (the `AgentSessionDropper`
seam precedent: injected interface, no circular import).

## Complexity Tracking

> No constitution violations — nothing to justify.
