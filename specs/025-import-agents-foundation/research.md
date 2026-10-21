# Research — Import Agents Foundation

Phase 0 output. Nearly all design decisions for this feature were ratified
in the pre-spec grilling and recorded in `researches/adrs/ADR-116` and
`researches/adrs/ADR-117` (full analysis:
`researches/remote-import-agents_research.md`). This document records the
remaining implementation-level decisions that the ADRs leave open, each in
Decision / Rationale / Alternatives form.

## R1 — WebSocket implementation

**Decision**: `@fastify/websocket@^11.3.4` on the hub (registers
`GET /api/v1/agent/stream` as a WebSocket route; published 2026-10-09,
satisfies the ≥7-day rule). `ws@^8.22.0` on the agent side for the client
connection, TLS options, and proxy support — `ws` is already in the
lockfile transitively.

**Rationale**: `@fastify/websocket` is the official Fastify plugin wrapping
`ws`; it preserves the route-level `preHandler` pipeline, so the
agent-credential middleware runs as a normal `preHandler` before the
upgrade is accepted. The contract test sees the route as a normal
`GET` (registered via `app.get(..., {websocket: true})`), so ADR-104
enforcement applies unchanged.

**Alternatives considered**: raw `ws` `WebSocketServer` on
`server.on("upgrade")` — bypasses Fastify routing/middleware, reimplements
what the plugin already does; `socket.io` — a heavier protocol on top of
WS that conflicts with the ratified framed-JSON-envelope protocol.

## R2 — Enrollment exchange mechanism

**Decision**: a dedicated public endpoint `POST /api/v1/agent/enroll`
exchanges `{ token }` (single-use enrollment token) for
`{ agentToken }` (durable bearer credential). The stream route stays
single-scheme: `Authorization: Bearer <agentToken>` verified by dedicated
agent-credential middleware.

**Rationale**: ADR-116 item 8 assigns the stream route a dedicated
agent-token middleware — keeping enrollment off that route means the
middleware validates exactly one credential kind, and single-use
semantics (`enrollmentTokenUsedAt` stamped at exchange) live in one
transactional service call. "Exchanged on first connect" is still honored:
the agent enrolls immediately before its first stream connect.

**Alternatives considered**: carrying the enrollment token on the WS
upgrade and delivering the durable credential in a `welcome` frame —
rejected: the middleware must then distinguish token kinds, the upgrade
is stateful before auth completes, and rejection paths (expired/used)
become protocol frames instead of plain HTTP errors.

**Ratified in**: ADR-116 Amendment 1.

## R3 — Agent credential persistence

**Decision**: after a successful enroll, the agent writes the durable
credential to `${AGENT_STATE_DIR}/agent-token` (mode 0600, default
`./agent-state` — the generated install command mounts a volume there).
Startup order: `AGENT_TOKEN_FILE` → `AGENT_TOKEN` → persisted
`agent-token` file → `AGENT_ENROLLMENT_TOKEN`/`AGENT_ENROLLMENT_TOKEN_FILE`
(enroll, then persist). If only enrollment material is present and the
state dir is not writable, startup fails with a clear error — an
unpersisted credential cannot survive a restart and enrollment tokens
are single-use.

**Rationale**: ADR-116 requires the enrollment → durable credential
exchange; the credential must land somewhere the agent owns. A dedicated
state dir keeps it out of `SECRETS_DIR` (which may be read-only mounts).

**Alternatives considered**: re-enroll on every start — impossible,
tokens are single-use; operator copies the durable credential into
`AGENT_TOKEN` after first connect — manual step the show-once flow was
designed to avoid; persist inside `SECRETS_DIR` — conflates mounted
(read-only) secret material with agent-owned state.

**Ratified in**: ADR-116 Amendment 1 (env list extension).

## R4 — Connection liveness (hub side)

**Decision**: in-memory session registry
(`Map<agentId, {socket, sessionRowId, lastContactAt}>`) inside the
agent-session service. Agents send `heartbeat` frames ~every 30 s; a
hub sweep runs every 15 s and closes sessions silent for >90 s with
`disconnectReason: "heartbeat_timeout"`. `import_agents.lastSeenAt`
updates on every accepted frame (any frame counts as contact).

**Rationale**: the hub is a single-process deployment (Docker Compose);
in-memory liveness is exact and adds no DB write pressure. DB rows in
`agent_sessions` exist for history, not for liveness reads.

**Alternatives considered**: DB-backed liveness (poll `agent_sessions`) —
hot-path writes for zero benefit in a single-process deploy; relying on
WS protocol ping/pong alone — kept as a supplement, but the ratified
protocol uses an application-level `heartbeat` frame that also carries
through intermediaries and feeds `lastSeenAt`.

## R5 — Supersede disconnect reason

**Decision**: `agent_sessions.disconnectReason` gains `superseded` in
addition to the ADR-116 list (`client_close`, `heartbeat_timeout`,
`revoked`, `shutdown`). A second connect with the same credential closes
the existing socket and records the old session `superseded`.

**Rationale**: spec edge case requires single active session per agent
identity; the reason list in ADR-116 is illustrative, not exhaustive —
without `superseded` the record would misreport a takeover as
`client_close`.

**Alternatives considered**: reusing `client_close` — loses audit
accuracy; rejecting the second connect — contradicts the spec edge case.

**Ratified in**: ADR-116 Amendment 1.

## R6 — Importer registry relocation

**Decision**: `importer-registry.ts` moves to `packages/core` as a
factory `createImporterRegistry(packageNames, load)` — the module
_loader_ is injected by each consumer (core stays a leaf: it never
imports `@componode/*`). The package _name list_ additionally lives in
core as `IMPORTER_PACKAGES` (T061 refinement): a string constant does
not violate the leaf rule — core holds the names, while backend and
agent each inject the loader that resolves them in their own dependency
context. This gives the lockstep handshake a single source of truth for
the importer set.

**Rationale**: ADR-116 item 9 mandates the move so agent and hub share
manifest enumeration for the version handshake — but `packages/core` is
a leaf with zero `@componode/*` deps (ADR-065), so the loader cannot be
hardcoded there. Injection preserves the leaf invariant while the shared
name list eliminates the drift risk of two independently maintained lists.

**Alternatives considered**: hardcoding the loader in core — breaks the
leaf rule (core would dynamically import `@componode/*` packages it
doesn't depend on); duplicating the name list per consumer — drift risk
on the exact code path the version handshake depends on.

## R7 — Schema columns for deferred binding

**Decision**: migration adds `importer_configs.agentId` (nullable FK →
`import_agents`, `ON DELETE RESTRICT`) **now**; `import_runs.agentId` is
**deferred to spec 027**.

**Rationale**: FR-005 (delete blocked while referenced) is in-scope and
gets its guarantee from the FK itself — the same RESTRICT pattern as
credentials (migration 011). Binding UI/dispatch still arrives in 027;
nothing can set the column yet, but integration tests can exercise the
constraint directly. `import_runs.agentId` has no writer until remote
dispatch exists, so it ships with the spec that writes it.

**Alternatives considered**: defer both columns — FR-005 would be
unenforced (vacuously true) and a later retroactive FK on populated
tables is riskier than shipping the nullable column now; add both now —
`import_runs.agentId` would be dead schema in this spec.

**Ratified in**: ADR-116 Amendment 1.

## R8 — CSRF exemption for the agent channel

**Decision**: `csrf.ts` skips the double-submit check for paths under
`/api/v1/agent/`.

**Rationale**: the CSRF hook applies to every POST/PATCH/DELETE globally;
`POST /api/v1/agent/enroll` is called by the agent process, which holds
no cookie jar. CSRF protects ambient cookie auth — the enroll endpoint
authenticates by bearer token in the request body, so the check is
meaningless there (same class of exemption as any token-authed API).
The WS upgrade itself is a `GET` and unaffected.

**Alternatives considered**: agent issues a preliminary GET to harvest a
CSRF cookie — pointless ceremony for a non-cookie-authed client; per-route
opt-out flag — path-prefix skip is simpler and the agent surface is a
single prefix by design.

**Ratified in**: ADR-087 Amendment 2 (required — the exemption conflicts
with ADR-087's "all state-changing routes" language; amended, not just
documented).

## R9 — OpenAPI representation of the agent channel

**Decision**: `POST /agent/enroll` and `GET /agent/stream` are documented
in `docs/openapi.yaml` with `security: []` and prose describing the agent
bearer/enrollment-token auth (in the `description` + a `tags: [Agents]`
section).

**Rationale**: the ADR-104 contract test asserts `security: []` exactly
iff the route lacks `verifySession` — agent-credential middleware is not
`verifySession`, so `security: []` is the only passing annotation.
Non-empty security schemes are reserved for session auth by that test.

**Alternatives considered**: custom `agentBearer` security scheme —
fails the contract test (`security: []` iff no `verifySession`);
excluding the WS route from the spec — fails route coverage.

## R10 — Status model

**Decision**: `import_agents.status` is a connection-state enum
(`NEVER_CONNECTED | CONNECTED | OFFLINE`, CHECK constraint from a core
constant); credential revocation is a separate `revokedAt` timestamp —
not a status value.

**Rationale**: mirrors the lifecycle-vs-status separation the
constitution mandates elsewhere (principle IV): `status` answers "can I
reach it", `revokedAt` answers "is its credential dead". A revoked agent
is also offline (its session is dropped), which falls out naturally.

**Alternatives considered**: `REVOKED` as a status value — conflates two
axes and forces awkward transitions (revoked + connected is impossible
yet reachable in a single enum); deriving status from `lastSeenAt` —
hides `NEVER_CONNECTED` vs `OFFLINE` ambiguity and can't represent
"connected right now".

## R11 — Protocol version constant

**Decision**: `AGENT_PROTOCOL_VERSION = 1` exported from
`packages/core`; hub rejects any `hello` whose `protocolVersion` differs,
and any `importers` entry whose name+version doesn't match the hub's
manifest set exactly.

**Rationale**: ADR-116 item 7 — parity is a monorepo build-time property.
A shared constant makes the mismatch impossible to express within one
release and obvious across releases.

**Alternatives considered**: semver-range negotiation — the ADR
explicitly rejects runtime negotiation for lockstep parity.

## R12 — New error codes (this spec only)

**Decision**: add to `ERROR_CODES` in core:
`AGENT_NOT_FOUND`, `AGENT_NAME_TAKEN`, `AGENT_IN_USE`,
`AGENT_ENROLLMENT_INVALID`, `AGENT_CREDENTIAL_INVALID`,
`AGENT_VERSION_MISMATCH`. The ADR-116 execution codes
(`AGENT_LOST`, `AGENT_UNAVAILABLE`, `AGENT_OFFLINE`,
`AGENT_INCOMPATIBLE`, `ASSET_TOO_LARGE`) are deferred to specs 026/027.

**Rationale**: `ERROR_CODES` is a controlled enum mirrored in
`openapi.yaml`'s Problem schema — only codes this spec can actually emit
are added (empty enum members would document impossible responses).

**Alternatives considered**: adding the full ADR-116 set now —
unreachable codes in the contract; reusing `CREDENTIAL_*` codes for
enrollment — wrong domain, leaks credential-store semantics.

**Ratified in**: ADR-116 Amendment 1.
