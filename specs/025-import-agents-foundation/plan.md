# Implementation Plan: Import Agents Foundation

**Branch**: `feature/025-import-agents-foundation` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-import-agents-foundation/spec.md`

## Summary

Deliver the foundation slice of remote import execution (ADR-116): the
`ImportAgent` entity, a single-use enrollment → durable-credential
lifecycle, an authenticated outbound-only WebSocket channel
(`GET /api/v1/agent/stream`) with version-lockstep handshake, heartbeat
liveness, and connection history — plus the admin UI
(`/agents`, `/agents/:id`) and a real `packages/agent` host process that
enrolls, connects, and reconnects. Explicitly out of scope: job dispatch,
remote run execution, and `AGENT_MANAGED` credentials (specs 026/027).

Approach: one Kysely migration (`import_agents` + `agent_sessions` +
`importer_configs.agentId` FK for delete-protection), two backend
services (agent CRUD/credentials, session registry/liveness), one new
public agent channel (enroll POST + WS upgrade, bearer-auth middleware,
CSRF-exempt), a thin `packages/agent` workspace package sharing the
agent-protocol contracts and importer-registry factory via
`packages/core`, and standard admin pages wired into the existing
list/detail/nav/audit patterns. Full decision record: `research.md`.

## Technical Context

**Language/Version**: TypeScript 6 (ESM, `"type": "module"`), Node 24

**Primary Dependencies**: Fastify 5 + `@fastify/websocket` ^11.3.4 (hub,
NEW dep); `ws` ^8.22.0 (agent WS client, NEW direct dep — already in
lockfile transitively); Kysely; Zod; Pino; prom-client; TanStack Query;
React Router; shadcn/ui — all existing.

**Storage**: PostgreSQL via Kysely migration `016_import_agents.ts` —
new `import_agents` and `agent_sessions` tables, nullable
`importer_configs.agentId` FK (RESTRICT). `import_runs.agentId` deferred
to spec 027 (research R7). `agent_sessions` is operational data — outside
ADR-100 append-only trigger protection (ADR-116 amendment).

**Testing**: vitest. Backend: unit tests for credential/token logic and
handshake validation; integration tests (testcontainers Postgres) for
agent CRUD, enrollment, stream auth, liveness, audit, and delete-block —
including real WS connect/disconnect cycles against a test server.
Agent package: unit tests for env parsing, backoff, token-file
persistence, and a mocked-WS enrollment flow. Frontend: component tests
for the enrollment dialog + badge rendering (existing test setup).

**Target Platform**: Hub — Node service (Docker Compose, single
container). Agent — Linux container (`componode-agent` image from a new
`Dockerfile.agent`); dev loopback plaintext `ws://` permitted for
localhost only.

**Project Type**: pnpm workspace — new `packages/agent`; cross-package
touches in `core` (protocol contracts, constants, registry factory),
`backend` (tables, services, routes, plugins), `frontend` (pages, hooks,
nav), `docs/` (openapi.yaml, agent-protocol.md, agents.md, ux.md,
CONTEXT.md).

**Performance Goals**: Agent fleet is small (tens, not thousands) —
liveness sweep O(connected agents) every 15 s is trivial. Stream route
must not block the HTTP pipeline; heartbeat bookkeeping is in-memory.

**Constraints**: TLS mandatory for `wss://` except loopback; no
insecure-skip-verify. Bearer tokens SHA-256-hashed at rest (ADR-099
pattern via `hashToken`). Unauthenticated traffic never writes audit
rows (ADR-116 #12). No `sql.raw`/`sql.fragment`; Zod-strict input at
route boundary; error envelope `{code,message,details?}`; new error
codes added to core `ERROR_CODES` + `openapi.yaml` Problem enum in the
same change (ADR-104 contract test). Agent env-only config
(`AGENT_STATE_DIR` added — research R3). Agent handles only
`hello`/`heartbeat`/close — job/asset/credential frames are reserved in
the protocol contract but unhandled until 026/027.

**Scale/Scope**: ~10 REST/WS endpoints, 2 tables + 1 column, 2 backend
services, 1 new workspace package, 2 frontend pages + enrollment dialog,
~10 doc touches.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Verdict | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Single-organization      | PASS    | Agents are deployment-global infra; no tenant scoping                                                                                                                                                                                                                                                                                                                                                                                            |
| II. Importer-first          | PASS    | Importer contract untouched — the agent is a transport host that runs the same packages; no importer writes to DB or imports backend. `packages/agent` joins backend as a permitted importer aggregator (manifest import) per ADR-065 amendment; registry moves to core as a factory with an injected loader to preserve core's leaf status, with `IMPORTER_PACKAGES` (a plain string list) shared there as the lockstep single source (R6/T061) |
| III. Two-level taxonomy     | PASS    | No taxonomy changes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| IV. Environment-as-instance | PASS    | Agent `status` (connection) vs `revokedAt` (credential) deliberately kept as separate axes, per the same separation principle (R10)                                                                                                                                                                                                                                                                                                              |
| V. Factual vs meaning layer | PASS    | No importer-declared edges                                                                                                                                                                                                                                                                                                                                                                                                                       |
| VI. Test-first              | PASS    | Failing tests first: enrollment single-use/TTL, handshake reject, heartbeat timeout, supersede, delete-block, audit attribution, CSRF exemption — then implement                                                                                                                                                                                                                                                                                 |
| VII. Observability          | PASS    | Pino logs on both sides; new prom-client series (`import_agents_connected`, `agent_sessions_total{reason}`, `agent_stream_rejected_total{reason}`); rejected upgrades log+count only                                                                                                                                                                                                                                                             |

Post-design re-check: identical verdicts — design introduces no new
violations. The CSRF path-prefix exemption (R8) and `security: []`
OpenAPI annotations (R9) are required mechanics, not gate violations:
agent endpoints authenticate by bearer credential, never by cookie.

## Project Structure

### Documentation (this feature)

```text
specs/025-import-agents-foundation/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — R1–R12 resolved decisions
├── data-model.md        # Phase 1 — tables, enums, contracts in core
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/
│   ├── agents-api.md    # Phase 1 — REST management + enroll endpoints
│   └── agent-protocol.md# Phase 1 — WS envelope/message contract (025 subset)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT this command)
```

### Source Code (repository root)

```text
packages/core/src/
├── contracts/agent-protocol.ts      # NEW — envelope + message Zod schemas, AGENT_PROTOCOL_VERSION
├── contracts/import-agent.ts        # NEW — ImportAgent/AgentSession DTOs + create/update schemas
├── constants/import-agent.ts        # NEW — AGENT_STATUSES, AGENT_DISCONNECT_REASONS, audit actions
├── constants/error-codes.ts         # + AGENT_* management codes (R12)
├── importer-registry.ts             # MOVED from backend — IMPORTER_PACKAGES + createImporterRegistry(names, load) with injected loader
└── contracts/index.ts / constants/index.ts / index.ts  # re-exports

packages/backend/src/
├── db/migrations/016_import_agents.ts   # NEW — import_agents, agent_sessions, importer_configs.agentId
├── db/types.ts                          # + ImportAgentRow, AgentSessionRow, importer_configs.agentId
├── services/agent-service.ts            # NEW — CRUD, enroll-token issue, credential exchange, rotate/revoke/delete + audit
├── services/agent-session-service.ts    # NEW — in-memory socket registry, handshake validation, session rows, liveness sweep, supersede
├── plugins/agent-auth.ts                # NEW — verifyAgentCredential preHandler (bearer hash → agent, revoked check)
├── plugins/csrf.ts                      # + skip /api/v1/agent/ paths (R8)
├── routes/agents.ts                     # NEW — admin CRUD/enroll/revoke/sessions (session auth + agent:* perms)
├── routes/agent-channel.ts              # NEW — POST /agent/enroll (public) + GET /agent/stream (WS, agent auth)
├── plugins/metrics.ts                   # + agent series
├── plugins/rbac.ts                      # + agent:read|create|update|delete → ADMIN
├── services/importer-registry.ts        # THIN FACADE — delegates to core's factory so existing test mocks/imports keep working
└── app.ts                               # register @fastify/websocket + new routes

packages/agent/                      # NEW workspace package @componode/agent
├── package.json                     # @componode/core + 8 importer packages (manifest) + ws + pino + zod
├── tsconfig.json
├── src/
│   ├── config.ts                    # env-only config (zod): HUB_URL, AGENT_TOKEN[_FILE],
│   │                                # AGENT_ENROLLMENT_TOKEN[_FILE], AGENT_STATE_DIR,
│   │                                # SECRETS_DIR, CA_BUNDLE, MAX_JOBS, proxy vars
│   ├── enroll.ts                    # POST /agent/enroll → persist credential to state dir
│   ├── client.ts                    # WS connect (TLS opts, CA bundle, proxy), hello, heartbeat loop
│   ├── backoff.ts                   # exponential backoff reconnect
│   └── main.ts                      # entrypoint: config → enroll-if-needed → connect loop
└── test/                            # unit tests (env parsing, backoff, persistence, mocked-WS flow)

packages/frontend/src/
├── api/hooks/agents.ts              # NEW — list/detail/sessions queries (refetchInterval ~15s) + mutations
├── api/types.ts                     # + ImportAgent, AgentSession types
├── pages/agents.tsx                 # NEW — list page (status badge, version, last seen)
├── pages/agent-detail.tsx           # NEW — Overview + Connection history tabs, lifecycle actions
├── components/agent-enrollment-dialog.tsx  # NEW — show-once token + docker run snippet + docs link
├── routes.tsx                       # + /agents, /agents/:id (ADMIN)
└── components/layout/nav-sections.ts# + Agents under Administration

Dockerfile.agent                     # NEW — componode-agent image
docs/openapi.yaml                    # + agents + agent-channel paths (security: [] per R9)
docs/api.md                          # regenerated (pnpm docs:api)
docs/agent-protocol.md               # NEW — message-level protocol spec
docs/agents.md                       # NEW — deployment + hardening guide (enrollment, TLS/CA, token file)
docs/ux.md, CONTEXT.md               # nav/route/badge updates + Enrollment Token/Agent Session terms
```

**Structure Decision**: mirrors existing conventions — a route file +
service per surface, contracts/constants in core, a migration per schema
delta, page-per-route frontend, hook file per API domain. The only new
structural element is `packages/agent`, laid out as a minimal app
package (config → enroll → client loop) with no framework beyond `ws`
and `pino`.

## Complexity Tracking

No constitution violations — table not required. Design extensions
beyond the ADR text (each in `research.md`) are ratified as ADR
amendments in this change — **ADR-116 Amendment 1** (enroll endpoint R2,
env additions R3, `superseded` R5, schema sequencing R7, management
error codes R12, rotation clears `revokedAt`) and **ADR-087 Amendment 2**
(CSRF exemption for bearer-authed `/api/v1/agent/` routes, R8) — so the
durable decision record stays authoritative.

## Phase 0 — Research

`research.md` — all open implementation decisions resolved (R1–R12).
The feature-level design was ratified upstream in ADR-116/ADR-117; no
NEEDS CLARIFICATION items remained in the spec.

## Phase 1 — Design & Contracts

- `data-model.md` — `import_agents`/`agent_sessions` tables, enums,
  core contracts, token lifecycle state machine.
- `contracts/agents-api.md` — management REST surface + enroll endpoint
  (request/response shapes, error codes, permissions).
- `contracts/agent-protocol.md` — WS envelope, `hello`/`heartbeat`/close
  semantics for this spec, reserved v1 types.
- `quickstart.md` — end-to-end validation: migrations, integration
  tests, live agent container against a dev hub.
